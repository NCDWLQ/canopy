# Move archive action to history row with hover reveal and confirm dialog

## Goal

Replace the header "归档" outline button with a per-row archive action in the
sidebar history list. Each non-archived conversation row reveals an icon-only
ghost button on the right side when hovered (or keyboard-focused). Archiving is
guarded by an AlertDialog confirmation; confirming on the currently generating
conversation interrupts that generation first.

## Background

- Today the only archive entry point is a header button
  (`ConversationWorkspace.tsx:478-493`), gated by `canEditDraft` and disabled
  while `controller.mutationLocked`.
- The store's `archiveConversation` only archives the *currently selected*
  conversation (`state.conversationId`), although the Tauri command accepts any
  ID and the Rust service applies no generation guard.
- Each history row is currently a single `<Button>`; nesting the new icon
  button inside it would produce invalid HTML (`<button>` inside `<button>`).

## Requirements

### R1 — Row structure (valid HTML)
- Each history `<li>` becomes a `group relative` container holding two sibling
  buttons: the existing select button (title + archived badge, tooltip,
  `aria-current`, current disable semantics unchanged) and the new archive icon
  button positioned at the right edge of the row.
- No `<button>` nesting anywhere in the row.

### R2 — Hover-reveal archive button
- Icon-only ghost button: `Archive` icon, size-7, `text-muted-foreground`
  becoming `text-foreground` on hover, revealed via
  `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` with an
  opacity transition (no layout shift).
- Accessible name: `aria-label="归档"` (+ title / tooltip).
- Rendered only on rows whose summary is **not** archived. Archived rows keep
  the existing "已归档" badge and get no button.
- The button is enabled regardless of generation state (interruption is
  handled at confirm time, not by disabling).

### R3 — Confirmation dialog
- Clicking the row archive button opens the existing shadcn `AlertDialog`
  ("归档会话？"). No side effect occurs on click.
- Base description: "归档后会话转为只读，并在历史记录中标记为已归档。"
- When the pending target is the conversation with an active generation at
  confirm time, the description additionally warns "归档将打断正在进行的生成。"
- Cancel closes the dialog with no state change; generation (if any) is
  untouched.
- Dialog content must state the target conversation title.

### R4 — Confirm-time semantics
- Confirm archives the pending target by ID.
- If the target is the currently selected conversation **and** its generation
  is active (`starting` / `streaming`), cancel the generation first, then
  archive. Clicking the button itself must never interrupt anything.
- Archiving any other row during an active generation must not disturb that
  generation.
- If the target finished generating between opening the dialog and confirming,
  no interruption happens — decide by the generation state at confirm time.

### R5 — Store semantics (archive by ID)
- `archiveConversation` accepts an optional target conversation ID (defaults
  to the current conversation).
- Guards: skip when the target is already archived; the legacy
  `status !== "ready"` / `isGenerationActive` early-returns no longer blanket-
  block archiving.
- Archiving a non-current row must not touch the global conversation `status`
  (no sidebar-wide disabling) — it only upserts the history summary.
- Archiving the current row keeps existing behaviour: `isArchived: true`,
  tree-integrity verification, summary upsert.
- Success in either case upserts the target history summary with
  `isArchived: true`.

### R6 — Header cleanup
- The header "归档" button block (`ConversationWorkspace.tsx:478-493`) is
  removed entirely.
- The "已归档 — 只读" badge in the header stays (state indicator, not an
  entry point).

## Constraints

- Frontend-only; no Rust/Tauri command changes (backend already supports
  archiving by ID with no generation guard).
- Follow the established hover-reveal pattern from `MessageBubble.tsx`
  (`group-hover` / `group-focus-within` opacity).
- Reuse the existing `controller.cancel()` path for interruption (the store's
  `cancelGenerationRun` flips generation phase synchronously to `cancelled`).

## Acceptance Criteria

- [ ] Hovering a non-archived history row reveals an archive icon button on
      its right side; archived rows show only the badge.
- [ ] The row markup contains sibling buttons, no nested `<button>`.
- [ ] Clicking the icon opens the AlertDialog; nothing changes until
      confirmed; cancel leaves all state (including any generation) intact.
- [ ] Confirming on a generating current conversation cancels the generation
      and archives it; confirming on any other row during generation archives
      without disturbing the generation.
- [ ] The header archive button is gone; the read-only badge remains.
- [ ] Archiving a non-current row does not flip the global conversation
      `status` (sidebar rows stay enabled).
- [ ] Updated/added tests cover: dialog confirm/cancel flows, archive-by-ID
      (current / non-current / already-archived), confirm-time interruption,
      and header-button removal.
- [ ] `pnpm lint`, type-check, and the conversation feature test suite pass.
