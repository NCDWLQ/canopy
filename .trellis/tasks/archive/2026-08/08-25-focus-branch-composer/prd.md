# Focus composer when branching from assistant message

## Goal

Keep the selected assistant message visible when starting a branch and use the
workspace Composer as the single input surface for the new branch message.

## Background

- `MessageNode` currently enters a component-local branching mode and replaces
  the assistant bubble content with an inline `Textarea`.
- `ConversationWorkspace` already owns both branch creation and the persistent
  bottom Composer, so it is the appropriate boundary for the selected branch
  parent and submit behavior.

## Requirements

- Clicking an eligible assistant message's “从此处创建分支” action must not
  replace, hide, or mutate that message's rendered content.
- The bottom Composer must receive keyboard focus after the branch action is
  clicked.
- Any existing Composer draft must be preserved and become the proposed branch
  message; entering branch intent must not clear or replace it.
- Merely entering branch intent must keep the current visible path unchanged,
  including every message currently rendered below the selected assistant.
- The next successful Composer submission must call branch creation with the
  clicked assistant node as the parent instead of appending to the active leaf.
- Existing edit-as-branch behavior remains unchanged.
- Branch eligibility, generation locking, archived/read-only behavior, and
  persistence semantics remain unchanged.

## Acceptance Criteria

- [x] After clicking “从此处创建分支”, the assistant content remains visible
      and no message-local branch textbox is rendered.
- [x] The bottom Composer is the focused element after the click.
- [x] Any pre-existing Composer draft is unchanged after the click.
- [x] Messages below the selected assistant remain visible until a branch is
      submitted.
- [x] Submitting non-empty Composer content creates a branch from the clicked
      assistant node with that exact content.
- [x] A successful branch submission clears the Composer using its existing
      successful-submit contract.
- [x] After the branch is created, the new branch becomes the visible path;
      the previous downstream messages remain durable and reachable through
      the conversation tree.
- [x] Completing the branch intent returns later Composer submissions to their
      normal append behavior.
- [x] Focused frontend tests, TypeScript checking, and lint pass.

## Out of Scope

- Changing edit-as-branch UX.
- Changing branch persistence or conversation-tree selection semantics.
- Redesigning Composer visuals or adding a separate inline branch editor.
