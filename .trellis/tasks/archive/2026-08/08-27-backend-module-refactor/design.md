# Backend Module Boundary Refactor Design

> Planned at commit `ab7349a` on 2026-08-27. This design is behavior-, wire- and schema-preserving.

## 1. Problem Statement

The backend began with two product modules, so unrelated responsibilities accumulated under `providers` and `conversations`. The problem is not the number of directories itself; it is that business domains, application workflows, Tauri adapters and infrastructure now depend on each other's internals. The refactor must replace those accidental boundaries with cohesive ownership while keeping the desktop application's external behavior identical.

## 2. Design Principles

1. **Preserve wire and data contracts first.** Rust paths may change; Tauri command/event contracts and SQLite/keyring state may not.
2. **Organize by capability, layer within the capability.** Match `.trellis/spec/backend/directory-structure.md`; do not create generic helper drawers.
3. **Application workflows may compose domains; domains do not compose application adapters.** `generation` may depend on conversations/providers/settings/llm, never the reverse.
4. **Add, switch, remove.** New modules and re-exports land before callers switch; old implementations disappear only after all callers and tests move.
5. **Keep explicit protocol dispatch.** Two protocols do not justify dynamic plugin abstractions.
6. **No hidden product fixes.** Known behavior quirks remain documented compatibility constraints.

## 3. Current Dependency Problems

```text
database ────────────────> conversations::PersistenceError
conversations::commands ─> providers::domain::validate_model
providers::commands ─────> conversations::commands::{IdentityTimeSource, NodeDto}
providers::generation ───> conversations::{domain, service, commands}
providers::titles ────────> conversations::{service, command validation}
error ────────────────────> conversations::PersistenceError + providers::ProviderError
```

The root `error` module is allowed to know application/domain errors because it is the final IPC mapping boundary. The other arrows cross the intended direction and must be removed.

## 4. Target Structure and Ownership

```text
src-tauri/src/
├── lib.rs                       # thin Tauri composition and run entry
├── error.rs                     # stable CommandError wire mapping only
├── infra/
│   ├── mod.rs
│   ├── database.rs              # DATABASE_URL, migration catalog, managed pool, DatabaseError
│   └── identity.rs              # ID/time source and production implementation
├── settings/
│   ├── mod.rs
│   ├── domain.rs                # language/theme/title preference types
│   ├── repository.rs            # typed app_settings SQL; no arbitrary public keys
│   ├── service.rs               # preference use cases
│   └── commands.rs              # set_language / set_theme / set_auto_generate_title
├── llm/
│   ├── mod.rs
│   ├── domain.rs                # Protocol, endpoint, prompt/message and effort transport types
│   ├── error.rs                 # auth/rate/network/protocol/cancel errors
│   ├── client.rs                # hardened reqwest client and shared status/transport mapping
│   ├── model_list.rs
│   └── adapters/
│       ├── mod.rs
│       ├── openai_compatible.rs
│       └── anthropic.rs
├── providers/
│   ├── mod.rs
│   ├── domain.rs                # provider profile/input/redacted profile
│   ├── error.rs                 # profile/credential/storage errors only
│   ├── repository.rs            # providers + credential operation SQL
│   ├── credentials.rs           # keyring port and native adapter
│   ├── service.rs               # profile, activation and reconcile use cases
│   ├── dto.rs
│   └── commands.rs              # provider/profile/model-list adapters, set_title_model_binding, list compatibility façade
├── conversations/
│   ├── mod.rs
│   ├── domain.rs
│   ├── error.rs
│   ├── repository.rs
│   ├── service.rs
│   ├── dto.rs                   # conversation/node wire DTOs shared by generation commands
│   └── commands.rs              # tree/search/archive/rename/delete adapters
├── generation/
│   ├── mod.rs
│   ├── error.rs                 # composes conversation/provider/llm/runtime failures
│   ├── runtime.rs               # lease, cancellation and phase state machine
│   ├── service.rs               # prepare/run/finalize + provider binding orchestration
│   ├── dto.rs                   # generation request/event/terminal wire types
│   ├── commands.rs
│   ├── title.rs                 # auto-title workflow; bypasses GenerationRuntime
│   └── title_prompt.rs
└── exports/
    ├── mod.rs
    ├── dto.rs
    ├── service.rs               # validation and bounded filesystem write
    └── commands.rs              # frozen write_export_file adapter + compatibility DB preflight
```

Exact file splits may be combined when a target file would be trivial, but ownership and dependency rules are mandatory. Empty scaffolding is forbidden.

## 5. Target Dependency Direction

```text
lib / Tauri composition
  ├─> conversations ─> infra
  ├─> settings ──────> infra
  ├─> llm ───────────> (reqwest/tokio only)
  ├─> providers ─────> settings + llm + infra
  ├─> generation ────> conversations + providers + settings + llm + infra
  └─> exports ───────> infra (temporary DB preflight) + filesystem

error (IPC mapping) ─> errors from every command-facing module
```

