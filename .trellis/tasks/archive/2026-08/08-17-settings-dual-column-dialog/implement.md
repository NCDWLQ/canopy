# Implement: Settings dual-column dialog

## Checklist

1. [ ] Rebuild `GlobalSettingsDialog` shell: left category nav (icon +
      **模型提供商**), right content region, dialog close preserved.
2. [ ] Add content breadcrumb: list `设置 > 模型提供商`; detail
      `设置 > 模型提供商 > {name|新建}`; category crumb returns to list.
3. [ ] Implement list view: providers, 新建, set-global-default; row opens
      detail.
4. [ ] Implement detail view: move existing editor/save/delete/API-key/model
      flows here; delete success returns to list; save keeps detail.
5. [ ] On dialog open/close: land on list; clear ephemeral key/reveal state on
      close as today.
6. [ ] Rename dialog-owned「服务提供商」→「模型提供商」。
7. [ ] Remove standing helper paragraphs per PRD (dialog blurb, list default
      hint, model-list and API-key FieldDescriptions); keep Anthropic note,
      empty/error/destructive copy; ensure labels/badges/`aria-label` still
      carry meaning (add `sr-only` DialogDescription only if required).
8. [ ] Update `GlobalSettingsDialog.test.tsx` for list→detail flow and new
      copy; leave composer/workspace CTA strings unchanged.
9. [ ] Smoke-check workspace/picker still open the controlled dialog.

## Validation

```bash
pnpm exec vitest run src/features/providers/components/GlobalSettingsDialog.test.tsx
pnpm exec vitest run src/features/conversations/components/ConversationWorkspace.test.tsx
pnpm exec tsc --noEmit
```

(Use repo package scripts if they wrap these commands.)

## Risky files / rollback

| Area | Risk | Mitigation |
|------|------|------------|
| `GlobalSettingsDialog.tsx` | Broken navigation or lost mutation behavior | Keep handlers; expand tests for list/detail |
| Tests asserting side-by-side headings | Fail after IA change | Rewrite to list then drill-in |
| Workspace tests asserting dialog H2 | May need breadcrumb/list queries | Update only dialog-structure assertions |

Rollback = revert dialog + tests; no persistence impact.

## Before `task.py start`

- [x] `prd.md` converged (post copy-declutter revision)
- [x] `design.md` / `implement.md` updated
- [x] `implement.jsonl` / `check.jsonl` curated
- [ ] User explicit approval of **this** final planning summary
