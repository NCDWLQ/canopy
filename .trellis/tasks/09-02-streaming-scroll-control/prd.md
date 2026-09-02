# Preserve user scroll position during streaming

## Goal

Let a user read earlier messages while the assistant is streaming without the
next content delta forcing the conversation pane back to the bottom, while
retaining convenient live-edge following for users who remain at the bottom
and providing an explicit way to return to the latest content.

## Background

- `ConversationPane` currently reruns its bottom-scroll effect whenever
  transient content grows and unconditionally calls `scrollIntoView` while the
  pane status is `ready` or `streaming`
  (`src/features/conversations/components/ConversationPane.tsx:206`).
- The current component test explicitly expects every streaming content delta
  to scroll to the bottom
  (`src/features/conversations/components/ConversationPane.test.tsx:346`).
- A previous regression fix replaced `path` identity with a stable tail-content
  key so background streaming in another conversation could not pin the active
  pane. That invariant must remain intact.
- The pane is an existing native WebKitGTK scroll surface with search/Panorama
  reveal behavior and reduced-motion handling that must not regress.

## Requirements

- R1. While the viewport is at the live edge, assistant streaming updates keep
  following the growing response.
- R2. When the user scrolls upward far enough to leave the live edge, later
  streaming updates preserve the user's reading position instead of forcing a
  bottom scroll.
- R3. When the user returns to the live edge, streaming follow resumes for
  later updates.
- R4. When the user is away from the live edge, show a circular icon button
  containing a downward arrow. Clicking it scrolls to the latest content and
  resumes live-edge following.
- R5. The icon-only button has a localized accessible name, visible keyboard
  focus, and reduced-motion-safe transitions. It stays hidden and
  non-interactive while the viewport is already at the live edge.
- R6. Initial/path navigation bottom positioning, stable-path protection
  against background deltas, search/Panorama reveal ownership, and
  reduced-motion behavior remain unchanged.
- R7. Keep scroll-follow state local to the conversation surface rather than
  duplicating it in the global conversation store.

## Acceptance Criteria

- [ ] AC1. Given an active streaming response and a viewport at the bottom,
  growing transient content scrolls to the latest content.
- [ ] AC2. Given the user has scrolled above the bottom during streaming,
  growing transient content does not call the bottom-scroll path or change the
  user's reading position.
- [ ] AC3. After the user scrolls back to the bottom, the next streaming update
  follows the latest content again.
- [ ] AC4. The circular down-arrow button appears only while the viewport is
  away from the bottom; activating it moves to the bottom, hides the control,
  and re-enables streaming follow.
- [ ] AC5. The button is keyboard-operable and exposes localized `zh-CN` and
  English accessible text without relying on the icon for meaning.
- [ ] AC6. Rebuilding an unchanged message path, revealing a search/Panorama
  target, and honoring `prefers-reduced-motion` retain their existing behavior.
- [ ] AC7. Focused component regression tests, frontend lint, and TypeScript
  checks pass.

## Out of Scope

- Redesigning message bubbles, message rows, or the composer.
- Adding unread counts, badges, or other new controls around the jump button.
- Changing generation state, message persistence, branch navigation, or
  background-stream handling.
