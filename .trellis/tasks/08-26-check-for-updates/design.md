# 技术设计：手动检查更新

## Architecture and boundaries

Use four small boundaries:

1. `src/features/settings/components/GeneralSettingsPanel.tsx` renders the
   current version, the check button, and the localized status/result.
2. `src/features/settings/hooks/useUpdateCheck.ts` owns the request lifecycle:
   idle/loading/result/error, duplicate-click protection, and retry reset.
3. `src/lib/updates/client.ts` owns the external contract: current-version
   lookup, GitHub response validation, stable SemVer comparison, and a typed
   result union. It must not expose raw response bodies or localized error
   strings.
4. `src/lib/updates/constants.ts` owns the repository API URL and the fixed
   release-page URL. The release-page action uses the existing opener plugin
   through the update boundary; it never opens an arbitrary URL returned by
   GitHub.

## Data flow

```text
GeneralSettingsPanel
  -> useUpdateCheck.check()
  -> update client
  -> Tauri getVersion() + GitHub latest-release fetch
  -> validate { tag_name, draft, prerelease }
  -> compare stable versions
  -> typed result
  -> localized UI state
  -> opener opens fixed /releases/latest page
```

The current version comes from the Tauri app API rather than a second frontend
constant. The GitHub payload is parsed from `unknown`; only a valid stable tag
such as `v0.4.0` or `0.4.0` can produce an available/up-to-date result.

## Result contract

```ts
type UpdateCheckResult =
  | { kind: "up-to-date"; currentVersion: string }
  | {
      kind: "available"
      currentVersion: string
      latestVersion: string
    }
```

Transport errors, non-2xx responses, malformed JSON, draft/prerelease data, or
invalid versions are one user-facing `error` state. The UI exposes retry, not
the provider/network error text.

## UI behavior

- The version row is always visible in General settings.
- The check button is disabled and shows a busy label only while a request is
  active. It remains available when `readOnly` is true because checking a
  public release is not a persisted settings mutation.
- A new-version result shows the latest version and a localized button that
  opens the fixed GitHub release page.
- Opening the page is user initiated and uses the existing opener permission;
  update checking itself does not download or install anything.
- All labels, status text, button text, and accessible names are added to both
  dictionaries with `zh-CN` remaining the type-level source of truth.

## Compatibility and security

- Add only `https://api.github.com` to `connect-src`; keep all other CSP
  restrictions unchanged.
- Do not add an API token. The public endpoint is sufficient for this check.
- Do not add `tauri-plugin-updater`, updater permissions, signing keys, or
  installer metadata in this task.
- Use a stable SemVer parser limited to the release format used by `v*` tags;
  invalid tags fail closed rather than being guessed.

## Rollback

The feature can be rolled back by removing the update client/hook/UI,
dictionary keys, the single CSP source, and their tests. It has no database
schema, persisted settings, release secret, or migration impact.
