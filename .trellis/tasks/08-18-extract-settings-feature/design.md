# Design: Extract settings feature

## Architecture

```text
features/settings/components/
  SettingsDialog.tsx                  # dialog shell + category selection
  SettingsDialog.test.tsx             # shell, navigation, reset, wiring
  ConversationSettingsPanel.tsx       # global conversation preferences
  ConversationSettingsPanel.test.tsx
  index.ts                            # deliberate public export

features/providers/components/
  ProviderSettingsPanel.tsx           # list/detail controller
  ProviderSettingsList.tsx            # list + default/delete actions
  ProviderSettingsEditor.tsx          # draft + API key + models + save
  ProviderSettingsPanel.test.tsx       # migrated provider behavior suite
```

The dependency graph is intentionally one-way:

```text
ConversationWorkspace
  └─ SettingsDialog (features/settings)
       ├─ ConversationSettingsPanel (features/settings)
       │    └─ useProviderStore + ProviderClient
       └─ ProviderSettingsPanel (features/providers)
            └─ useProviderStore + ProviderClient
```

`features/settings` must not import `features/conversations`. The conversation
category represents global conversation preferences inside the settings
surface; it does not render or mutate conversation-tree state.

## State ownership

Each state value has one owner.

| State | Owner | Reset boundary |
|-------|-------|----------------|
| controlled/uncontrolled `open` | `SettingsDialog` | caller or trigger |
| `category` | `SettingsDialog` | reset to `providers` on every open |
| provider `view` (`list` / `edit`) | `ProviderSettingsPanel` | panel remount |
| `selectedProviderId` | `ProviderSettingsPanel` | return to list / panel remount |
| pending list deletion | `ProviderSettingsList` | dialog close / list unmount |
| provider draft / API key / models | `ProviderSettingsEditor` | editor unmount or provider change |
| title setting values | `useProviderStore` | durable store / IPC behavior unchanged |

`SettingsDialog` remounts the active provider panel for each dialog-open
session and unmounts it when switching to **会话**. This provides an explicit
reset boundary without imperative refs or shared ownership.

## Component contracts

### `SettingsDialog`

```ts
type SettingsDialogProps = {
  client: ProviderClient
  readOnly: boolean
} & (
  | { open?: never; onOpenChange?: never }
  | { open: boolean; onOpenChange: (open: boolean) => void }
)
```

- Retains the sidebar `DialogTrigger` button（「设置」）for both existing
  controlled and uncontrolled call sites.
- Owns only dialog chrome, left category navigation, category selection, and
  category-session reset.
- Observe the resolved `open` value (not only `onOpenChange` callbacks): on
  every false → true transition, select `providers` and start a fresh panel
  session. This also covers contextual entry points that update a controlled
  `open` prop directly.
- On close: unmount panel-local sensitive/ephemeral state and clear category
  session state.
- Renders **模型提供商** (`Bot`) and **会话** (`MessageSquare`).
- Supplies the right-column container; each panel renders its category/nested
  breadcrumb and body so nested provider navigation remains provider-owned.

### `ProviderSettingsPanel`

```ts
type ProviderSettingsPanelProps = {
  client: ProviderClient
  readOnly: boolean
}
```

- Owns the provider route: `{ view: "list" }` or
  `{ view: "edit"; providerId: string | null }`.
- List row / 新建 transitions to edit; breadcrumb back and 取消 return to list.
- Successful save stays on the editor with the returned provider snapshot.
- Delegates all list mutations to `ProviderSettingsList` and all form state to
  `ProviderSettingsEditor`.
- Renders the provider breadcrumb so its nested route has one owner.

### `ProviderSettingsList`

- Reads provider list, active provider id, phase, and list mutation actions
  from `useProviderStore`.
- Owns set-default, pending-delete confirmation, deletion, summary rendering,
  and accessible disabled reasons.
- Reports only navigation intent through
  `onEdit(providerId: string | null)`.
- Delete success remains on the list; the active/default provider cannot be
  deleted.

### `ProviderSettingsEditor`

- Receives a stable `providerId: string | null` plus `onBack`.
- Owns the draft, API-key reveal/keep/replace/remove state, show/hide state,
  model fetch/add/remove state, store-error/readOnly alerts, and save handler.
- Uses an editor-local request identity/cancelled guard so a late API-key
  reveal cannot update an unmounted editor or a different provider.
- Successful save refreshes the draft from the returned provider and remains
  in the editor. The breadcrumb label follows the current draft name.
- It does not own provider deletion; deletion remains a list action, matching
  current behavior.

### `ConversationSettingsPanel`

