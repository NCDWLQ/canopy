# Refactor settings into dual-column dialog

## Goal

Refactor global Settings into a dual-column dialog shell: left category nav
(with icons), right content with breadcrumbs. MVP ships one category,
**模型提供商**, as list → detail drill-down, with standing helper copy reduced
in favor of UI semantics.

## Background

- Settings open as a modal from the sidebar footer; `ConversationWorkspace`
  owns `isSettingsOpen`. The same dialog also opens from composer
  “配置服务提供商以生成” and the provider picker manage action.
- `GlobalSettingsDialog` today uses a side-by-side provider list | editor under
  a standard Dialog header, with no category nav, icons, or breadcrumbs, and
  several standing hint paragraphs (`GlobalSettingsDialog.tsx`).
- Reference UX: left icon+label categories; right pane with
  `Settings > {category}` breadcrumb and drill-in detail.
- Outside the dialog, copy still uses「服务提供商」; this PR does not migrate
  those strings.
- No routing; no backend/IPC changes.

## Requirements

1. Dual-column Settings shell: left = category nav with icon + label; right =
   selected category content.
2. MVP left nav has exactly one category labeled **模型提供商** (Lucide icon,
   recommend `Bot`), selected by default.
3. Provider category uses list → detail navigation (not nested dual pane):
   - **List**: providers; 新建; set-global-default on the row; row opens edit.
   - **Detail**: existing editor form (save/delete and field behaviors).
4. Breadcrumbs:
   - List: `设置 > 模型提供商`
   - Edit: `设置 > 模型提供商 > {name}` or `> 新建`
   - `模型提供商` crumb returns to the list; `设置` is non-navigating.
5. Within the settings dialog only, replace「服务提供商」with「模型提供商」。
   Do not change workspace/composer CTAs.
6. Declutter standing helper copy inside the dialog:
   - **Remove**: dialog description blurb; list “全局默认” explanatory
     paragraph; model-list standing FieldDescription; API-key standing
     FieldDescription (keep password field + show/hide control).
   - **Keep**: empty-state one-liner; Anthropic endpoint exception note;
     destructive delete confirmation; read-only / store-error alerts;
     fetch/validation error messages.
   - Rely on labels, badges, selected states, button names, and `aria-label`s
     instead of repeating those meanings in muted paragraphs.
7. Preserve Provider behaviors: API key reveal/keep/replace/remove, model list
   fetch/add/remove, save/delete, archive `readOnly`, store loading/error,
   accessible names.
8. Preserve all existing open entry points; keep settings as a modal.

## Acceptance Criteria

- [ ] Opening Settings shows left category nav (icon + label) and right content.
- [ ] **模型提供商** is selected by default; right pane starts on the provider
      list (not a side-by-side editor).
- [ ] Choosing a provider (or 新建) opens a dedicated edit view; breadcrumb
      updates; `模型提供商` crumb returns to the list.
- [ ] Dialog-owned copy uses「模型提供商」; composer/workspace「服务提供商」
      strings remain unchanged.
- [ ] Standing helper paragraphs listed in requirement 6 are gone; kept
      exception/empty/error/destructive copy remains; controls still expose
      meaning via labels/badges/selected state/`aria-label`.
- [ ] Sidebar and contextual open paths still open the same settings surface.
- [ ] Existing Provider behaviors remain covered by tests (API key
      keep/replace/remove, models, save/delete, readOnly).
- [ ] Lint, type-check, and relevant component tests pass.

## Out of Scope

- Additional non-Provider preference categories or persistence.
- Backend / IPC / credential storage changes.
- Settings routing / URL sync.
- Full-product glossary migration outside the settings dialog (follow-up).
- Dirty-state guards when leaving the edit view without saving.
- Changing Provider field/mutation semantics beyond layout, navigation, and
  agreed copy declutter.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Shell | Category nav (icon + label) left + content right |
| Category label | **模型提供商** |
| Copy rename scope | S2 — settings dialog only |
| Provider content | List → detail drill-down |
| Breadcrumb | `设置 > 模型提供商 [> name\|新建]` |
| Set global default | List-row action |
| Helper copy | Declutter standing hints; keep exception/empty/error/destructive |
| Save / delete navigation | Save stays on detail; delete returns to list |
| Modal vs route | Remain modal |

## Technical Notes

- Touch `GlobalSettingsDialog.tsx` (+ tests); optional list/detail extracts
  under `features/providers/components/`.
- Dialog view state: `list` | `edit` (+ selected id / new); open lands on list.
- Preserve controlled/uncontrolled `open` API.
- Follow-up: migrate remaining「服务提供商」strings outside the dialog.