Forbidden final dependencies:

- `providers -> conversations` or `providers -> generation`.
- `conversations -> providers` in domain/repository/service code.
- `settings -> providers|generation|conversations`.
- `llm -> providers|generation|conversations|Tauri|sqlx`.
- `infra ->` any product module.
- non-command code importing another module's `commands` file.

### Cross-cutting type and command ownership

Do not put these in a shared `utils`/`common` crate. Duplicate isomorphic enums only when a lower module would otherwise import a higher one.

| Item | Canonical owner | Notes |
|---|---|---|
| Persisted `ReasoningEffort` | `conversations::domain` | Stored on the conversation row with `provider_id` / `model`. Keep the existing `low\|medium\|high` strings. |
| Wire `ReasoningEffortDto` on conversation responses | `conversations::dto` | Tree/list/active-path DTOs continue to expose the field. |
| Wire `ReasoningEffortDto` on generate / binding requests | `generation::dto` | Same serialized values; convert at the command boundary. |
| Transport effort type used by HTTP adapters | `llm::domain` | Isomorphic Low/Medium/High. `llm` must not import conversations. |
| `ValidatedPath` → LLM prompt/message/role/effort mapping | `generation::service` | The only allowed conversion site. Protocol adapters receive `llm` types only. |
| `validate_model` / `validate_models` | `providers::domain` | Single validator. Profile save, model list membership, and binding all call this API. |
| `set_conversation_provider` orchestration | `generation::service` | One transaction: validate provider/model through provider service APIs, then write conversation binding fields. Removes `EXISTS FROM providers` from `ConversationRepository` without a check-then-act race. |
| `set_conversation_provider` Tauri handler | `generation::commands` | Frozen command name and `{ request }` wrapper. Register from `generation`, not from `conversations`. Conversations must not import `providers` to “keep the command local.” |
| Conversation binding SQL (no provider table) | `conversations::repository` | Updates `provider_id` / `model` / `reasoning_effort` columns only. No `FROM providers` / `JOIN providers`. |
| `set_language` / `set_theme` / `set_auto_generate_title` | `settings::commands` | Frozen names and DTOs. `settings` must not import `providers`. |
| `set_title_model_binding` orchestration | `providers::service` | Validates provider/model via `validate_model` and profile lookup, then stores through `SettingsRepository`. Cannot live in `settings` (forbidden `settings → providers`). |
| `set_title_model_binding` Tauri handler | `providers::commands` | Same frozen command name. |
| `LanguagePreference` / `ThemePreference` / `TitleModelBinding` | `settings::domain` | Stored `app_settings` representations stay byte-compatible. |

`conversations` may keep a persistence-only setter that accepts already-validated binding values. It must not call `validate_model` or query the providers table.

### Permanent façades vs temporary shims

| Surface | Lifetime | Phase 6 action |
|---|---|---|
| `list_providers` aggregate response (providers + active + auto-title + title binding + language + theme) | **Permanent wire façade** | Keep. Internally compose `providers` + `settings`. Do not split the IPC command in this task. |
| Root `database.rs` re-export | Temporary | Delete after callers use `infra::database`. |
| `providers::{generation,titles,title_prompt,openai_compatible,anthropic,model_list}` re-exports | Temporary | Delete after registration and tests switch. |
| `providers` generic `get_setting` / `set_setting` | Temporary | Delete after `SettingsRepository` owns typed keys. |
| `IdentityTimeSource` re-export from conversation commands | Temporary | Delete after `infra::identity` is the only owner. |
| `providers` re-export of `LanguagePreference` / `ThemePreference` / `TitleModelBinding` | Temporary | Delete after callers import `settings`. |

Temporary shims exist only to keep the crate compiling between add/switch/remove steps. Permanent façades exist because the wire contract is frozen. Phase 6 must not delete a permanent façade to “look cleaner.”

## 6. Error Boundaries

- `infra::database::DatabaseError`: managed database missing/unavailable only; it does not import a product error.
- `conversations::PersistenceError`: conversation row/domain integrity and conversation SQL failures.
- `settings::SettingsError`: typed `app_settings` SQL and corrupt stored values. Corrupt values keep the historical `ProviderError::Protocol` wire mapping (`provider_unavailable`, `服务提供商当前不可用。`, retryable).
- `providers::ProviderError`: profile validation, profile absence, keyring/reconcile and provider storage failures.
- `llm::LlmError`: authentication, rate limit, remote availability, network, protocol and cancellation.
- `generation::GenerationError`: runtime state plus transparent composition of conversation/provider/LLM failures; it retains the existing generation-vs-persistence failure-stage mapping.
- root `CommandError`: the only wire error; existing code/message/retryable/details serialization stays byte-for-byte compatible.

Source chains remain internal. No provider body, SQL detail or secret may cross IPC.

## 7. Frozen External Contracts

### Commands

All 26 names stay unchanged:

