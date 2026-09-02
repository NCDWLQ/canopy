# Design — archived conversations in Settings

## 1. Scope and boundaries

Implement the requested separation entirely in the frontend. SQLite remains
the durable authority, the conversation store keeps one complete ordered
history projection, and existing typed client/store/controller mutations remain
unchanged.

The feature dependency direction stays:

```text
ConversationWorkspace (conversation state + commands)
  -> SettingsDialog (modal shell + category navigation)
     -> ArchivedConversationsPanel (narrow view model + intent callbacks)
```

`features/settings` must not import from `features/conversations`. The workspace
projects conversation-owned state into settings-owned display data.

## 2. View model and data flow

`ConversationWorkspace` derives two arrays from `history.summaries`:

- `activeSummaries`: `isArchived === false`; the sidebar renders this list.
- `archivedSummaries`: `isArchived === true`; Settings receives a narrow
  projection containing only `id`, `title`, and whether the row is the current
  loaded conversation.

The split is presentation-only. Do not filter data at the Tauri client, store,
or persistence layers. Existing archive/unarchive actions update the shared
summary object, so the affected row automatically moves between derived lists
after the authoritative result resolves.

The Settings boundary exposes a controlled model equivalent to:

```ts
type ArchivedConversationItem = {
  id: string
  title: string
  isCurrent: boolean
}

type ArchivedConversationsPanelProps = {
  status: "idle" | "loading" | "ready" | "empty" | "error"
  items: readonly ArchivedConversationItem[]
  error: UiError | null
  disabled: boolean
  onSelect: (id: string) => void
  onRename: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
  onRetry: () => void
}
```

The concrete type may use a discriminated union if that removes impossible
states. It must remain narrow and Settings-owned; no broad Zustand state or
conversation client crosses the component boundary.

## 3. Settings shell and panel

- Extend `SettingsCategory` with `"archived"` and add an Archive-icon navigation
  button labeled **Archived Conversations / 已归档对话**.
- Keep General as the default category and preserve existing open/reset and
  unsaved-change confirmation behavior.
- Render a dedicated breadcrumb `Settings > Archived Conversations` and a
  scrollable panel body consistent with the other Settings categories.
- Use a restrained archive-ledger treatment aligned with the existing Radix
  Nova UI: bordered compact list, single-line titles, quiet iconography, and a
  trailing menu. Do not introduce a new theme, font, raw color, or decorative
  animation.
- Add the standard shadcn `Empty` primitive through the repository-pinned CLI
  and use it for the localized no-archives state. Use existing `Alert`,
  `Spinner`, `Button`, `DropdownMenu`, and breadcrumb primitives for error,
  loading, action, and navigation states.
- Follow the established Providers list composition instead of adding the
  `Item` primitive, because the current registry version would overwrite an
  authored shared Separator file.

Panel state behavior:

| History state | Archived panel result |
|---|---|
| idle/loading with no archived items | stable loading status |
| ready/empty with no archived items | localized `Empty` state |
| ready with archived items | semantic list of archived rows |
| error | preserve any safe rows and show localized retryable `Alert` |

The sidebar uses analogous derived-empty handling: when history exists but all
items are archived, show a localized no-active-conversations message rather
than rendering a blank section.

## 4. Row interactions

Each archived row has a primary title button and a trailing `DropdownMenu`:

- Primary selection closes Settings, resets its next-open category to General,
  and calls the existing `selectConversation(client, id)`. The loaded workspace
  supplies the established archived/read-only presentation.
- Rename routes to the existing workspace-owned
  `RenameConversationDialog` through `pendingRenameId`.
- Unarchive directly calls the existing controller action. On success the row
  disappears from this panel and appears in the sidebar.
- Delete routes to the existing workspace-owned destructive confirmation
  through `pendingDeleteId`; confirmation copy and deletion semantics remain
  unchanged.

Rename and delete overlays remain siblings owned by `ConversationWorkspace`.
They may open above Settings and return focus to the initiating control on
cancel/close. No second rename/delete implementation is introduced.

The sidebar row menu becomes active-only after filtering; it therefore exposes
rename, archive, and delete. Archived badge/unarchive branches are removed from
the sidebar surface but preserved in the new archived panel.

## 5. Accessibility and localization

- Category navigation keeps `aria-current="page"` and a translated navigation
  label.
- The archived collection uses list semantics; each title button and menu
  trigger has a translated accessible name that includes the user-authored
  title without translating it.
- Dropdown items are grouped according to the project shadcn rules, destructive
  delete uses the existing variant, and icon-only buttons use the configured
  Lucide library with accessible labels.
- Focus-visible behavior comes from existing primitives; no color-only archive
  signal is required because the entire panel is explicitly labeled archived.
- Add matched `zh-CN` and `en` dictionary entries for category, breadcrumb,
  list label, loading, empty title/description, no-active-sidebar state, and
  action accessible names.

## 6. Compatibility, risk, and rollback

- No backend, migration, wire contract, or durable state changes: released
  databases and archived conversation read-only semantics remain compatible.
- Search continues to return and open archived conversations. If search opens
  one, the sidebar intentionally has no matching active row; the existing
  scroll helper already tolerates no match.
- Highest regression risk is `ConversationWorkspace`, which currently owns
  both large sidebar markup and management dialogs. Keep the patch narrow and
  cover filtered empty states, action routing, and Settings-close navigation
  with behavior tests.
- The Settings props change affects test fixtures and all call sites; strict
  TypeScript and focused Settings tests are the guardrail.
- Rollback is a single feature-branch revert; no data rollback is necessary.

## 7. Development branch

After the final planning approval and task activation, create
`feat/archived-conversations-settings` from the current clean `main` before any
product-code or generated-component changes.
