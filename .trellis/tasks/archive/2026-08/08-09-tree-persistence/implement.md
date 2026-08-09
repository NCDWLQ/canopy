# Tree Persistence Implementation Plan

## Ordered Checklist

1. Add only the direct Rust dependencies/features needed for domain error
   types and deterministic async SQLite tests; verify the resolved SQL stack
   remains singular.
2. Extract `DATABASE_URL` and the ordered migration catalog into
   `src-tauri/src/database.rs`; keep `app_builder` using the catalog through the
   Tauri SQL plugin.
3. Add `0002_conversation_tree.sql` with the published tables, composite foreign
   keys, indexes, and history/root-protection triggers.
4. Add conversation domain records, role decoding, persistence errors, and the
   validated-path type without adding serde IPC DTOs or public command errors.
5. Implement the managed-pool adapter over `DbInstances`/`DbPool::Sqlite` and
   prove production paths never create another pool.
6. Implement parameterized repository inserts, reads, deterministic tree
   loading, active-path query/validation, and archive update.
7. Implement the persistence service transaction for atomic conversation/root
   creation plus append/branch, tree, path, and archive operations.
8. Add real-migration SQLite tests for schema shape, atomic rollback,
   constraints/triggers, deterministic ordering, metadata round-trip, sibling
   isolation, fail-closed errors, managed-pool extraction, and corrupt-cycle
   termination.
9. Run the complete validation matrix and inspect the final diff for accidental
   Tauri command, frontend, provider, second-pool, or dependency scope growth.

## Validation Commands

```bash
python3 ./.trellis/scripts/task.py validate 08-09-tree-persistence
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
cargo tree --manifest-path src-tauri/Cargo.toml | rg 'tauri-plugin-sql|sqlx|sqlite'
pnpm check
pnpm tauri build --debug --no-bundle
rg -n 'sql:allow-(select|execute)|@tauri-apps/plugin-sql|SqlitePool::connect' src src-tauri
git diff --check
```

The final `rg` is an inspection gate: frontend SQL permissions/imports and
production `SqlitePool::connect` calls are failures; a connection in isolated
Rust test support is allowed.

## Review Gates

- The plugin remains the only production database creator and migration
  runner, and the database URL matches Tauri preload configuration exactly.
- The test runner consumes the same ordered migration catalog rather than a
  copied schema string.
- Every SQL value is bound; services own multi-step transactions; repositories
  own row mapping.
- SQLite constraints/triggers, not only Rust behavior, protect immutable
  history and root integrity.
- Active-path success proves exact order and sibling absence; every invalid
  path case fails closed with no fallback query.
- Test-only corruption and connection creation cannot be reached from
  production code.
- No command DTO, frontend state/UI, provider integration, or edit-as-branch
  product policy enters the diff.

## Risk and Rollback Points

- After adding the migration catalog, run the scaffold builder test before
  repository work so registration regressions are isolated early.
- Validate the DDL against a fresh SQLite database before building repository
  APIs; revise the migration rather than compensating for weakened constraints
  in Rust.
- Keep commits separable around migration/catalog, domain/repository, and tests
  so a failed integration can be reverted without deleting unrelated
  foundation work.
- Do not delete a developer database automatically. If pre-release local data
  blocks migration testing, report the explicit database path and recovery
  choice to the user before any removal.

## Pre-Start Checks

- [x] `prd.md`, `design.md`, and `implement.md` match scope and acceptance.
- [x] `implement.jsonl` and `check.jsonl` contain real backend spec context.
- [x] The user has reviewed the final planning summary and explicitly approved
      implementation in a subsequent message.
