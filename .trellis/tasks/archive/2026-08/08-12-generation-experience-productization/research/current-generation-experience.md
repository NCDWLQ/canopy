# Current Generation Experience Research

## Scope conclusion

The requested productization is a frontend-only projection and lifecycle
refinement. The Rust commit protocol already exposes enough ordering to derive
failure class from the frontend's current generation phase. No DTO, command,
SQLite schema, or migration change is required.

## Current frontend behavior

- `GenerationState` has the required lifecycle phases, but terminal `failed`
  and `cancelled` variants retain neither streamed content nor the phase that
  preceded the terminal transition (`src/features/conversations/store/index.ts:18-47`).
- `failGeneration` collapses every active failure into one generic terminal
  shape, and `cancelGenerationRun` similarly discards content
  (`src/features/conversations/store/index.ts:666-690`).
- Reconciliation already keeps complete `content` and matches a single new
  assistant by conversation, parent, model, and content. A reload with no
  unambiguous match remains `reconciling`; it does not fabricate a node
  (`src/features/conversations/store/index.ts:716-789`).
- The container maps every transient phase to engineering copy. The pane
  renders a structurally separate article with a `Not saved` badge and an
  always-visible live status; failed/cancelled states become a separate Alert
  (`src/features/conversations/components/ConversationWorkspace.tsx:106-155`;
  `src/features/conversations/components/ConversationPane.tsx:118-172`).
- Durable messages use `MessageNode`, whose article layout differs from the
  transient article (`src/features/conversations/components/MessageNode.tsx:51-151`).

## Commit and reconciliation evidence

- `handleReady` first validates and marks the exact run `committing`, then
  passes `event.commitToken` directly into `commitGeneration`. The token has no
  store or component route (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:144-178`).
- `{ accepted: false }` is definitive rejection and currently becomes generic
  `failed` (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:161-165`).
- Accepted acknowledgement schedules a 1,500 ms grace timer. A thrown commit
  call currently enters `reconciling` immediately before scheduling that same
  timer, which is why recovery copy appears too early
  (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:121-175`).
- Exact `completed` clears the timer and remains authoritative even if it
  arrives before the commit/start promise resolves
  (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:180-213,243-281`).
- The retry action performs another authoritative tree load, but the state does
  not currently distinguish automatic recovery from a state that needs user
  intervention (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:98-119,439-442`).

## Backend capability evidence

- Legal Channel order permits `failed` before or after `ready_to_commit`
  (`src-tauri/src/providers/commands.rs:108-143`).
- Before ready, failures originate from provider streaming. After an accepted
  acknowledgement, an archive/database insert error produces `Failed`; this
  gives the frontend a reliable phase-derived failure class
  (`src-tauri/src/providers/generation.rs:341-377`).
- Commit tokens are exact, expiring, and one-time. The public command only
  returns `{ accepted }`; there is no resubmit-content operation
  (`src-tauri/src/providers/generation.rs:117-158`;
  `src-tauri/src/providers/commands.rs:321-330`).

## Relevant existing tests

- Store tests cover transient-only deltas, exact authoritative completion, and
  reconciliation with/no exact match
  (`src/features/conversations/store/generation.test.ts:140-349`).
- Controller tests cover completion before promises settle, token absence,
  ambiguous commit reload, and late exact completion
  (`src/features/conversations/hooks/useWorkspaceGenerationController.test.tsx:697-955`).
- Workspace has one success-path transient render test, but no complete phase,
  copy, recovery-delay, failure-kind, cancellation-content, or retry-action UI
  matrix (`src/features/conversations/components/ConversationWorkspace.test.tsx:635-731`).

## Spec drift to correct after implementation

`.trellis/spec/frontend/component-guidelines.md` currently requires a transient
assistant to be labeled as not saved. That conflicts with the approved product
requirement and must be updated after the implementation and checks. The state,
hook, and type-safety specs should also record the delayed-visible recovery and
phase-derived failure presentation contracts.
