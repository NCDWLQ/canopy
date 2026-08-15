# Keep archive action visible during generation

## Goal

Prevent the conversation header from shifting or making the archive action
appear unavailable without explanation while a reply is being generated.
Users should be able to see the archive action throughout generation and
understand that they must stop or finish the current reply before archiving.

## Background

- `ConversationWorkspace` currently renders the archive button only when
  `canMutate` is true. Active generation sets `mutationLocked`, so the button is
  removed from the DOM during the `starting` and `streaming` phases.
- The conversation store rejects archive mutations while generation is active,
  preserving the existing single-generation and persistence safety rules.

## Requirements

- Show the archive action for an editable, non-archived conversation even when
  reply generation is active.
- Disable the archive action while generation is active instead of hiding it.
- Explain the disabled state with the existing user-facing guidance to stop or
  wait for the current reply before archiving.
- Restore the enabled archive action after generation leaves its active state.
- Preserve the existing archive behavior, generation cancellation behavior,
  and archived-conversation read-only behavior.

## Acceptance Criteria

- [x] During reply generation, the conversation header still contains a visible
      archive button.
- [x] During reply generation, the archive button is disabled and cannot issue
      an archive request.
- [x] The disabled archive button communicates why archiving is unavailable.
- [x] Once generation is no longer active, the archive button is enabled again
      when the conversation is otherwise editable.
- [x] Archived conversations continue to show the read-only badge and do not
      show an archive button.
- [x] Component regression tests cover the generation-active archive state.

## Out of Scope

- Automatically canceling an active generation when the archive action is used.
- Changing backend archive validation or generation lifecycle semantics.
- Redesigning other mutation controls during generation.
