# 执行计划：手动检查更新

## Ordered checklist

1. Add the update client and pure stable-version comparison/response decoder in
   `src/lib/updates/`; cover successful, malformed, and failing responses.
2. Add the settings update-check lifecycle boundary and General settings UI:
   current version, button, loading state, four result states, retry, and
   release-page action.
3. Add both locale dictionaries and keep all user-visible strings typed through
   `zh-CN`.
4. Narrowly update the Tauri CSP to allow only the GitHub API origin; reuse the
   existing opener capability without adding permissions.
5. Add focused client, hook/component, and General settings regression tests.
6. Run formatting, lint, TypeScript, focused tests, full frontend tests, and
   production build; inspect the final diff for scope creep into updater
   installation/signing.

## Validation commands

```bash
pnpm prettier --check src src-tauri/tauri.conf.json
pnpm lint
pnpm typecheck
pnpm test -- src/lib/updates src/features/settings/components/GeneralSettingsPanel.test.tsx
pnpm test
pnpm build
```

Use `pnpm check` as the final frontend gate if the focused loop is green.

## Risk and rollback points

- `src-tauri/tauri.conf.json`: rollback only the GitHub API CSP source if the
  app cannot reach the endpoint; do not loosen the CSP globally.
- `src/lib/updates/`: rollback the network/client layer independently if the
  API contract changes; preserve the version display only if it remains useful.
- `GeneralSettingsPanel` and locale dictionaries: verify read-only behavior,
  bilingual labels, and no duplicate click requests before integration.
- No change should add updater signing, auto-download, install, restart, or a
  release secret; those are explicit out-of-scope boundaries.

## Review gate before activation

- PRD has no unresolved product decision.
- `design.md` and this execution plan are present.
- `implement.jsonl` and `check.jsonl` contain real spec/research entries.
- Only after review, run `task.py start` and enter implementation.
