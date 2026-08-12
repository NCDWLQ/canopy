# Refactor Sidebar and Global Settings

## Goal

Give workspace-wide configuration a stable home by adding a global settings
entry to the bottom of the conversation sidebar and moving Provider
configuration out of the conversation header into that settings experience.

## Background

- The current workspace renders history and the conversation outline in a
  collapsible sidebar owned by `ConversationWorkspace`.
- `ProviderSettingsDialog` is currently triggered from the right side of the
  conversation header even though Provider configuration applies to the whole
  workspace rather than the selected conversation.
- The project has no router or existing global settings shell. The existing
  Provider editor already uses a modal dialog and owns secret-clearing,
  read-only, generation-active, save, and delete behavior.

## Requirements

- Add a visually persistent global settings entry in a footer area at the
  bottom of the expanded sidebar.
- Style the Settings entry as a low-emphasis ghost navigation action with
  muted default text and foreground emphasis on hover, consistent with the
  sidebar's other actions.
- Remove the Provider entry from the conversation header.
- Activating Settings opens a modal global settings surface whose initial
  content is a Provider section. The structure may support future categories,
  but no additional categories are part of this task.
- Make Provider configuration accessible only through that global settings
  surface rather than through a second duplicate trigger.
- Preserve all existing Provider profile behavior, including credential
  handling, validation, save/delete actions, loading/error states, archive
  read-only behavior, and the generation-active mutation lock.
- Keep the sidebar collapse control and existing conversation actions working.
- Use accessible names and interaction semantics for the new settings entry
  and settings surface.

## Acceptance Criteria

- [ ] When the sidebar is expanded, a Settings action is visible at its bottom
      independently of history/tree scroll content.
- [ ] The Settings action uses the sidebar's flat ghost treatment rather than
      a bordered outline treatment, with muted default text and foreground
      hover emphasis.
- [ ] Activating Settings opens the global settings surface and exposes the
      Provider configuration within it.
- [ ] The conversation header no longer contains a Provider settings action.
- [ ] Existing Provider save, replacement, API-key removal, delete, error,
      read-only, and generation-active behaviors remain available through the
      new location.
- [ ] Collapsing and reopening the sidebar does not break the Settings action
      or workspace layout.
- [ ] Focus, labels, and keyboard activation remain testable through semantic
      roles and accessible names.
- [ ] Relevant component tests, lint, type-check, and build pass.

## Out of Scope

- Adding new non-Provider preference categories or persistence contracts.
- Changing Provider IPC, native credential storage, or generation behavior.
- Introducing application routing solely for settings.

## Key Decisions

- Global settings uses a modal dialog rather than a dedicated workspace view.
- The sidebar owns the single global Settings trigger; Provider is presented
  as content within the settings dialog.
- This is a lightweight frontend refactor with no backend or persistence
  contract change.
