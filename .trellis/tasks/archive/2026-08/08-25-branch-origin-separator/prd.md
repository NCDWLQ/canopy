# Show branch origin separator

## Goal

Make the pending branch boundary visually explicit: after the user chooses an
assistant message as the branch origin, show only the path through that message
and mark where the new branch will begin.

## Background

- The existing branch-to-Composer flow preserves and focuses the Composer draft
  and keeps branch intent in `ConversationWorkspace`.
- It currently continues rendering downstream messages until branch submission.
- The project already ships the shadcn `Marker` primitive; its `separator`
  variant is the established labeled-divider treatment for chat content.

## Requirements

- Clicking an eligible assistant message's “从此处创建分支” action must keep
  that assistant and its ancestors visible while hiding every later message in
  the current message pane.
- Immediately below the selected assistant, render a labeled separator with the
  localized text “由此处创建分支” (`Branch from here` in English) and a
  branch icon.
- The conversation tree and durable normalized tree remain unchanged; hidden
  downstream messages must remain available when the branch intent is cleared
  or through normal tree navigation.
- Preserve the current Composer behavior: retain any draft, focus the input,
  enable branch submission, keep intent/draft after creation failure, and clear
  intent after success or conversation/blank-context navigation.
- The separator and truncated presentation exist only while branch intent is
  pending. Successful creation replaces them with the new authoritative branch
  path.

## Acceptance Criteria

- [x] Clicking “从此处创建分支” hides all messages after the selected assistant
      without changing or deleting those nodes in the store/tree.
- [x] A visible labeled separator reading “由此处创建分支” appears immediately
      after the selected assistant and uses the installed shadcn chat marker
      separator treatment with a branch icon.
- [x] The Composer draft is unchanged, the Composer receives focus, and Send
      creates a branch from the selected assistant.
- [x] Failed branch creation preserves the truncated path, separator, target,
      and Composer draft for retry.
- [x] Successful branch creation removes the pending separator, displays the
      authoritative new branch, and returns later Composer sends to append mode.
- [x] Switching conversations or entering a blank conversation removes the
      pending separator/target while retaining the Composer draft contract.
- [x] Normal tree navigation clears the pending separator/target and restores
      the selected full path without clearing the Composer draft.
- [x] Chinese and English copy remain typed and covered by component tests.
- [x] Full frontend tests, lint, type checking, formatting, and diff checks pass.

## Out of Scope

- Deleting, collapsing, or re-parenting downstream durable messages.
- Changing the conversation tree's active selection before branch submission.
- Adding a cancel button or redesigning the Composer.
