# Backend Module Boundary Refactor Implementation Plan

> Planned at commit `ab7349a` on 2026-08-27. Execute only after the user approves the final planning summary and `task.py start` succeeds.

## Executor Contract

- Read `prd.md`, `design.md` and `research/codebase-audit.md` completely before editing.
- Run every phase in order. Finish each phase with the listed verification and one logical commit before starting the next.
- Use add/switch/remove: create the new owner, add temporary `pub use` shims, switch callers/tests, then remove the old owner.
- Do not change a wire contract, migration, keyring behavior or generation state transition to make a move easier.
- The worktree may contain task artifacts from the planning session; preserve them and all unrelated user changes.

## Initial Drift Check

```bash
git diff --stat ab7349a..HEAD -- src-tauri src contract-fixtures .trellis/spec
```

If any in-scope source changed since `ab7349a`, compare it against the evidence anchors in `research/codebase-audit.md`. STOP if the target responsibility or a frozen contract has materially changed; return to planning rather than adapting silently.

## Commands and Expected Results

| Purpose | Command | Expected result |
|---|---|---|
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | exit 0, no diff |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0, no warnings |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-features` | exit 0; baseline and new tests pass |
| Frontend contract tests | `pnpm test -- src/lib/tauri/client.test.ts src/lib/tauri/provider-client.test.ts src/lib/tauri/title-events.test.ts` | exit 0 |
| Full frontend gate | `pnpm check` | exit 0 |
| Native inspection | `pnpm tauri info` | exit 0 |
| Desktop build | `pnpm tauri build --debug --no-bundle` | exit 0 |
| Migration checksum | `sha256sum src-tauri/migrations/000{1,2,3,4,5,6}_*.sql` | exactly matches `research/codebase-audit.md` |

## Phase 0 — Freeze the Actual Application Boundary

**Goal:** a module move cannot silently drop a production command or change high-risk orchestration while lower-level tests stay green.

### Files

- `src-tauri/src/lib.rs`
- `src-tauri/tests/command_boundary.rs`
- `src-tauri/tests/provider_contract.rs`
- `src-tauri/src/providers/commands.rs` tests or a new focused command-orchestration test
- `src-tauri/src/providers/titles.rs` tests or a new focused auto-title test
- `contract-fixtures/provider-ipc.json`
- frontend Tauri bridge tests only if fixture assertions need completion; production TypeScript is out of scope

### Work

1. Remove the copied `register_conversation_commands` test registry. Make mock IPC tests construct the same `register_commands` handler used by production.
2. Probe all 26 frozen command names through the production registration path. Use payloads that distinguish “registered and reached validation/database” from “unknown command”.
3. Complete provider contract round-trips for all setting/model/generation request and result DTOs represented by the shared fixture.
4. Add characterization around `generate_from_active_path` orchestration: Started precedes content events; terminal is unique; provider vs persistence failures retain their stage; Channel failure/cancel persists nothing; success persists one assistant after finalization.
5. Add auto-title characterization for enabled first reply success, disabled/non-first no-op, configured → conversation-bound → active provider fallback, title cleanup, DB update and exact global emit. Preserve the accepted manual-rename race.
6. Introduce only the minimum injection seams necessary to test existing behavior. Prefer extending `generation_persistence` and titles unit surfaces over new command-level fakes. Do not move modules in this phase. Cap seams to event order, unique terminal, `generation|persistence` stage, exactly-once persist, and title eligibility/fallback/cleanup/emit.

**Verify:** Rust format, Clippy, full Rust tests and the three frontend contract tests all exit 0. Confirm the migration checksums are unchanged.

**Commit:** `test(backend): freeze command and generation contracts`

## Phase 1 — Establish Platform and Error Direction

**Goal:** infrastructure no longer depends on conversation command/domain code, and application services no longer import command-owned identity/time utilities.

### Files

- Create `src-tauri/src/platform/mod.rs`
- Create `src-tauri/src/platform/database.rs`
- Create `src-tauri/src/platform/identity.rs`
- Update `src-tauri/src/database.rs` as a temporary re-export, then remove it in Phase 6
- Update `src-tauri/src/error.rs`, `src-tauri/src/lib.rs`
- Update callers under `src-tauri/src/conversations/` and `src-tauri/src/providers/`

### Work

1. Move `DATABASE_URL`, migration catalog/plugin conversion and managed-pool resolution into `platform::database` without modifying catalog contents or order.
2. Add a narrow `DatabaseError` for missing/unavailable managed pool. Map it to the existing `database_unavailable` `CommandError`; do not reuse `PersistenceError`.
3. Move `IdentityTimeSource` and `SystemIdentityTimeSource` from conversation commands to `platform::identity`. Keep the exact UUID v4 and epoch-millisecond behavior.
4. Switch all production/test imports. Preserve short-lived root re-exports so the tree compiles between steps.
5. Confirm `platform` imports no product module and no non-command code imports `conversations::commands`.

**Verify:**

```bash
rg -n "crate::conversations::PersistenceError|conversations::commands::.*IdentityTimeSource" src-tauri/src/platform src-tauri/src/providers
```

Expected: no matches. Then run the per-phase Rust gate and migration checksum.

**Commit:** `refactor(backend): establish platform boundaries`

## Phase 2 — Extract Typed Settings

**Goal:** provider profile code no longer owns application-wide preferences or generic app_settings SQL.

### Files

- Create `src-tauri/src/settings/{mod.rs,domain.rs,repository.rs,service.rs,commands.rs}` as justified by non-trivial content
- Update `src-tauri/src/providers/{domain.rs,repository.rs,service.rs,commands.rs,mod.rs}`
- Update `src-tauri/src/lib.rs`, `src-tauri/src/error.rs`
- Update provider/settings Rust tests and shared DTO fixtures

### Work

1. Move `LanguagePreference`, `ThemePreference`, `TitleModelBinding` and typed setting keys/serialization into `settings`.
2. Move `app_settings` SQL to `SettingsRepository`. Expose typed methods only; do not expose arbitrary user-controlled keys.
3. Move language/theme/auto-title/title-binding reads and writes to `SettingsService`/settings command adapters while registering the same command names and DTOs.
4. Keep `active_provider_id` semantics in `ProviderService`, backed by `SettingsRepository`. Provider save/delete must still clear invalid active/title bindings within its serialized credential operation and the same relevant transaction.
5. Keep `list_providers` as a compatibility façade returning the exact aggregate DTO in the same field/null semantics. It may compose provider and settings services internally.
6. Keep existing app_settings keys and stored representations byte-compatible; do not add a migration.

**Verify:**

```bash
rg -n "LANGUAGE_SETTING_KEY|THEME_SETTING_KEY|AUTO_GENERATE_TITLE_SETTING_KEY|TITLE_MODEL_BINDING_SETTING_KEY|get_setting\(|set_setting\(" src-tauri/src/providers
```

Expected: no generic settings implementation remains in provider repository/service; only explicitly justified compatibility calls/re-exports may match. Run provider profile, command contract and full Rust gates plus migration checksum.

**Commit:** `refactor(settings): extract typed application preferences`

## Phase 3 — Separate LLM Transport

**Goal:** protocol/HTTP behavior is independent of SQLite, keyring, Tauri and conversation domain types.

### Files

- Create `src-tauri/src/llm/{mod.rs,domain.rs,error.rs,client.rs,model_list.rs}`
- Create `src-tauri/src/llm/adapters/{mod.rs,openai_compatible.rs,anthropic.rs}`
- Update `src-tauri/src/providers/{domain.rs,error.rs,model_list.rs,openai_compatible.rs,anthropic.rs,mod.rs,commands.rs}` using temporary re-exports before old files are removed
- Update protocol HTTP/unit tests

### Work

1. Move `Protocol`, `ValidatedEndpoint`, hardened HTTP client, shared status/transport mapping, protocol request/stream parsing and model discovery into `llm`.
2. Define transport-neutral prompt/message/role/effort inputs in `llm`. Conversion from a `ValidatedPath` belongs outside `llm`; `llm` must not import conversations.
3. Split `ProviderError`: remote auth/rate/network/protocol/cancel variants move to `LlmError`; profile/credential/storage variants remain provider-owned. Preserve `CommandError` mappings.
4. Retain exhaustive enum dispatch for OpenAI-compatible vs Anthropic and all current endpoint/header/redirect/timeout/body/SSE behavior.
5. Switch provider model listing and generation callers through temporary re-exports, then delete the old protocol implementation files once no caller remains.

**Verify:**

```bash
rg -n "crate::(conversations|providers|generation)|tauri|sqlx" src-tauri/src/llm
```

Expected: no product-module, Tauri or SQL dependency. Run provider/anthropic HTTP tests, full Rust gate and migration checksum.

**Commit:** `refactor(llm): isolate protocol transport adapters`

## Phase 4 — Promote Generation and Automatic Titles

**Goal:** generation is the sole owner of reply/title orchestration and cross-domain generation configuration.

### Files

- Create `src-tauri/src/generation/{mod.rs,error.rs,runtime.rs,service.rs,dto.rs,commands.rs,title.rs,title_prompt.rs}` as justified
- Update/remove `src-tauri/src/providers/{generation.rs,titles.rs,title_prompt.rs}` after temporary re-exports
- Update `src-tauri/src/providers/commands.rs`, `src-tauri/src/conversations/{commands.rs,repository.rs,service.rs}`
- Update `src-tauri/src/lib.rs`, `src-tauri/src/error.rs`
- Move/update generation/title tests

### Work

1. Move `GenerationRuntime`, lease/phase state, prepare/run/finalize, generation DTOs/commands, title runner and title prompt to `generation`.
2. Add `GenerationError` that composes conversation persistence, provider profile/credential, LLM and runtime errors. Preserve every `CommandError` code and `generation|persistence` terminal stage.
3. Move conversation-provider/model binding orchestration out of conversation repository. In one transaction, `generation::service` validates the provider/model through provider APIs (`validate_model` stays in `providers::domain`) and updates conversation binding fields so provider deletion cannot create a check-then-act race. Register `set_conversation_provider` from `generation::commands`. Keep command name/DTO/result unchanged. Do not reintroduce `conversations → providers`.
4. Map conversation `ValidatedPath` into transport-neutral LLM prompt types in generation service. No provider/LLM module may import conversation types afterward.
5. Preserve runtime invariants: one active generation per conversation, exact ID cancel, cancellation before finalization persists nothing, finalization rejects late cancel, one successful assistant commit, slot held through persistence, prepare-time configuration snapshot.
6. Preserve auto-title invariants: runs outside `GenerationRuntime`, same eligibility/fallback/cleaning, failures remain warning-only, exact event name/payload.
7. Register generation handlers from the new module; keep old provider-path re-exports only until all internal tests switch.

**Verify:**

```bash
rg -n "generation|titles|title_prompt|crate::conversations" src-tauri/src/providers
```

Expected: no generation/title implementation and no conversation dependency in providers. Run focused generation/title tests, full Rust gate, frontend provider/title bridge tests and migration checksum.

**Commit:** `refactor(generation): extract reply and title workflows`

## Phase 5 — Tighten Conversation and Export Ownership

**Goal:** conversation owns only its domain/persistence/search adapters, while export owns file output without changing its current wire behavior.

### Files

- Create `src-tauri/src/conversations/dto.rs`; split conversation commands only where files have cohesive non-trivial content
- Create `src-tauri/src/exports/{mod.rs,dto.rs,service.rs,commands.rs}`
- Update `src-tauri/src/conversations/{commands.rs,repository.rs,service.rs,mod.rs}`
- Update `src-tauri/src/lib.rs`, `src-tauri/src/error.rs`
- Move/update export and command boundary tests

### Work

1. Move conversation/node wire DTOs to `conversations::dto` so generation commands can return `NodeDto` without importing conversation commands.
2. Keep tree mutations, history, archive/rename/delete, search and conversation persistence in conversations. Remove provider table SQL and provider validation imports.
3. Move export DTO validation, 16 MiB policy and filesystem write to `exports`.
4. Register `write_export_file` from `exports` under the same name/payload/result. Intentionally retain the managed-database preflight so the current `database_unavailable` behavior remains unchanged.
5. Keep search in conversations; do not create a top-level search module.

**Verify:**

```bash
rg -n "crate::providers|FROM providers|JOIN providers|std::fs::write" src-tauri/src/conversations
```

Expected: no matches. Run conversation/search/tree/export tests, full Rust gate and migration checksum.

**Commit:** `refactor(conversations): isolate domain and export boundaries`

## Phase 6 — Remove Compatibility Shims, Update Specs and Run Final Gate

**Goal:** only the target implementations remain, documentation matches reality and the complete desktop application validates.

### Files

- Remove obsolete `src-tauri/src/database.rs` and old provider generation/settings/transport re-export files when no longer referenced
- Update `src-tauri/src/*/mod.rs` and `src-tauri/src/lib.rs`
- Update relevant `.trellis/spec/backend/*.md`, `.trellis/spec/frontend/type-safety.md` and spec indexes if ownership names changed
- Update task research/notes only for verified implementation drift or deferred items

### Work

1. Remove all **temporary** re-exports and duplicate implementations. Keep the **permanent** `list_providers` compatibility façade (aggregate providers + settings response). Do not leave parallel old/new implementation paths.
2. Confirm the final dependency rules from `design.md` using targeted `rg` scans.
3. Update specs to the implemented structure and exact current command/event/error contracts. Preserve explicit decisions: static enum dispatch, generation snapshot, Rust-authoritative persistence, exact cancel/finalize semantics, auto-title outside GenerationRuntime and typed Rust-only SQL.
4. Run the complete verification table, including frontend gate, Tauri info/build and exact migration checksums.
5. Review `git diff --stat` and `git diff -- src-tauri/migrations src/lib/tauri` to prove there is no migration or production TypeScript wire change.

**Done criteria:**

- [ ] All PRD acceptance criteria are satisfied.
- [ ] All verification commands exit 0.
- [ ] No migration checksum changed and no migration was added.
- [ ] Production TypeScript Tauri bridge/schema files have no behavior-changing diff.
- [ ] `providers` and `conversations` have no reverse dependency; `llm` and `platform` have no product dependency.
- [ ] No old implementation or **temporary** compatibility shim remains. The permanent `list_providers` aggregate façade remains.
- [ ] Specs describe the final code, not the planned code.

**Commit:** `docs(backend): record modular architecture contracts`

## Global STOP Conditions

STOP and report to the main session; do not improvise if any occurs:

- Any step requires modifying or adding a migration, changing `DATABASE_URL`, preload or keyring references.
- A Tauri command/event/error/DTO or frontend Zod schema must change to complete the move.
- Existing generation cancellation/finalization/snapshot/exactly-once behavior cannot be preserved.
- Provider credential reconcile or crash recovery would change.
- A phase fails its focused or full Rust gate twice after a reasonable in-scope correction.
- The implementation requires a global utility drawer, dynamic plugin framework, new dependency or product feature.
- Source drift invalidates the target ownership or evidence anchors.

## Review Hotspots

- Transaction ownership when provider bindings/title settings interact with provider deletion.
- Error-source conversions: safe wire mapping must remain stable while internal errors split.
- Tauri handler parameter names (`request`, `on_event`) and generated command registration.
- Channel failure and cancel/finalize races.
- Credential redaction and absence of secrets in logs/SQLite/tests.
- Accidental duplicate implementation hidden behind re-exports.

