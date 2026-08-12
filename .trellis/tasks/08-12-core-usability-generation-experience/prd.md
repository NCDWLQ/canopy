# 核心可用性与生成体验

## Goal

Make conversation creation reachable from every history state and prevent late
message-save completions from overriding newer user navigation or starting
generation from an abandoned target.

## Background

- `ConversationWorkspace` currently renders `NewConversationForm` only when
  `conversationId === null`, so a workspace that has loaded any existing or
  archived conversation has no route back to the creation form
  (`src/features/conversations/components/ConversationWorkspace.tsx`).
- `appendNode`, `createBranch`, and `editNodeAsBranch` capture the store at
  request start and later apply `addAuthoritativeNode` from that snapshot. The
  helper always selects the returned node, even if the user selected another
  node while the request was pending
  (`src/features/conversations/store/index.ts:304-350,830-952`).
- Append auto-generation already rechecks an expected conversation/node pair,
  but the store's forced late selection makes the stale target appear current
  (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:396-412`).

## Requirements

### R1 — Explicit blank-conversation entry

- Add an accessible “New conversation” action at the top of the History area.
- Keep the action available when history is empty, when an active conversation
  exists, and when every discovered conversation is archived.
- Activating it switches the main workspace directly to a blank conversation
  surface with an enabled Composer. Do not ask for a title or initial prompt in
  a separate form.
- The user enters the first prompt in Composer and sends it through the normal
  conversation workflow.
- The blank surface is an in-memory draft until the first Composer send. That
  send atomically creates the existing conversation + user-root shape through
  `create_conversation`; it does not persist an empty conversation beforehand.
- Derive the title locally from the first prompt: trim leading/trailing Rust
  Unicode whitespace, collapse each internal whitespace run to one ASCII space,
  keep the first 40 Unicode scalar values, and append `…` when more content was
  omitted. Keep the full validated prompt as the root message content. Do not
  call a model to summarize the title.
- Entering the blank surface must not clear or replace the previously loaded
  conversation tree, selection, or history summaries.
- Loading/selecting a history item exits creation mode and shows that selected
  authoritative conversation.
- Render history titles on one line with width-based visual ellipsis, and expose
  the complete stored automatic title in an accessible hover/focus tooltip.

### R2 — Reject stale mutation selection changes

- `appendNode`, `createBranch`, and `editNodeAsBranch` must capture their
  conversation, mutation target, and active selection at request start.
- A late result must not replace a newer conversation load or creation-mode
  transition. A stale failure must likewise not overwrite the newer view's
  state.
- When the same conversation remains loaded, an authoritative returned node may
  be merged into the tree, but it is selected only if the request's original
  active selection is still current.
- If the user selected another node while append persistence was pending, the
  saved node remains durable/represented but automatic generation must not
  start. The user may navigate back and generate manually.
- Existing archive and active-generation mutation guards remain intact.

## Acceptance Criteria

- [x] AC1: The History header exposes an accessible “New conversation” button
  with empty history, existing unarchived history, and all-archived history.
- [x] AC2: Clicking the button with a loaded conversation displays a blank
  conversation pane and enabled Composer without any title/prompt form, while
  the prior tree projection, active node, and history summaries stay present in
  the conversation store.
- [x] AC3: Selecting a history item exits blank mode. Sending the first Composer
  prompt creates and activates the existing conversation + user-root shape,
  derives its title using whitespace normalization plus the first 40 Unicode
  scalar values and conditional `…`, preserves the full prompt as content, and
  exposes a safe Composer retry path on failure.
- [x] AC3a: History titles remain single-line and width-truncated in the sidebar,
  while hover/focus exposes the complete stored automatic title.
- [x] AC4: Deferred append, create-branch, and edit-as-branch results do not
  change `activeNodeId` after the user has selected a different valid node.
- [x] AC5: A deferred append that resolves after navigation does not invoke
  `generateFromActivePath`; the returned authoritative node is not fabricated
  from transient data and remains available in its owning tree.
- [x] AC6: Results and failures invalidated by a newer conversation/form epoch
  cannot replace the newer workspace state.
- [x] AC7: Focused store, controller, and component tests pass alongside format,
  ESLint, strict TypeScript, the complete Vitest suite, and the production build.

## Out of Scope

- Redesigning history ordering, archive persistence, or provider configuration.
- Changing backend/Tauri conversation command contracts or SQLite schemas.
- Broader generation UX work beyond preventing auto-start from a stale saved
  target.

## Confirmed Technical Constraint

The current contract cannot persist a node-free conversation: the
`create_conversation` command requires nonblank `title` and `content`, the
service creates the conversation and its user root atomically, and the SQLite
schema requires an immutable `root_node_id`. Supporting a durable empty record
immediately would therefore expand scope into command/DTO/schema migration and
would conflict with the current out-of-scope boundary.
