# Frontend i18n Guidelines

> Typed-dictionary i18n for Canopy's two UI locales (`zh-CN`, `en`).
> Established 2026-08-22 with task 08-22-i18n; replaces the former
> "single-locale, no i18n runtime" rule. No i18n library dependency.

---

## Dictionary Conventions

- Locales live in `src/lib/i18n/locales/`: `zh-CN.ts` is the source of truth
  (`as const`, defines `type Dictionary` — key set and function signatures);
  every other locale `satisfies Dictionary`, so a missing/renamed key or a
  mismatched params signature is a compile error, not a runtime fallback.
- Flat dot keys `<feature>.<area>.<name>` (e.g.
  `settings.providers.deleteConfirm`). Entry values are static `string` or
  `(params) => string` function entries; interpolation and pluralization
  (English one/other) live inside the function entry.
- `t(key)` / `t(key, params)` overloads with compile-time-checked keys.
  Components use `useTranslation()`; non-React modules (stores, `lib/`
  helpers) call `t()` directly — it reads the zustand locale store, so it
  always reflects the active locale.
- Never translate: LLM message content, thinking blocks, conversation
  titles/previews, user-entered provider names and model identifiers,
  brand/technical values, table format labels (CSV/Markdown/TSV).
- The locale store is ephemeral UI state (no persist middleware, no
  localStorage). The persisted preference is the `language` key in the
  `app_settings` kv table, written through the `set_language` command and
  hydrated from `list_providers` (see scenario below).
- Tests pin the locale store to `zh-CN` in `src/test/setup.ts` so existing
  Chinese assertions stay verbatim; do not rely on jsdom's navigator default.

## Scenario: Language Preference IPC

### 1. Scope / Trigger

Use this contract when changing `set_language`, the `list_providers` response
`language` field, locale hydration, or `GeneralSettingsPanel`. Owning files:
`src-tauri/src/providers/{domain,repository,service,commands}.rs`,
`contract-fixtures/provider-ipc.json`, `src/lib/tauri/provider-{schemas,client}.ts`,
`src/features/providers/store/index.ts`, `src/features/settings/components/`.

### 2. Signatures

```ts
setLanguage(language: LocalePreference): Promise<LocalePreference>  // command "set_language"
listProviders(): Promise<{ /* … */ language: LocalePreference }>    // default "system"
```

`LocalePreference = "system" | "zh-CN" | "en"` (`src/lib/i18n/types.ts`);
Rust mirrors it as `LanguagePreference { System, ZhCn, En }` with
`as_setting_text()` round-tripping the same three strings.

### 3. Contracts

- Request `{ request: { language } }`; response `{ language: <stored value> }`.
- `list_providers.language` defaults to `"system"` when the kv key is absent;
  a dirty stored value fails closed (`ProviderError::Protocol`), mirroring the
  auto-title settings precedent.
- Hydration happens inside the providers store when `list_providers` resolves:
  an explicit preference overrides the system-detected locale; `"system"` keeps
  it; a failed list leaves the detected locale (graceful degradation). No
  extra IPC call is added for hydration.
- `App.tsx` syncs `document.documentElement.lang` with the active locale.
- `GeneralSettingsPanel` saves via the store action; on failure it renders
  `commandErrorMessage(code)` and reverts to the persisted value.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| `language` outside the closed enum (Rust) | `invalid_input` before DB access, details `{field:"language", reason:"invalid_language"}` |
| Unknown enum value / missing / extra field (zod) | bridge schema rejection |
| Dirty kv value on read | fail-closed `ProviderError::Protocol` |
| `set_language` rejection in the panel | error alert + display reverts to stored value |

### 5. Good/Base/Bad Cases

- **Good**: stored `"en"` hydrates on startup, switches UI text and
  `<html lang>` without restart.
- **Base**: no kv key → `"system"` → locale follows `navigator.languages`
  (`zh*` → `zh-CN`, otherwise `en`).
- **Bad**: persisting the locale in localStorage; re-declaring the
  `LocalePreference` union in another module; rendering the backend error
  `message` instead of `commandErrorMessage(code)`.

### 6. Tests Required

- Bridge: fake transport asserts the `set_language` command name and
  `{request:{language}}` payload; zod rejects `"fr"` / missing / extra fields;
  list decode requires a valid `language`.
- Rust: kv round-trip including the absent-key default, command registration
  with validation-before-DB-access, shared-fixture round-trip on both sides.
- Store/panel: explicit preference switches the locale store; `"system"`
  recomputes from the OS; save failure reverts the displayed value;
  `document.documentElement.lang` follows locale changes.

### 7. Wrong vs Correct

#### Wrong

```ts
localStorage.setItem("locale", next)            // settings must round-trip via invoke
{ error.message }                               // renders the zh wire string in en UI
```

#### Correct

```ts
await setLanguage(next)                          // persists via app_settings kv
{ commandErrorMessage(error.code) }              // localized by code, details stay machine-readable
```

---

## Forbidden Patterns

- Hard-coded user-visible copy in components (text, placeholder, tooltip,
  aria-label, toast, empty state) instead of dictionary keys.
- Re-declaring closed unions (`LocalePreference`, `UiErrorCode`) outside
  their owning modules (`src/lib/i18n/types.ts`, `src/lib/tauri/types.ts`).
- Rendering the backend `CommandError.message` string in the UI.
- Adding an i18n runtime dependency (i18next/react-intl/lingui) — the typed
  dictionary covers the current scale; revisit only with ICU-grade needs.
