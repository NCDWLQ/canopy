# Composer generation actions and contextual recovery

## Goal

Make generation controls spatially and semantically consistent: the Composer's
circular action sends the current draft or stops the current stream, while
generation and regeneration for an existing message live beneath that message.
Remove generation controls from the workspace header without leaving saved
user messages stranded.

## Background

- `ConversationWorkspace` currently renders a header slot that alternates
  between Generate and Cancel generation
  (`src/features/conversations/components/ConversationWorkspace.tsx:340`).
- `Composer` currently couples textarea editability and send availability to
  one `disabled` prop (`src/features/conversations/components/Composer.tsx:5`).
- The existing generation controller already exposes `canGenerate`,
  `canCancel`, `generate`, and exact-generation `cancel`; this task does not
  require a new provider or persistence capability
  (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:31`).
- Automatic generation returns early when the Provider is not ready, after the
  user message has already been durably saved
  (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:227`).
  Removing header Generate without contextual recovery would strand that user
  node.
- The active path ends at a user node until an assistant response is committed,
  so draft editing and draft submission must be separate capabilities.
- The archived auto-generation PRD required header Generate to remain. This
  task deliberately supersedes that UI requirement: manual generation remains
  possible contextually for an unanswered user leaf, not from the header.
- Existing uncommitted visual changes in `Composer.tsx` adjust its background
  opacity and blur and belong to the user; they must be preserved.

## Requirements

### R1: Composer Send/Stop state contract

- The circular Composer action is Send when no cancellable generation is
  active and Stop during `starting` or `streaming`.
- Stop invokes the existing exact-generation cancel callback and remains
  enabled even though ordinary message submission is unavailable.
- Stop uses the existing Chinese cancellation language for its tooltip and
  accessible name. Send retains `发送消息`.
- `committing` and `reconciling` remain non-cancellable and must not show an
  active Stop action.

### R2: Draft continuity and keyboard behavior

- In a writable, valid conversation, textarea editability is independent from
  whether the active path can accept a new user node.
- The draft remains editable throughout starting, streaming, committing,
  reconciling, cancelled, failed, and contextual recovery states.
- Submission remains unavailable until the active path ends at an eligible
  assistant leaf.
- During any non-submittable state, unmodified Enter is a no-op: it does not
  cancel, submit, insert a newline, or clear the draft. `Shift+Enter` still
  inserts a newline.
- Existing IME-safe Enter handling, failed-submit draft retention, textarea
  auto-resize, archived/read-only behavior, and visual styling remain intact.

### R3: Remove header generation controls

- Remove the workspace header's generation action slot entirely. Neither
  Generate nor Cancel generation appears in the header in any phase.
- Unrelated header actions, including Archive, retain their behavior.

### R4: Contextual regeneration after cancellation

- A cancelled transient assistant response retains received partial content
  and `回复已停止` as today.
- It also exposes an always-visible refresh-icon-plus-text `重新生成` action
  below the response, using the same contextual message-action treatment as
  existing assistant recovery actions.
- Regenerate invokes the existing generation intent for the same authoritative
  user parent and does not clear or submit the Composer draft.

### R5: Contextual first generation for an unanswered user leaf

- When the selected active path ends at a writable user leaf with no assistant
  child and no transient response, show an always-visible action beneath that
  exact user message.
- If the Provider is ready, the action is `生成回复` and invokes the existing
  generation intent for that selected user node.
- If the Provider is not ready, the action is
  `配置服务提供商以生成` and opens the existing global settings dialog over the
  current conversation.
- Saving a valid Provider configuration changes the contextual action to
  `生成回复`; it never automatically starts generation. Generation requires a
  fresh explicit click, avoiding unexpected or billable background work.
- The contextual actions do not appear for archived conversations, assistant
  leaves, user nodes that already have an assistant child, or while a transient
  response already owns recovery.

### R6: Boundary preservation

- Reuse the existing controller callbacks and Provider settings surface.
- Do not change provider commands, IPC DTOs, Rust generation runtime,
  persistence schemas, commit/cancel race semantics, or Zustand generation
  state contracts.

