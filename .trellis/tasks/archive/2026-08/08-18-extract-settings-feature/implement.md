# Implement: Extract settings feature

## Environment status

- [x] Branch `feat/extract-settings-feature` exists from `main`.
- [x] Linked worktree exists at `/home/jwh/Code/canopy-extract-settings`.
- [x] Planning task directory exists in both worktrees.
- [x] Reviewed planning artifacts synchronized to the linked worktree.
- [x] User explicitly approved the revised final planning summary.

Do not rerun `git worktree add` or copy the task directory during
implementation. After approval and synchronization, run `task.py start` from
the linked worktree and treat that copy as authoritative.

## Checklist

1. [x] In the linked worktree, create
      `features/settings/components/SettingsDialog.tsx` with Dialog chrome,
      left category navigation, controlled/uncontrolled open handling, and a
      fresh category-panel session on every resolved `open` false → true
      transition (including caller-driven controlled opens).
2. [x] Add
      `features/providers/components/ProviderSettingsPanel.tsx` as the sole
      owner of provider list/detail route and selected provider id.
3. [x] Extract `ProviderSettingsList.tsx`; keep model summaries, 新建,
      set-default, accessible disabled reasons, pending-delete confirmation,
      and delete behavior in the list.
4. [x] Extract `ProviderSettingsEditor.tsx`; keep draft, save, API-key
      reveal/keep/replace/remove, stale reveal protection, model fetch/add/
      remove, error, readOnly, breadcrumb label, and cancel/back behavior in
      the editor.
5. [x] Add
      `features/settings/components/ConversationSettingsPanel.tsx`; preserve
      auto-title switch/model binding behavior and do not import anything from
      `features/conversations`.
6. [x] Wire `ProviderSettingsPanel` and `ConversationSettingsPanel` into
      `SettingsDialog`; switching category or closing/reopening must unmount
      and reset panel-local state.
7. [x] Add `features/settings/components/index.ts` exporting
      `SettingsDialog` / `SettingsDialogProps`; update
      `ConversationWorkspace` to use that public API.
8. [x] Remove `GlobalSettingsDialog.tsx`, its test, and the providers barrel
      export only after all behavior cases below have migrated.
9. [x] Migrate tests using the behavior matrix in `design.md`:
      - shell/open/category/reset → `SettingsDialog.test.tsx`
      - conversation preferences → `ConversationSettingsPanel.test.tsx`
      - provider list/editor flows → `ProviderSettingsPanel.test.tsx`
      - contextual entry points → `ConversationWorkspace.test.tsx`
10. [x] Add explicit regressions for store errors, controlled/uncontrolled
       opening, reopen/category reset, secret cleanup, and stale API-key reveal.
11. [x] Update `.trellis/spec/frontend/directory-structure.md` and
       `component-guidelines.md` for the settings boundary and state ownership.
12. [x] Run dependency searches, focused tests, and the full frontend gate.

## Existing behavior migration gate

Do not delete `GlobalSettingsDialog.test.tsx` until each of its 16 cases has a
passing destination test:

- [x] open/category nav/provider-list landing
- [x] automatic-title settings
- [x] long provider model summary
- [x] saved draft refresh
- [x] API-key reveal/show/keep
- [x] API-key replace
- [x] API-key remove + failed-reveal keep
- [x] fetched model add
- [x] display-name model uses id
- [x] archived readOnly
- [x] breadcrumb back
- [x] cancel new provider
- [x] cancel edited provider and discard draft
- [x] set global default
- [x] disabled default-provider actions/reasons
- [x] delete confirmation/success

## Validation

```bash
# Expected: no matches
rg -n "GlobalSettingsDialog" src

# Expected: no matches
rg -n 'features/conversations' src/features/settings

pnpm exec vitest run src/features/settings/components/SettingsDialog.test.tsx
pnpm exec vitest run src/features/settings/components/ConversationSettingsPanel.test.tsx
pnpm exec vitest run src/features/providers/components/ProviderSettingsPanel.test.tsx
pnpm exec vitest run src/features/conversations/components/ConversationWorkspace.test.tsx
pnpm check
```

## Risky files / rollback

| Area | Risk | Mitigation |
|------|------|------------|
| Provider editor extraction | Lost API-key semantics or stale reveal writes | Keep editor state local; migrate all key cases and add unmount race test |
| Panel reset boundaries | Revealed secrets/drafts survive category or reopen | Remount provider panel per open session; test switch/close/reopen |
| Provider list extraction | Delete/default actions move to wrong owner | Keep both in `ProviderSettingsList`; migrate accessible action tests |
| `ConversationWorkspace` wiring | Contextual open paths regress | Keep controlled `open` API and rerun workspace integration tests |
| Cross-feature imports | settings ↔ conversations cycle | `rg` gate: settings must have no conversations import |

Rollback = revert the new settings/provider components and restore
`GlobalSettingsDialog` plus its test. No data migration is involved.

## Before `task.py start`

- [x] `prd.md` converged after architecture review
- [x] `design.md` has one-way dependencies and single state owners
- [x] `implement.md` contains the 16-case migration gate
- [x] `implement.jsonl` / `check.jsonl` curated
- [x] Worktree setup already complete; stale creation steps removed
- [x] Revised artifacts synchronized to linked worktree
- [ ] User explicit approval of this revised final planning summary
