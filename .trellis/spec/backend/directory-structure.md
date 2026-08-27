# Backend Directory Structure

> Rust/Tauri module ownership for Canopy's local application core.

## Current Layout

The backend is the `src-tauri` crate. Keep the two executable entry files thin:

```text
src-tauri/
├── capabilities/
│   └── default.json          # webview permissions; SQL stays Rust-only
├── migrations/
│   ├── 0001_bootstrap.sql
│   ├── 0002_conversation_tree.sql
│   ├── 0003_conversation_archive.sql
│   ├── 0004_provider_profile.sql
│   ├── 0005_multi_provider.sql
│   └── 0006_provider_models.sql
├── src/
│   ├── lib.rs                # Tauri builder, production command registry
│   ├── main.rs               # desktop process entry point only
│   ├── error.rs              # CommandError IPC mapping only
│   ├── infra/
│   │   ├── database.rs       # DATABASE_URL, catalog, register_sql_plugin, pool
│   │   └── identity.rs       # IdentityTimeSource / SystemIdentityTimeSource
│   ├── settings/
│   │   ├── domain.rs         # language / theme / title-binding types
│   │   ├── error.rs          # SettingsError (corrupt values, storage)
│   │   ├── repository.rs     # typed app_settings SQL
│   │   ├── service.rs
│   │   └── commands.rs       # set_language / set_theme / set_auto_generate_title
│   ├── llm/
│   │   ├── domain.rs         # Protocol, ValidatedEndpoint, prompt types
│   │   ├── error.rs          # LlmError
│   │   ├── client.rs         # hardened HTTP client
│   │   ├── model_list.rs
│   │   └── adapters/
│   │       ├── openai_compatible.rs
│   │       └── anthropic.rs
│   ├── providers/
│   │   ├── domain.rs         # profile / validate_model
│   │   ├── error.rs          # ProviderError (profile, credential, storage)
│   │   ├── repository.rs     # providers + credential-operation SQL
│   │   ├── credentials.rs    # keyring port and native adapter
│   │   ├── service.rs        # profile, activation, title-binding, reconcile
│   │   └── commands.rs       # profile IPC + list_providers aggregate façade
│   ├── conversations/
│   │   ├── domain.rs
│   │   ├── error.rs          # PersistenceError
│   │   ├── repository.rs
│   │   ├── service.rs
│   │   ├── dto.rs            # conversation/node/binding wire DTOs
│   │   └── commands.rs       # tree / search / archive / rename / delete
│   ├── generation/
│   │   ├── error.rs          # GenerationError
│   │   ├── runtime.rs        # lease, cancel, Running/Finalizing/Cancelling
│   │   ├── service.rs        # prepare/run/finalize + provider binding
│   │   ├── dto.rs            # generate Channel and terminal wire types
│   │   ├── commands.rs       # generate / cancel / set_conversation_provider
│   │   ├── title.rs          # auto-title; bypasses GenerationRuntime
│   │   └── title_prompt.rs
│   └── exports/
│       ├── dto.rs
│       ├── service.rs        # validation and bounded filesystem write
│       └── commands.rs       # write_export_file + managed-DB preflight
├── tests/
│   ├── fixtures/             # released canopy-v0.4.0.db + provenance README
│   ├── support/mod.rs
│   ├── command_boundary.rs
│   ├── tree_persistence.rs
│   ├── released_database_upgrade.rs
│   └── ...                   # provider, generation, HTTP, migration suites
├── Cargo.toml
└── tauri.conf.json
```

`src-tauri/src/main.rs` delegates directly to `canopy_lib::run()`. Application
setup belongs in the library so it remains constructible from tests, as shown
by `application_builder_is_constructible` in `src-tauri/src/lib.rs`.
`register_commands` is the only production handler builder; mock IPC tests
construct that same registry.

## Product Module Organization

Organize by capability. Layer technical boundaries inside the owning domain.
Do not recreate the early two-module (`conversations` + `providers`) layout.

```text
lib / Tauri composition
  ├─> conversations ─> infra
  ├─> settings ──────> infra
  ├─> llm ───────────> (reqwest/tokio only)
  ├─> providers ─────> settings + llm + infra
  ├─> generation ────> conversations + providers + settings + llm + infra
  └─> exports ───────> infra (DB preflight) + filesystem

error (IPC mapping) ─> errors from every command-facing module
```

Forbidden dependencies:

