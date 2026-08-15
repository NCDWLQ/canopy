# Generation Commit Protocol Simplification Implementation Plan

## Preconditions

- Review and approve `prd.md` and `design.md` before activation.
- Load the curated backend provider, frontend state, type-safety and hook contracts plus the streaming-command research note.
- Preserve the unrelated planning task `.trellis/tasks/08-15-message-copy-button/` unchanged.

## Implementation Checklist

1. Update the shared provider IPC contract first: replace ready/commit DTOs with started/delta Channel events and a closed terminal command-result union; update Rust/TypeScript fixtures together.
2. Refactor `GenerationRuntime` to `Running | Finalizing | Cancelling`, add mutex-linearized `begin_finalizing`, and remove acknowledgement token, timeout, commit and expiry paths.
3. Refactor `PreparedGeneration::run`/`finish_generation` so successful provider completion enters finalization and directly calls `append_completed_assistant`; preserve cancellation-before-finalization and transaction rechecks.
4. Make `generate_from_active_path` await the generation instead of spawning a detached worker, stream started/deltas through its Channel, and return the terminal DTO. Remove `commit_generation` registration and command-name coverage.
5. Update `provider-schemas.ts` and `provider-client.ts` for the reduced event union and terminal invoke result, including result-before-Channel-callback races, bounds, identity validation and exact cancellation on malformed input.
6. Reduce frontend generation store states/actions. Remove committing/reconciliation actions and accept a completed authoritative node from starting or streaming when target invariants still match.
7. Simplify `useWorkspaceGenerationController`: await the terminal result, remove acknowledgement/timers/manual retry, retain exact cancellation, and add only the one-shot authoritative reload for ambiguous transport rejection.
8. Simplify `ConversationWorkspace` and `ConversationPane` transient presentation props while preserving starting, streaming, stopped, generation failure and persistence failure behavior.
9. Rewrite focused Rust and frontend tests around the new ownership boundary; delete acknowledgement/token/timer/replay tests that no longer express product behavior.
10. Update executable Trellis specs to describe backend-owned finalization and the reduced frontend lifecycle; scan for stale acknowledgement terminology.
11. Run focused tests, then the complete frontend and Rust quality gates.

## Validation Commands

```bash
pnpm test -- src/lib/tauri/provider-client.test.ts src/features/conversations/store/generation.test.ts src/features/conversations/hooks/useWorkspaceGenerationController.test.tsx src/features/conversations/components/ConversationWorkspace.test.tsx
pnpm lint
pnpm typecheck
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

## Required Regression Cases

- normal started/delta/completed with one authoritative assistant;
- result resolution before delayed Channel callbacks;
- cancellation wins before finalization: no node;
- finalization wins before cancellation: one node and cancel rejected;
- Channel send failure during streaming: no node;
- final result delivery failure after insert: node visible on reload;
- provider, malformed SSE, archive and database failures leave no partial node;
- malformed/mismatched bridge payload cancels only the exact generation;
- ambiguous invoke rejection reloads once and neither fabricates nor duplicates a node;
- same-conversation exclusion and cross-conversation independence;
- active path and sibling isolation remain unchanged.

## Risky Files and Rollback Points

- `src-tauri/src/providers/generation.rs`: cancellation/finalization race and slot release; validate before moving to command/IPC changes.
- `src-tauri/src/providers/commands.rs` and `src-tauri/src/lib.rs`: long-lived command result and registration; Rust contract tests are the rollback gate.
- `contract-fixtures/provider-ipc.json`, `src/lib/tauri/provider-schemas.ts`, `src/lib/tauri/provider-client.ts`: must remain atomically aligned.
- `src/features/conversations/store/index.ts` and `useWorkspaceGenerationController.ts`: authoritative merge and ambiguous reload; focused state/controller tests are the rollback gate.
- `.trellis/spec/backend/provider-guidelines.md`, `.trellis/spec/frontend/state-management.md`, `.trellis/spec/frontend/type-safety.md`, `.trellis/spec/frontend/hook-guidelines.md`: update only after implementation behavior is verified.

No database rollback or data migration is expected.