### R7: Assistant generation action consistency

- Failed/cancelled transient assistant `重新生成` actions remain always visible,
  but use the same compact icon-only ghost-button treatment as the existing
  Edit and Create Branch message actions, including tooltip and Chinese
  accessible name.
- When the current durable path ends at the latest assistant message, expose a
  `重新生成` action for that exact response in the normal assistant message
  action bar. It uses the same size, color, icon, hover/focus disclosure, and
  accessibility treatment as Edit/Create Branch.
- Regenerating the latest durable assistant starts a sibling response from its
  authoritative parent user node. It must not mutate or delete the existing
  assistant, clear/submit the Composer draft, or target an earlier assistant.
- Hide the durable assistant regeneration action when the conversation is
  archived, Provider is not ready, generation/recovery is already active, the
  projection is invalid, or the assistant is not the final active-path message.

## Acceptance Criteria

- [x] In `starting` and `streaming`, Composer shows one enabled `取消生成`
      action; clicking it requests exact cancellation once.
- [x] During cancellable generation, Enter does not submit, cancel, or clear
      the draft; Shift+Enter remains a newline; IME composition remains safe.
- [x] The textarea remains editable and retains its draft through active,
      finalizing, cancelled, failed, and regenerated phases, while Send remains
      disabled until an assistant leaf is appendable.
- [x] `committing` and `reconciling` expose no active Stop control.
- [x] The workspace header displays neither Generate nor Cancel generation in
      any phase.
- [x] A cancelled transient response shows partial content when present,
      `回复已停止`, and an always-visible `重新生成`; activating it starts a new
      run without altering the draft.
- [x] A writable unanswered user leaf shows `生成回复` when Provider is ready;
      activating it generates from that exact selected node without altering
      the draft.
- [x] The same user leaf shows `配置服务提供商以生成` when Provider is not
      ready; activating it opens the existing global settings dialog.
- [x] Saving Provider configuration closes or leaves the dialog according to
      existing behavior, changes the contextual action to `生成回复`, and does
      not start generation automatically.
- [x] Contextual generation/configuration actions are absent in archived,
      ineligible-node, answered-user, and transient-response states.
- [x] Existing uncommitted Composer opacity/blur changes remain present.
- [x] Behavioral tests cover accessible names, callback counts, draft and
      keyboard behavior, state transitions, header removal, contextual
      recovery, settings opening, and absence of automatic generation.
- [x] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, focused Vitest tests,
      the full `pnpm test` suite, and `pnpm build` pass.
- [x] Failed/cancelled transient `重新生成` remains always visible but matches
      the compact icon-only Edit/Create Branch button styling and accessibility.
- [x] The latest durable assistant exposes `重新生成` in its normal message
      action bar; earlier assistants and ineligible states do not.
- [x] Activating durable `重新生成` generates a sibling from the assistant's
      exact parent user once, without mutating the old response or draft.

## Out of Scope

- Automatically generating when Provider readiness changes.
- Restoring manual generation for a user node that already has an assistant
  child; this task supports contextual generation only for unanswered leaves.
- Adding cancellation confirmation, cancellation keyboard shortcuts, model
  selection in Composer, prompt queuing, or simultaneous generations.
- Redesigning provider storage, provider error handling, durable tree rules, or
  failure/reconciliation semantics.

## Key Decisions

- Composer owns only Send for the current draft and Stop for the current run.
- Recovery and first-generation actions are anchored to the message they affect.
- Contextual recovery actions are always visible rather than hover-only.
- Provider setup is explicit, and generation after setup requires another
  explicit click.
- The previous header manual-generation requirement is intentionally replaced
  by contextual unanswered-leaf generation.

## Deferred Items

- A future broader message-action redesign may unify Copy, Edit, Branch,
  Generate, and Regenerate styling across every durable and transient message.
- Editing an earlier prompt while a separate Composer draft exists keeps its
  existing behavior; draft collision policy is not changed here.