- `providers -> conversations` or `providers -> generation`
- `conversations -> providers` in domain, repository, or service code
- `settings -> providers | generation | conversations`
- `llm -> providers | generation | conversations | Tauri | sqlx`
- `infra ->` any product module
- non-command code importing another module's `commands` file

Create a module only when its implementation lands; do not add empty directory
trees. If a file becomes difficult to navigate, split it within the owning
domain rather than creating a global `utils` module. Exact file splits may be
combined when a target file would be trivial (provider wire DTOs currently
live in `providers/commands.rs` beside the `list_providers` façade).

Boundary rules:

- Commands validate DTOs, call services, and map errors. They do not contain
  SQL, provider HTTP logic, or multi-step transactions.
- Services own domain decisions and transactions spanning repository calls.
- Repositories own SQL and row mapping. SQL never appears in commands or
  frontend code.
- Domain types do not depend on Tauri command types or `sqlx` row types.
- LLM adapters accept transport-neutral prompt types from `llm::domain`.
  Conversion from `ValidatedPath` belongs in `generation::service`.
- Provider adapters persist profiles and credentials; they do not own
  generation runtime, auto-title, or protocol HTTP.
- `list_providers` is a permanent aggregate IPC façade. It composes
  `providers` and `settings` into one frozen response and must not be split.
- Fixture catalogs `CONVERSATION_COMMAND_NAMES` / `PROVIDER_COMMAND_NAMES` may
  still list moved command names so frozen fixtures stay byte-compatible.
  That is not a duplicate implementation.

Cross-cutting type ownership:

| Item | Canonical owner |
|---|---|
| Persisted `ReasoningEffort` | `conversations::domain` |
| Conversation/node/binding wire DTOs, including `SetConversationProviderRequest` | `conversations::dto` |
| Generate Channel and terminal wire types | `generation::dto` |
| Transport effort / `Protocol` / `ValidatedEndpoint` | `llm::domain` |
| `validate_model` / `validate_models` | `providers::domain` |
| `set_conversation_provider` orchestration and handler | `generation::{service,commands}` |
| Conversation binding SQL (no provider table) | `conversations::repository` |
| `set_language` / `set_theme` / `set_auto_generate_title` | `settings::commands` |
| `set_title_model_binding` | `providers::{service,commands}` |
| `LanguagePreference` / `ThemePreference` / `TitleModelBinding` | `settings::domain` |
| Identity/time source | `infra::identity` |
| Managed pool / migration catalog | `infra::database` |

## Migrations and Tests

- Name migrations with a four-digit increasing prefix and a short snake-case
  purpose: `0002_conversation_tree.sql`.
- Keep migration SQL under `src-tauri/migrations`; register the same ordered
  catalog from `infra::database` with the Tauri SQL plugin in Rust.
- Put small unit tests beside the owning module under `#[cfg(test)]`, following
  `src-tauri/src/lib.rs`.
- Put tests that need real ordered migrations and a temporary SQLite database
  in `src-tauri/tests/` once that test surface exists.
- Test helpers belong under `src-tauri/tests/support/` only when two or more
  integration tests share them.

## Naming Conventions

- Rust modules and files: `snake_case`.
- Rust types and traits: `UpperCamelCase`; functions and variables:
  `snake_case`.
- Tauri command names and serialized fields: `snake_case`.
- Database tables, columns, constraints, triggers, and indexes: `snake_case`.
- Prefer domain names such as `ConversationRepository` and `ValidatedPath` over
  vague names such as `Manager`, `Helper`, or `DataService`.
- The infrastructure module is `infra`, not `platform`.

## Forbidden Patterns

- Product logic in `main.rs` or a growing monolithic `lib.rs`.
- A second production SQLite pool or a migration runner outside the SQL plugin.
- Catch-all `utils.rs`, `common.rs`, or `helpers.rs` modules without one clear
  domain owner.
- Raw `String` errors crossing Tauri IPC.
- Circular ownership such as repositories calling commands or domain types
  importing Tauri handles.
- Dynamic protocol plugin/trait objects while there are two protocols; keep
  exhaustive enum dispatch.
- Temporary compatibility re-exports after callers have switched (`database.rs`
  at the crate root, identity re-exports from conversation commands, LLM or
  settings types re-exported from `providers`).
- A copied test-only command registry. Mock IPC must probe
  `register_commands`.

## Verification

Run formatting, Clippy with warnings denied, and Rust tests after changing the
crate layout. If migrations or plugin registration move, also run the debug
no-bundle Tauri build documented in `README.md`.
