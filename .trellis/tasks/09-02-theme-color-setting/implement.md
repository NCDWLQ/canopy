# Theme color setting implementation plan

## Preconditions

- The main session creates and switches to `feat/theme-color-setting` from the
  current clean `main` before product edits.
- Start this Trellis task only after the user approves the final planning
  summary and the context manifests pass the ready gate.

## Implementation checklist

1. Add the Rust `ThemeColorPreference` domain value and `theme_color` KV
   repository/service round trip, defaulting a missing key to Neutral.
2. Add and register strict `set_theme_color` request/result DTOs; extend the
   `list_providers` aggregate and frozen provider command catalog.
3. Update the shared provider IPC fixture plus Rust contract, settings, and
   command-registration tests.
4. Add the frontend seven-value constant/type/resolver, strict Zod request and
   result schemas, typed client method, DTO mapping, and provider view field.
5. Extend the provider and theme stores so startup hydration and successful
   saves apply the authoritative color while failures retain the prior value.
6. Add CSS palette custom properties and root attribute selectors that map
   the chosen pair only to `primary` / `primary-foreground`; reuse the same
   variables for swatches.
7. Sync `themeColor` to `<html data-theme-color>` in `DocumentThemeSync` and
   retain the no-workspace-rerender behavior.
8. Add the localized Theme color `Select` row with seven left-side swatches,
   selected-value swatch, loading disablement, and accessible labelling.
9. Update strict test mocks/fixtures and add focused frontend coverage for
   resolver/store/document/UI behavior and persistence failures.
10. Format touched files and run focused tests, then the full frontend and Rust
    quality gates. Review the final diff for changes outside the planned token
    pair and settings path.

## Validation commands

```bash
pnpm exec vitest run src/lib/theme src/App.test.tsx src/lib/tauri/provider-client.test.ts src/features/providers/store/store.test.ts src/features/settings/components/AppearanceSettingsPanel.test.tsx
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

## Risk and rollback points

- The strict `list_providers` shape is used by many test doubles. Run
  TypeScript checking after the bridge/store changes before UI polishing so
  missing `themeColor` and `setThemeColor` fixtures are caught early.
- Keep the CSS attribute mapping and swatch mapping in the same change; if the
  preview and applied color differ, revert that CSS step before proceeding.
- No migration is added. A rollback may leave `theme_color` in `app_settings`,
  but previous versions ignore unknown keys safely.
