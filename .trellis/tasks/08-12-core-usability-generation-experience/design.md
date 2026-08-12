# Technical Design

## Boundaries

This is a frontend-only change. `ConversationWorkspace` renders intent,
`useConversationStore` owns the coordinated workspace/tree projection, and
`useWorkspaceGenerationController` continues to start generation only after an
authoritative persistence result has been accepted as the exact live target.
No wire DTO or backend command changes are required.

## Blank draft mode

Add a store-owned transient flag (for example `isCreatingConversation`) plus an
action that enters creation mode. The flag belongs in the conversation store
because the History control and the main workspace body must agree on the same
mode.

Entering creation mode:

1. invalidates outstanding conversation/mutation request epochs;
2. sets the creation-mode flag;
3. preserves `conversationId`, `rootNodeId`, `activeNodeId`, normalized node
   maps, expansion, generation terminal state, and history summaries.

`ConversationWorkspace` renders a blank conversation pane plus the existing
`Composer` whenever creation mode is active, or when discovery has completed
with no selected conversation. It does not render `NewConversationForm` or any
separate title/prompt inputs. The History button is always rendered but is
disabled during an in-flight conversation load/save or active generation.
History selection and successful creation exit creation mode. Failed creation
retains it and leaves the Composer available for retry after the error is
dismissed/recovered.

The blank draft is not durable. On its first Composer submit, derive the title
with a small shared frontend helper: trim Rust Unicode whitespace, collapse
internal whitespace runs to one ASCII space, iterate Unicode scalar values (not
UTF-16 code units), keep the first 40, and append `…` only when more normalized
content was omitted. The result remains far below the frozen 200-character
backend limit. Pass that title and the untruncated prompt content to the existing
typed `createConversation` call. The returned root remains the authoritative
user node and may start generation through the existing exact-target guard. No
title-generation provider request is introduced.

History rows retain their current single-line CSS truncation. Add an accessible
tooltip around the title text so pointer hover and keyboard focus reveal the
complete stored automatic title without expanding or reflowing the sidebar.

## Mutation completion contract

Each of `appendNode`, `createBranch`, and `editNodeAsBranch` captures:

- the current request epoch;
- the owning conversation ID;
- the command target ID;
- the active node ID at request start.

After the typed command returns, the action rereads the live store. It rejects
the completion if the epoch or conversation changed. Otherwise it validates and
merges the returned authoritative node against the live tree, not the stale
request-start snapshot. The merge selects the returned node only when the live
active node still equals the captured active selection; otherwise it preserves
the newer valid selection.

This permits navigation during persistence without discarding a successful
durable node. For append, the controller's existing exact-target check then sees
that the saved node is not current and suppresses automatic generation.

Errors are applied only while the same epoch/conversation still owns the
request. A newer conversation load or creation-mode transition owns its own
status and cannot be overwritten by a late rejection.

## Compatibility and rollback

- Existing typed Tauri APIs and persisted data are unchanged; the blank surface
  exists only in frontend state until first send.
- Existing manually persisted titles remain display-compatible; the 40-character
  derivation rule applies only to titles created from the new blank draft flow.
- Existing successful behavior is preserved when the selection does not change:
  the new node is selected and append may auto-start generation.
- Rollback is isolated to the workspace-mode field/action, local title helper,
  guarded merge logic, and their tests; no migration is required.

## Key trade-off

Navigation remains usable during message persistence. Guarding completion with
epoch/target/selection identity is preferred over globally disabling the tree,
because it preserves responsiveness while making stale completion harmless.
