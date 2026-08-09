# Domain Boundary Implementation Plan

## 1. Refresh contracts and archive schema

- [x] Update backend/frontend specs to state that archive belongs only to a
      conversation; remove node-archive commands and `TreeNodeView.isArchived`.
- [x] Add `0003_conversation_archive.sql` without changing prior migrations.
- [x] Register migration v3 in the single ordered migration catalog.
- [x] Add real-migration regressions for conversation archive, old node-flag
      normalization, node-archive rejection, archived-conversation insert
      rejection, forward-only archive, and unchanged node bytes.
- [x] Run `cargo fmt --all -- --check` and the focused persistence test suite.

Rollback point: migration/spec changes and their focused tests form one
reviewable checkpoint before command code.

## 2. Refactor the persistence domain to conversation archive

- [x] Add conversation archive state to domain/repository decoding.
- [x] Remove node archive as a domain input and retire repository/service
      `archive_node`.
- [x] Implement idempotent `archive_conversation` and a reusable archived-write
      guard inside service-owned transactions.
- [x] Add repository queries needed for parent/source/child-count validation.
- [x] Preserve deterministic tree/path reads for archived conversations.
- [x] Update existing tests and add archived-write rollback coverage.
- [x] Run focused Rust unit and real-SQLite integration tests.

Rollback point: persistence APIs are internally coherent and have no Tauri or
TypeScript dependency.

## 3. Add the Rust application and Tauri command boundary

- [x] Add UUID v4 as an explicit dependency and implement injectable ID/time
      generation for deterministic handlers.
- [x] Add centralized title/content/ID validation and the approved append,
      branch, and edit-as-branch policies.
- [x] Add explicit snake-case request/success DTOs and mapping from domain
      records; omit node archive state.
- [x] Add the closed application `CommandError` taxonomy and one safe mapper
      from persistence/application errors.
- [x] Implement the seven command wrappers using the plugin-managed pool only.
- [x] Register the exact command list in the Tauri builder.
- [x] Add unit, transaction, serialization, error-mapping, and mock-IPC command
      registration tests.
- [x] Run `cargo fmt`, focused tests, full Rust tests, and Clippy with warnings
      denied.

Rollback point: the Rust IPC surface is complete and independently testable
before frontend bridge code.

## 4. Add the shared fixture and TypeScript bridge

- [x] Add `contract-fixtures/conversation-ipc.json` and make Rust contract
      tests consume it.
- [x] Add canonical camelCase conversation, node, normalized tree/path, and
      UI-error types under `src/features/conversations/types`.
- [x] Add strict Zod schemas for all snake-case wire DTOs and the complete
      `CommandError` envelope.
- [x] Add an injectable invoke transport and typed functions for all seven
      commands under `src/lib/tauri`.
- [x] Centralize snake_case-to-camelCase mapping, tree normalization,
      null-to-optional conversion, and malformed-error normalization.
- [x] Add fixture-driven tests for every command, malformed successes, all
      error codes, retryability, nested metadata, timestamps, and nullability.
- [x] Run TypeScript typecheck, lint, unit tests, and production build.

Rollback point: the bridge is usable without Zustand or UI changes.

## 5. Cross-layer review and final validation

- [x] Prove Rust and TypeScript consume the same fixture and agree on exact
      command names and field casing.
- [x] Re-run edit regression with a sibling sentinel and verify source plus all
      descendants are byte-identical.
- [x] Re-run active-path regression with inactive sibling sentinel exclusion.
- [x] Audit for raw `invoke` outside `src/lib/tauri`, SQL outside repository and
      migrations, unsafe TypeScript casts/suppressions, second pools, public
      `archive_node`, and node-level `isArchived`.
- [x] Run `python3 ./.trellis/scripts/task.py validate 08-09-domain-boundary`.
- [x] Run `pnpm check`.
- [x] Run `cargo fmt --all -- --check`.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] Run `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`.
- [x] Run `pnpm tauri build --debug --no-bundle`.
- [x] Dispatch an independent Trellis check and resolve every verified issue.

Validation evidence (2026-08-09): the independent Trellis check fixed
Rust/TypeScript Unicode-validation drift, complete-tree fail-closed validation,
opaque-ID projection safety, transient SQLite lock mapping, and missing shared
malformed-success coverage, with owning specs synchronized. Task context
validation and `pnpm check` passed with 10 tests and a production build; Rust
formatting, 19 tests, and warnings-denied Clippy passed; the dependency tree
contains one sqlx 0.8.6 / libsqlite3-sys 0.30.1 stack; static boundary audits
passed; and the debug no-bundle Tauri build produced
`src-tauri/target/debug/canopy`.

## Completion gate

The task is complete only when every PRD acceptance criterion is traced to a
passing test or explicit static audit, conversation is the sole archive unit,
the full validation matrix passes, and no Zustand/UI/provider work has leaked
into scope.