```text
create_conversation, append_node, create_branch, edit_node_as_branch,
list_conversations, load_conversation_tree, load_active_path,
archive_conversation, rename_conversation, delete_conversation,
unarchive_conversation, set_conversation_provider, search_conversations,
write_export_file, list_providers, save_provider, delete_provider,
set_active_provider, set_auto_generate_title, set_title_model_binding,
set_language, set_theme, reveal_provider_api_key, list_provider_models,
generate_from_active_path, cancel_generation
```

The `{ request: ... }` argument wrapper, `onEvent` Channel parameter, snake_case fields, option/null/omitted behavior and all response DTOs remain unchanged.

### Events and errors

- Generation Channel: `started`, `delta`, `thinking_delta` in the same valid order and with the same UUID/content validation.
- Generation terminal: `completed`, `cancelled`, `failed`; failure stage remains `generation|persistence`.
- Global event: `conversation://title-updated` with `{ conversation_id, title }`.
- `CommandErrorCode` values and exact message/retryable/details mapping remain unchanged.

### Persistence

- No change to `sqlite:canopy.db`, plugin preload, `MIGRATION_CATALOG` order or migration SQL.
- Tables, foreign keys, triggers, app_settings keys and credential operation rows remain unchanged.
- keyring service/account/reference behavior remains unchanged.
- A code rollback after any phase remains database-safe because no schema is changed.

## 8. Key Data Flows

### Reply generation

```text
generation command
  -> generation service loads conversation + validated active path
  -> provider service snapshots selected-or-active profile + credential
  -> llm maps the path to a protocol request and streams deltas
  -> generation runtime arbitrates running/cancelling/finalizing
  -> conversation service commits one assistant node after finalization wins
  -> command maps outcome to the frozen Channel + terminal DTOs
```

The snapshot occurs before the network request. Provider edits/deletion and conversation binding changes affect only later generations. A late cancel cannot win after finalization begins.

### Automatic title

```text
completed first reply
  -> generation::title checks typed settings
  -> loads current title context and configured/bound/active provider fallback
  -> uses llm title request without GenerationRuntime
  -> validates/cleans title
  -> conversation service updates title
  -> emits conversation://title-updated
```

Failures remain non-fatal and warning-only. The historical manual-rename race remains unchanged.

### Settings and provider compatibility response

`settings` owns typed reads/writes for language, theme, auto-title and title binding. Provider activation remains a provider use case but persists through the typed settings repository. `providers::commands::list_providers` remains a compatibility façade that composes provider and settings services into the existing aggregate response.

Provider save/delete continues to reconcile credentials and clear invalid active/title bindings within the same serialized operation and transaction boundaries.

### Export

The path/content validation and 16 MiB bounded write move to `exports::service`. The Tauri handler retains the current managed-database availability check before calling the service. Removing this unrelated check is a separate behavior-change task.

## 9. Migration Strategy

1. **Contract harness**: make production command registration the sole registry tested by mock IPC; fill generation/title characterization gaps.
2. **Infra boundaries**: introduce database error and identity/time ownership, switch callers, retain root re-exports until stable.
3. **Settings**: move typed preferences and app_settings SQL; preserve setting keys, response aggregation and transactional cleanup.
4. **LLM transport**: move protocol/endpoint/client/adapters/model discovery; map conversation paths to transport-neutral prompt types at the generation boundary.
5. **Generation**: move runtime, reply orchestration, binding orchestration, DTOs, title workflow and prompt; preserve temporary re-exports under old provider paths until registration/tests switch.
6. **Conversation/export cleanup**: move DTO/policy out of oversized command file, remove provider SQL/imports, extract exports with compatibility preflight.
7. **Remove shims and update specs**: prove no forbidden imports or duplicate implementations, then update guidelines and run the full desktop quality gate.

Each step is a separate reviewable commit. Do not begin the next step until targeted tests and the Rust full gate pass.

## 10. Validation and Rollback

Per-phase minimum:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

Final gate:

```bash
pnpm check
pnpm tauri info
pnpm tauri build --debug --no-bundle
```

Rollback is code-only. While compatibility re-exports exist, revert the failing phase commit. After shims are removed, revert in reverse phase order. Stop instead of continuing if a change requires a migration, wire/schema update, keyring rewrite, altered generation state transition or frontend product change.

## 11. Trade-offs and Deferred Work

- A top-level `llm` module adds one boundary but prevents profile persistence from owning all inference transports and removes conversation dependencies from provider code.
- Compatibility façades temporarily look redundant; they are cheaper than an atomic backend/frontend rewrite and disappear only where wire ownership can move invisibly.
- A single Trellis task is retained rather than child tasks because the phases share one frozen-contract harness and must land in strict dependency order. Separate commits provide rollback and review boundaries without duplicating compatibility artifacts.
- Deferred: stale provider/model cleanup migration, removing export's DB preflight, released-database plugin lifecycle harness, dynamic protocol plugins and frontend API regrouping.

