# Backend Directory Structure

> Rust/Tauri module ownership for Canopy's local application core.

## Current Foundation

The backend is the `src-tauri` crate. Keep the two executable entry files thin:

```text
src-tauri/
├── capabilities/
│   └── default.json          # webview permissions; SQL stays Rust-only
├── migrations/
│   └── 0001_bootstrap.sql    # ordered, plugin-managed migrations
├── src/
│   ├── lib.rs                # Tauri builder, plugins, migration registration
│   └── main.rs               # desktop process entry point only
├── Cargo.toml
└── tauri.conf.json           # application, security, and plugin configuration
```

`src-tauri/src/main.rs` delegates directly to `canopy_lib::run()`. Application
setup belongs in the library so it remains constructible from tests, as shown
by `application_builder_is_constructible` in `src-tauri/src/lib.rs`.

## Product Module Organization

Add product code by domain, with technical boundaries visible inside the
domain. The first conversation implementation should grow toward:

```text
src-tauri/src/
├── lib.rs
├── error.rs                  # application errors and CommandError mapping
├── conversations/
│   ├── mod.rs
│   ├── domain.rs             # Node, Conversation, validated path types
│   ├── repository.rs         # parameterized sqlx queries and row mapping
│   ├── service.rs            # transactions and domain invariants
│   └── commands.rs           # typed Tauri DTO boundary
└── providers/
    ├── mod.rs
    └── openai_compatible.rs  # provider adapter; no UI or SQLite ownership
```

Create a module only when its implementation lands; do not add empty directory
trees. If a file becomes difficult to navigate, split it within the owning
domain rather than creating a global `utils` module.

Boundary rules:

- Commands validate DTOs, call services, and map errors. They do not contain
  SQL, provider HTTP logic, or multi-step transactions.
- Services own domain decisions and transactions spanning repository calls.
- Repositories own SQL and row mapping. SQL never appears in commands or
  frontend code.
- Domain types do not depend on Tauri command types or `sqlx` row types.
- Provider adapters accept validated domain inputs and return typed provider
  results/errors.

These boundaries implement the data flow recorded in
`.trellis/spec/backend/database-guidelines.md` and
`.trellis/spec/backend/error-handling.md`.

## Migrations and Tests

- Name migrations with a four-digit increasing prefix and a short snake-case
  purpose: `0002_conversation_tree.sql`.
- Keep migration SQL under `src-tauri/migrations`; register the same ordered
  files with the Tauri SQL plugin in Rust.
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

## Forbidden Patterns

- Product logic in `main.rs` or a growing monolithic `lib.rs`.
- A second production SQLite pool or a migration runner outside the SQL plugin.
- Catch-all `utils.rs`, `common.rs`, or `helpers.rs` modules without one clear
  domain owner.
- Raw `String` errors crossing Tauri IPC.
- Circular ownership such as repositories calling commands or domain types
  importing Tauri handles.

## Verification

Run formatting, Clippy with warnings denied, and Rust tests after changing the
crate layout. If migrations or plugin registration move, also run the debug
no-bundle Tauri build documented in `README.md`.
