# Implement — archived conversations in Settings

All paths are relative to `/home/jwh/Code/canopy`. Implementation begins only
after final planning approval and `task.py start`.

## A. Activate and isolate development

- [ ] A1 Run the Phase 1.4 review gate and start the Trellis task.
- [ ] A2 Verify `main` is clean, then create and switch to
  `feat/archived-conversations-settings` from `main`.

## B. Add the Settings surface

- [ ] B1 Run `pnpm exec shadcn add empty`; inspect the single generated
  `src/components/ui/empty.tsx` file and confirm no existing file is changed.
- [ ] B2 Add `ArchivedConversationsPanel.tsx` under
  `src/features/settings/components/` with a narrow Settings-owned view model,
  breadcrumb header, loading/error/retry/empty/list states, localized copy,
  semantic list structure, primary open action, and grouped row menu actions.
- [ ] B3 Extend `SettingsCategory` and `SettingsDialog` with the Archived
  Conversations navigation entry and controlled panel props while preserving
  General default/reset behavior and unsaved-change guards.
- [ ] B4 Export only the intended new Settings panel types/components from the
  existing Settings component boundary.

## C. Split the workspace history projection

- [ ] C1 Derive active and archived summaries from the existing complete
  `history.summaries` projection in `ConversationWorkspace`; do not modify the
  store, client, or backend.
- [ ] C2 Render only active summaries in the sidebar and add the localized
  filtered empty state for an all-archived history.
- [ ] C3 Pass the archived list state and intent callbacks into
  `SettingsDialog`:
  - select: close Settings and load the read-only archived conversation;
  - rename: reuse `pendingRenameId` and `RenameConversationDialog`;
  - unarchive: reuse `controller.unarchiveConversation`;
  - delete: reuse `pendingDeleteId` and the existing AlertDialog;
  - retry: reuse `store.retryHistory`.
- [ ] C4 Remove now-unreachable archived badge/unarchive branches from the
  sidebar row while preserving active rename/archive/delete behavior.

## D. Localization and focused tests

- [ ] D1 Add matching `zh-CN` and `en` dictionary entries for the new category,
  breadcrumb/list labels, loading/empty copy, no-active-sidebar state, and
  accessible action names.
- [ ] D2 Add `ArchivedConversationsPanel.test.tsx` coverage for populated,
  empty, loading, retryable error, keyboard-accessible selection, and exact
  rename/unarchive/delete callback IDs.
- [ ] D3 Update `SettingsDialog.test.tsx` for the new category, controlled
  panel contract, default/reset behavior, and unsaved-change category switch.
- [ ] D4 Update `ConversationWorkspace.test.tsx` to prove:
  - archived rows are absent from sidebar history while active rows remain;
  - all-archived history shows the active-list empty state and keeps New
    Conversation available;
  - Settings lists only archived rows;
  - selecting an archived row closes Settings and loads read-only content;
  - rename, unarchive, and delete reuse the existing command/confirmation
    paths and move/remove rows after authoritative results;
  - history error/retry behavior remains reachable.

## E. Validation and review

- [ ] E1 Format changed files with the repository formatter.
- [ ] E2 Run focused tests:
  `pnpm test -- src/features/settings/components/ArchivedConversationsPanel.test.tsx src/features/settings/components/SettingsDialog.test.tsx src/features/conversations/components/ConversationWorkspace.test.tsx`.
- [ ] E3 Run `pnpm lint` and `pnpm typecheck`.
- [ ] E4 Run the full frontend gate `pnpm check`.
- [ ] E5 Review the diff for feature-boundary violations, duplicated mutation
  logic, hard-coded copy, grouped dropdown composition, focus/keyboard
  behavior, and accidental generated-file overwrites.
- [ ] E6 Manually smoke test in both locales: mixed history, all active, all
  archived, open archived read-only, rename, unarchive, delete confirmation,
  error/retry, Settings reopen/reset, and sidebar collapse/reopen.

## Risk and rollback points

- `ConversationWorkspace.tsx` is large and interaction-dense. Keep the history
  projection/wiring change isolated from unrelated message/panorama behavior.
- `SettingsDialogProps` is widely instantiated in tests. Type-check before the
  full suite to catch every required fixture update quickly.
- The generated Empty primitive must be additive. Stop if the CLI proposes an
  overwrite or dependency change outside the expected file.
- No persistence changes exist; rollback is a normal branch revert.
