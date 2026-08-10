# Implementation Plan

1. Extend the backend discovery contract.
   - Add a narrow conversation summary domain/DTO and deterministic repository query.
   - Expose it through the persistence service and `list_conversations` command.
   - Register the command and update exact command/fixture contracts.
2. Extend the typed frontend boundary.
   - Add the summary view type, strict response schema, client method, mapping, and malformed/duplicate response tests.
3. Implement store hydration and deterministic selection.
   - Add discovery state, summaries, initialization/retry/select actions, and epoch-based stale-response protection.
   - Choose the newest unarchived conversation on startup (fallback: newest archived) and the newest deterministic leaf after tree load.
   - Reconcile summaries after create and archive without browser persistence.
4. Add the history UI.
   - Compose a compact history list into the current sidebar with selected, archived, loading, empty, and retryable error states.
   - Trigger idempotent startup initialization and preserve existing tree/generation behavior.
5. Add regressions.
   - Prove list ordering, archived inclusion, empty/error mapping, and file-backed close/reopen durability in Rust.
   - Prove IPC runtime validation, clean-store startup restore, StrictMode safety, conversation switching, latest-leaf path selection, and sibling isolation in TypeScript/React.
6. Run quality gates and review cross-layer consistency.
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test -- --run`
   - `pnpm build`
   - `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
   - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
   - `cargo test --manifest-path src-tauri/Cargo.toml`

## Risk and Rollback Points

- Keep the shared fixture, Rust DTOs, command registration, schemas, client, and test doubles in one coordinated change to avoid IPC drift.
- Do not add a migration unless existing data proves insufficient; the approved design derives activity from nodes.
- Do not let startup async completion replace a later selection or generation target.
- If latest-leaf selection disrupts established tree behavior, isolate it to history/startup loading while retaining the existing root-selection helper for other callers.
- No database content is deleted or rewritten; reverting the code safely restores the old behavior.
