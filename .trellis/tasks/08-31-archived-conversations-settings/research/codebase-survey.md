# Codebase survey — archived conversations in Settings

## Current behavior

- `ConversationWorkspace` owns the conversation client, the normalized history
  projection, Settings open/category state, and all rename/archive/unarchive/
  delete orchestration (`src/features/conversations/components/ConversationWorkspace.tsx:124-175`).
- Sidebar history maps the complete `history.summaries` array, so active and
  archived conversations are currently mixed together
  (`ConversationWorkspace.tsx:617-735`).
- The existing row menu already exposes rename, archive or unarchive, and
  permanent delete (`ConversationWorkspace.tsx:672-729`). Existing sibling
  dialogs use `pendingRenameId` and `pendingDeleteId`, so a second management
  surface can route to the same behavior instead of duplicating mutations.
- `SettingsDialog` owns only modal chrome, category navigation, dirty-state
  protection, and category rendering
  (`src/features/settings/components/SettingsDialog.tsx:1-201`). Its current
  categories are General, Appearance, Model Providers, and Conversations.
- The global feature dependency contract is `conversations -> settings ->
  providers`; `features/settings` must not import from
  `features/conversations` (`.trellis/spec/frontend/component-guidelines.md`,
  Workspace-Global Settings Entry).

## State and mutation evidence

- The history store deliberately keeps the complete ordered summary list and
  initially selects the newest non-archived conversation, falling back to an
  archived conversation only when all history is archived
  (`src/features/conversations/store/index.ts:807-854`).
- `selectConversation` accepts any ID already present in the history summary
  list, including archived IDs (`store/index.ts:880-884`). No new load command
  is needed for Settings navigation.
- Archive, rename, delete, and unarchive actions already patch the same history
  summary projection after authoritative command results
  (`store/index.ts:1720-1856`, `1938-2016`). Filtering that projection at the
  view boundary will therefore move rows between surfaces automatically.
- Search intentionally includes archived conversations and can reveal them.
  The requested sidebar separation does not require changing search or its IPC
  contract.

## UI and component evidence

- Settings panels consistently use a breadcrumb header plus a scrollable body;
  the Providers list supplies the closest list/action pattern
  (`src/features/providers/components/ProviderSettingsList.tsx`).
- The project uses shadcn Radix Nova, Tailwind 4, Lucide, and the `@/*` alias.
  `DropdownMenu`, `Breadcrumb`, `Alert`, `Button`, and `Spinner` are installed.
- The standard shadcn `Empty` primitive is not installed. A repository-pinned
  dry run (`pnpm exec shadcn add empty --dry-run`) reports one additive file,
  `src/components/ui/empty.tsx`, and no overwrite. The `Item` primitive would
  overwrite the authored Separator primitive, so it is not appropriate for
  this task; the panel should follow the established Providers list composition
  instead.
- User-visible strings are sourced from `zh-CN.ts`, with `en.ts` statically
  checked against the same dictionary shape.

## Planning implications

1. This is a frontend-only projection and composition change; no Rust, SQLite,
   migration, IPC schema, or store mutation change is required.
2. Keep the complete summary array in the conversation store and derive active
   and archived lists in `ConversationWorkspace`; do not create a second store
   or durable archive list.
3. Preserve the feature dependency direction by passing a narrow archived-list
   view model and callbacks into the Settings panel. The Settings feature must
   not import the conversation store, conversation client, controller, or
   conversation-owned types.
4. Reuse the existing workspace-owned rename/delete dialogs and controller
   actions. The new panel only emits user intent.
5. Add explicit filtered-empty states because `history.status === "ready"` is
   possible when one of the two derived lists is empty.
