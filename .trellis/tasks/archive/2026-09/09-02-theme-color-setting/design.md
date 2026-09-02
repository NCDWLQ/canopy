# Theme color setting design

## Scope and boundaries

This change adds one durable global preference, `theme_color`, with the closed
values `neutral`, `blue`, `green`, `orange`, `red`, `rose`, and `violet`.
Neutral is the default. The preference changes only shadcn's `primary` /
`primary-foreground` pair; other token families remain unchanged.

The settings domain owns persistence and validation, `list_providers` remains
the aggregate startup façade, the typed frontend bridge owns wire decoding,
the provider store owns the loaded durable projection, and the theme store
owns UI application.

## Persistence and IPC contract

- Add `ThemeColorPreference` to the Rust settings domain with exhaustive
  parse/serialize mappings for the seven values.
- Store the serialized value under the existing `app_settings.theme_color`
  key. The table is already key/value based, so no schema migration is needed.
- A missing key returns Neutral. A present unknown value remains a corrupt
  setting error rather than being silently reset.
- Add a `set_theme_color` Tauri command with strict request/result DTOs shaped
  as `{ theme_color: string }`. Validate the closed value before resolving the
  database.
- Add `theme_color` to the strict `list_providers` aggregate result and shared
  provider IPC fixture. Register the command in both the Tauri handler and the
  frozen provider command catalog.
- Mirror the closed set in the frontend Zod boundary and map snake-case DTOs
  to the camel-case `themeColor` view field.

## Frontend state and document application

- Define one frontend `THEME_COLORS` tuple and derive
  `ThemeColorPreference` from it. Reuse it in the resolver and Zod schema so
  the browser-side value set has one owner.
- Extend the existing theme Zustand store with `themeColor` and
  `setThemeColorPreference`; unknown untyped boot fixtures resolve to Neutral.
- Extend the provider store projection and its request-epoch-preserving update
  paths with `themeColor`. Hydration and a successful `setThemeColor` response
  update the UI theme store. Failed writes preserve the previous projection.
- Extend `DocumentThemeSync` to set `data-theme-color` on `<html>` while
  preserving the existing isolated subscription behavior, so the conversation
  workspace does not re-render for a palette change.

## CSS token design

`src/index.css` remains the single theme stylesheet. Define paired custom
properties for every color in `:root` and override their palette shade in
`.dark`. The root `data-theme-color` selector maps the selected pair onto
`--primary` and `--primary-foreground`.

The palette uses restrained, high-contrast Tailwind variables:

| Color | Light primary / foreground | Dark primary / foreground |
|---|---|---|
| Neutral | Current Neutral values | Current Neutral values |
| Blue | blue-600 / white | blue-400 / blue-950 |
| Green | green-700 / white | green-400 / green-950 |
| Orange | orange-700 / white | orange-400 / orange-950 |
| Red | red-600 / white | red-400 / red-950 |
| Rose | rose-600 / white | rose-400 / rose-950 |
| Violet | violet-600 / white | violet-400 / violet-950 |

The same per-color custom properties drive the option swatches, preventing the
preview dots from drifting from the actual primary values. Neutral retains the
current exact light/dark values when the attribute is absent or set to
`neutral`.

## Appearance UI

Keep the established horizontal settings-row pattern. Add a second `Field`
under the existing `FieldGroup`/`FieldSet`, with localized label and
description on the left and a compact shadcn `Select` on the right.

The Select is controlled by `themeColor`, disabled during provider-store
loading, labelled from the field label, and composed as required for the Radix
base:

```text
Field (horizontal)
├── FieldContent: label + description
└── Select
    ├── SelectTrigger: SelectValue (selected label + swatch)
    └── SelectContent
        └── SelectGroup
            └── seven SelectItem rows (swatch + label)
```

The circular swatch is the one visual signature of this control. It stays
small and quiet so the row matches the existing settings page rather than
introducing a new card, typography treatment, animation, or dependency.

## Compatibility, errors, and rollback

- Existing installations have no `theme_color` key and therefore render the
  current Neutral primary unchanged.
- Strict Rust and Zod validation reject invalid command and aggregate values.
- The existing Appearance error Alert handles persistence failures; no new
  notification system is introduced.
- Rollback is code-only: removing the new command/field leaves an unused KV
  entry that older builds ignore. No database down-migration is required.

## Verification

- Rust domain/service tests cover missing-key default, all seven round trips,
  corrupt values, and command validation/registration.
- Shared Rust/TypeScript fixture tests cover the new command and aggregate
  field.
- Theme store and App tests cover Neutral fallback and `<html>` attribute sync
  without workspace re-render.
- Provider store tests cover hydration, successful persistence/application,
  and failure preservation.
- Appearance panel tests cover the controlled Select, all seven swatches,
  bilingual labels, selection, disabled state, and error behavior.
- Full formatting, lint, TypeScript, Vitest, Vite build, Rust formatting, and
  Rust test gates must pass.
