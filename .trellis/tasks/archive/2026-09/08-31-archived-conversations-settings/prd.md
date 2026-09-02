# Move archived conversations to settings

## Goal

Keep the everyday sidebar history focused on active conversations while
preserving a discoverable place to find and manage archived conversations in
Settings.

## Background and Confirmed Facts

- The sidebar currently renders every history summary, including archived
  conversations, in one list.
- Archived conversations remain readable but are read-only.
- Existing conversation management already supports rename, permanent delete,
  and unarchive; archived rows currently expose those actions from the sidebar.
- Settings uses a category navigation layout with General, Appearance, Model
  Providers, and Conversations panels.
- Conversation history is already held in the shared conversation store, so the
  requested information is available without changing persistence semantics.

## Requirements

1. The sidebar history must display only non-archived conversations.
2. Settings must add a dedicated Archived Conversations category and panel.
3. The archived panel must display only archived conversations and have clear
   loading, empty, error, and populated states.
4. Selecting an archived conversation in the panel must close Settings and
   open that conversation in the workspace in its established read-only mode.
5. Each archived row must retain the existing rename, unarchive, and permanent
   delete actions, including the existing delete confirmation behavior.
6. Archiving a conversation must remove it from the sidebar and make it appear
   in the archived panel without requiring an application restart.
7. Unarchiving a conversation must remove it from the archived panel and return
   it to the sidebar without requiring an application restart.
8. Existing archived-conversation read-only and persistence behavior must remain
   unchanged.
9. New user-visible copy must be available in both Simplified Chinese and
   English.
10. The work must be developed on a new branch created from the current clean
   `main` branch.

## Out of Scope

- Changing database archive semantics or adding migrations.
- Changing full-text search behavior; archived conversations remain searchable.
- Adding archive retention, bulk actions, sorting controls, or filtering beyond
  the active/archived separation requested here.
- Redesigning unrelated Settings categories or conversation management flows.

## Key Decisions

- Archived Conversations is a dedicated Settings category, not a subsection of
  the existing global Conversations preferences panel.
- The panel preserves the complete existing archived-row interaction set:
  open read-only content, rename, unarchive, and permanent delete.
- The complete history projection remains in the conversation store; active
  and archived lists are derived only at the view boundary.
- The change is frontend-only and preserves search, persistence, and archive
  read-only semantics.
- The implementation uses a narrow Settings-owned view model and callbacks so
  `features/settings` does not depend on `features/conversations`.

## Acceptance Criteria

- [ ] Given active and archived conversations, the sidebar lists every active
  conversation and no archived conversation.
- [ ] Settings navigation includes an Archived Conversations category whose
  panel lists every archived conversation and no active conversation.
- [ ] Selecting a listed archived conversation closes Settings and opens its
  read-only workspace.
- [ ] Every archived row offers rename, unarchive, and permanent delete using
  the established confirmation and error behavior.
- [ ] With no archived conversations, the archived panel shows a localized
  empty state.
- [ ] Archive and unarchive mutations immediately move the affected
  conversation between the sidebar and archived panel.
- [ ] Archived conversations retain their established read-only behavior.
- [ ] History load/retry failures remain visible and actionable in whichever
  surface owns the affected list.
- [ ] Focus, button names, category selection, and list semantics remain usable
  by keyboard and assistive technology.
- [ ] Existing and new focused frontend tests, lint, type-check, and formatting
  checks pass.
