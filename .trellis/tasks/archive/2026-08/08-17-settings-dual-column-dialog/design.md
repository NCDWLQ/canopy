# Design: Settings dual-column dialog

## Architecture

Keep Settings as one modal owned by the providers feature.

```text
features/providers/components/
  GlobalSettingsDialog.tsx     # Dialog shell, category nav, breadcrumb, view state
  ProviderSettingsList.tsx     # optional: provider list + new / set default
  ProviderSettingsEditor.tsx   # optional: existing form fields + save/delete
```

Extraction is optional; a single file is acceptable if clearer. Do not add
`features/settings/` or app routes.

## Layout (reference-aligned)

```text
┌ DialogContent ──────────────────────────────────────────────────────┐
│ ┌ Nav (icon+label) ┐ ┌ Content ───────────────────────────────────┐ │
│ │ [icon] 模型提供商 │ │ breadcrumb …                    [close]   │ │
│ │ (active)          │ │                                           │ │
│ │                   │ │ list view  OR  detail/edit view           │ │
│ └───────────────────┘ └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

- Left nav: vertical list of categories; each row = Lucide icon + label;
  active row uses muted/secondary rounded background (match existing ghost /
  secondary button language, not a new card system).
- Right content: breadcrumb row under/near the top; body scrolls independently
  when needed.
- MVP category icon: Lucide `Bot` (or `Server` if `Bot` feels off in review) —
  one icon only for now.

## Navigation / state

UI-only state inside the dialog:

| State | Meaning |
|-------|---------|
| `category` | Always `providers` in MVP |
| `view` | `list` \| `edit` |
| `selectedId` | `string \| null` when `view === 'edit'` (`null` = 新建) |

Transitions:

- Open dialog → `view = list` (reset detail); clear ephemeral API-key reveal
  state as today on close.
- List row click → `view = edit`, `selectedId = id`, load draft + reveal key.
- 新建 → `view = edit`, `selectedId = null`, empty draft.
- Breadcrumb `模型提供商` (or explicit back) → `view = list`.
- Successful save may stay on detail with refreshed draft (today’s
  reselect behavior) or return to list — **stay on detail** to match current
  save-and-keep-editing feel.
- Successful delete → return to `list`.

Breadcrumb labels:

- List: `设置` / `模型提供商`
- Edit: `设置` / `模型提供商` / `{name}` or `新建`
- `设置` is non-navigating label (single settings root). `模型提供商` navigates
  to list when on detail.

## Provider list vs detail responsibilities

**List**

- Enumerate providers; show global-default affordance (badge + set-default
  control) as today.
- 新建 action.
- Empty state copy using「模型提供商」.

**Detail**

- Existing editor fields, model list tooling, API key handling, save, delete
  confirm.
- Read-only / store error alerts.

## Data flow / contracts

- No store or IPC changes.
- Preserve `client`, `readOnly`, controlled/uncontrolled open API.
- No URL sync for category/view.

## Copy (S2 + declutter)

| Surface | Term |
|---------|------|
| Dialog nav, breadcrumbs, dialog-owned strings | 模型提供商 |
| Composer CTA, picker “管理服务提供商…”, other workspace copy | 服务提供商 (unchanged) |

Standing helper policy:

| Copy | Action |
|------|--------|
| DialogDescription blurb | Remove (use `sr-only` description if Dialog a11y requires one) |
| List “选择全局默认后…” paragraph | Remove; keep 默认 badge + set-default control/`aria-label` |
| Model-list FieldDescription | Remove; selected chip/button state shows default model |
| API-key FieldDescription | Remove; password + show/hide remain |
| Anthropic endpoint FieldDescription | Keep |
| Empty list one-liner | Keep |
| Delete confirm / read-only / errors | Keep |

## Compatibility / rollback

- Entry points still open the same dialog.
- Rollback = revert dialog components/tests; no data migration.

## Trade-offs

- List → detail adds an extra click vs old side-by-side editing — accepted for
  clearer hierarchy and room for future categories.
- Temporary glossary split dialog vs workspace — follow-up copy PR.
- Supersedes earlier L1 nested dual-pane decision.