- Lives in `features/settings/components` because it is a category of the
  global settings surface and currently has no conversation-store dependency.
- Reads/writes `autoGenerateTitle` and `titleModelBinding` through
  `useProviderStore` and `ProviderClient`.
- Uses provider models only to populate title-model options.
- Renders the unchanged `设置 / 会话` breadcrumb and category body.

## Reset and sensitive-state behavior

```text
resolved open false → true
  → category = providers
  → new provider panel session

providers → conversation
  → ProviderSettingsPanel unmounts
  → editor draft, revealed key, fetched models, and pending delete disappear

close dialog
  → active category panel unmounts
  → no revealed API key survives in React state

reopen dialog
  → providers list, never the previous editor/category
```

No provider secret enters Zustand or another durable frontend store.

## Migration / compatibility

| From | To |
|------|----|
| `features/providers/components/GlobalSettingsDialog.tsx` | deleted after extraction |
| dialog shell/category state | `features/settings/components/SettingsDialog.tsx` |
| conversation preference body | `features/settings/components/ConversationSettingsPanel.tsx` |
| provider list/detail coordination | `features/providers/components/ProviderSettingsPanel.tsx` |
| provider list mutations | `features/providers/components/ProviderSettingsList.tsx` |
| provider draft/key/model/save | `features/providers/components/ProviderSettingsEditor.tsx` |
| providers barrel settings export | removed |
| `ConversationWorkspace` import | `@/features/settings/components` |

The rename is breaking for internal imports only; no persisted user data or
IPC contract changes.

## Test migration matrix

Every existing `GlobalSettingsDialog.test.tsx` case must move before the old
file is removed.

| Existing behavior | New owner |
|-------------------|-----------|
| open, category nav, accessible dialog, provider-list landing | `SettingsDialog.test.tsx` |
| automatic-title controls | `ConversationSettingsPanel.test.tsx` |
| provider model summary | `ProviderSettingsPanel.test.tsx` (list) |
| save refreshes draft | `ProviderSettingsPanel.test.tsx` (editor) |
| API key reveal/show/keep | `ProviderSettingsPanel.test.tsx` (editor) |
| API key replace | `ProviderSettingsPanel.test.tsx` (editor) |
| API key remove and failed-reveal keep | `ProviderSettingsPanel.test.tsx` (editor) |
| fetch/add model | `ProviderSettingsPanel.test.tsx` (editor) |
| fetched display-name model uses id | `ProviderSettingsPanel.test.tsx` (editor) |
| archived readOnly | `ProviderSettingsPanel.test.tsx` (editor) |
| breadcrumb back | `ProviderSettingsPanel.test.tsx` |
| cancel new provider | `ProviderSettingsPanel.test.tsx` |
| cancel edited provider / discard draft | `ProviderSettingsPanel.test.tsx` |
| set global default | `ProviderSettingsPanel.test.tsx` (list) |
| disabled default-provider actions and reasons | `ProviderSettingsPanel.test.tsx` (list) |
| delete confirmation and success | `ProviderSettingsPanel.test.tsx` (list) |

Add explicit regression cases for:

- controlled and uncontrolled opening;
- reopen/category-switch reset and secret cleanup;
- late API-key reveal after editor unmount/provider change;
- provider store error alert;
- all three contextual entry points through `ConversationWorkspace`.

## Spec updates

Update:

- `.trellis/spec/frontend/directory-structure.md` — add
  `features/settings/` and remove settings-shell ownership from providers.
- `.trellis/spec/frontend/component-guidelines.md` — document the one-way
  settings composition boundary and provider panel state ownership.

## Trade-offs

- **Conversation panel under settings**: this gives up a literal
  conversation-feature folder for a global preference panel, but avoids a
  feature dependency cycle and matches its actual store/IPC dependencies.
- **Provider controller plus list/editor**: one additional component makes
  state ownership explicit and prevents the shell from reaching into provider
  drafts through refs/callback synchronization.
- **Panel-owned breadcrumbs**: duplicates a small amount of header composition
  but keeps nested navigation with its owning state machine.
- **Keep title settings in provider store**: avoids backend/IPC churn; a later
  task may introduce a neutral settings store if more non-provider preferences
  appear.

## Development worktree

The worktree and branch already exist:

```text
/home/jwh/Code/canopy-extract-settings
feat/extract-settings-feature (base: main)
```

Do not rerun `git worktree add` or copy a second task directory during
implementation. Before `task.py start`, synchronize the reviewed planning
artifacts once; after start, edit and commit only in the linked worktree.

## Rollback

Revert the settings feature extraction and restore
`GlobalSettingsDialog.tsx` plus its test. No migration or persistence rollback
is required.
