# Extract settings feature and rename SettingsDialog

## Goal

Move the global settings dialog out of the providers feature into a dedicated
`features/settings` module, rename `GlobalSettingsDialog` to `SettingsDialog`,
and split provider editing from the dialog shell so new settings categories can
land without making conversations depend on provider-owned UI.

## Background

- `GlobalSettingsDialog` is a 995-line component at
  `src/features/providers/components/GlobalSettingsDialog.tsx` and its 16
  behavior tests live in a 537-line colocated test file.
- The dialog now hosts two global settings categories: **模型提供商** and
  **会话**, so its shell is no longer provider-specific.
- `ConversationWorkspace` imports the dialog from
  `@/features/providers/components`, creating an avoidable conversations →
  providers UI dependency.
- UI copy and tests already refer to the surface as「设置」; the `Global`
  prefix is stale and only distinguished workspace-wide settings from
  per-conversation provider bindings at the time of naming.
- `autoGenerateTitle` / `titleModelBinding` remain in `useProviderStore`
  because backend settings load through the provider IPC surface; this task
  does not change that data contract.
- Putting `ConversationSettingsPanel` under `features/conversations` while
  `ConversationWorkspace` imports `SettingsDialog` would create the feature
  dependency cycle conversations → settings → conversations. The global
  conversation-preference panel therefore belongs to the settings feature in
  this refactor.

## Requirements

1. Introduce `src/features/settings/components/SettingsDialog.tsx` as the
   modal shell. It owns Dialog chrome, the left category nav, controlled /
   uncontrolled `open`, category selection, and open/close category reset.
2. Rename the public component from `GlobalSettingsDialog` to
   `SettingsDialog`; remove the old export/name with no compatibility alias.
3. Extract provider settings into provider-owned components under
   `src/features/providers/components/`:
   - `ProviderSettingsPanel` owns provider list/detail navigation and the
     selected provider id.
   - `ProviderSettingsList` owns list actions, set-default, and delete
     confirmation state.
   - `ProviderSettingsEditor` owns the provider draft, API-key reveal state,
     model fetching/editing, and save flow.
4. Extract the global conversation-preference category to
   `src/features/settings/components/ConversationSettingsPanel.tsx`. It may
   use `useProviderStore` and `ProviderClient`, but `features/settings` must
   not import from `features/conversations`.
5. Update `ConversationWorkspace` and tests to import `SettingsDialog` from
   `@/features/settings/components`. No settings UI may continue to be
   imported from `@/features/providers/components`.
6. Preserve all existing settings behavior:
   - entry points: sidebar footer trigger, composer CTA, provider picker
     manage action
   - provider list/detail navigation, live breadcrumb labels, save/delete,
     API-key reveal/keep/replace/remove and stale-result protection, model
     list fetch/add/remove, set default
   - conversation auto-title switch and title-model select
   - controlled/uncontrolled opening, reopen/category reset, archive
     `readOnly`, loading-disabled mutations, store error alerts, and accessible
     names/reasons
7. Migrate all 16 existing `GlobalSettingsDialog` behavior tests before
   deleting the old test file, and add focused coverage for store errors,
   reopen/category reset, and stale API-key reveal results where coverage is
   currently implicit or absent.
8. Update frontend spec docs that still describe settings as owned by
   `features/providers/components/`.

## Acceptance Criteria

- [ ] `features/settings/components/SettingsDialog.tsx` exists and exports
      `SettingsDialog` / `SettingsDialogProps`.
- [ ] `GlobalSettingsDialog` and its export are removed; `rg
      "GlobalSettingsDialog" src` returns no matches.
- [ ] `ProviderSettingsPanel`, `ProviderSettingsList`, and
      `ProviderSettingsEditor` live under `features/providers/components/`
      with the state ownership defined in Requirement 3.
- [ ] `ConversationSettingsPanel` lives under `features/settings/components/`
      and preserves the existing **会话** settings behavior.
- [ ] `features/settings` has no import from `features/conversations`; the
      dependency direction is conversations → settings → providers.
- [ ] `ConversationWorkspace` opens the same settings surface through
      `SettingsDialog` with unchanged user-visible copy and entry points.
- [ ] All 16 existing dialog behavior tests have an explicit migrated owner;
      API-key flows, models, save/delete, default-provider actions, readOnly,
      auto-title, controlled opening, reset, error, and accessibility behavior
      remain covered.
- [ ] Frontend spec docs reflect `features/settings` ownership for the dialog
      shell and global preference categories.
- [ ] `pnpm check` passes.

## Out of Scope

- Backend / IPC / persistence changes.
- Moving `autoGenerateTitle` / `titleModelBinding` out of `useProviderStore`.
- Introducing an app-level settings host, render-slot API, or settings store.
- New settings categories beyond the existing two.
- Settings routing / URL sync.
- Copy migration for workspace/composer「服务提供商」strings outside the
  dialog.
- Dirty-state guards when leaving provider edit without saving.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Shell location | `features/settings/components/SettingsDialog` |
| Public name | `SettingsDialog` (retire `GlobalSettingsDialog`) |
| Shell state | Dialog open + top-level category only |
| Provider navigation state | `ProviderSettingsPanel` owns view + selected id |
| Provider edit state | `ProviderSettingsEditor` owns draft/key/models/save |
| Provider list mutation state | `ProviderSettingsList` owns default/delete actions |
| Conversation panel ownership | `features/settings/components/` to keep the feature graph acyclic |
| Store / IPC | Keep title settings in `useProviderStore` for this task |
| Compatibility alias | None; rename in one pass |
| Modal vs route | Remain modal |
| Development isolation | Existing worktree on `feat/extract-settings-feature` |

## Development Environment

- Worktree setup is already complete.
- Worktree path: `/home/jwh/Code/canopy-extract-settings`.
- Branch: `feat/extract-settings-feature` (base `main`).
- Main worktree (`/home/jwh/Code/canopy`) stays on `main`; no product-code
  changes land there.
- Planning artifacts are mirrored into the linked worktree before task start;
  after start, the linked-worktree copy is authoritative for implementation.
