# shadcn theme color research

## Local project evidence

- `components.json` and `pnpm exec shadcn info --json` report Vite,
  Tailwind CSS v4, Radix Nova, CSS variables, Neutral base color, Lucide icons,
  and `src/index.css` as the global theme file.
- The shadcn `select` component is already installed at
  `src/components/ui/select.tsx`; no registry operation or dependency change is
  needed.
- `AppearanceSettingsPanel` already uses `FieldGroup`/`FieldSet`/`Field` and
  persists theme mode through `useProviderStore` and the typed Tauri client.
- `src/index.css` owns the current `--primary` / `--primary-foreground` values
  for both `:root` and `.dark`.
- `.trellis/spec/frontend/state-management.md` requires global durable
  preferences to round-trip through SQLite rather than browser storage.

## Upstream component and token contracts

- shadcn Select composition is `Select` -> `SelectTrigger` + `SelectValue`,
  with `SelectItem` elements inside `SelectGroup` / `SelectContent`.
- Radix Select supports controlled values, keyboard navigation, item content,
  and selected item rendering in the trigger.
- shadcn recommends CSS variables for theming. Components consume semantic
  `primary` / `primary-foreground` tokens, and dark mode overrides the same
  tokens under `.dark`.
- `primary` represents high-emphasis actions and brand surfaces; the paired
  `primary-foreground` token provides readable content on those surfaces.

## Planned application

- Keep all palette values in `src/index.css` and select them through a root
  `data-theme-color` attribute. The same per-color CSS custom properties will
  drive both `--primary` and option swatches, avoiding duplicated values.
- Preserve the current Neutral values as the default and use explicit light
  and dark palette values for Blue, Green, Orange, Red, Rose, and Violet.
- Persist only the closed color name; CSS remains the single owner of visual
  token values.

## References

- https://ui.shadcn.com/docs/components/radix/select
- https://www.radix-ui.com/primitives/docs/components/select
- https://ui.shadcn.com/docs/theming
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
