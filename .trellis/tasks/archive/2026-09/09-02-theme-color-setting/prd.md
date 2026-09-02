# Add theme color setting

## Goal

Let users choose the application's shadcn `primary` color from Appearance
settings so high-emphasis actions and selected states match their preference.

## Background

- Appearance settings currently expose the persisted light/system/dark theme
  preference in `AppearanceSettingsPanel`.
- Global shadcn tokens are defined in `src/index.css`; components already
  consume `--primary` and `--primary-foreground` through semantic utilities.
- Global preferences are durably stored in SQLite through the typed Tauri
  settings boundary. Browser storage is not an approved persistence path.
- The Radix-backed shadcn `Select` primitive is already installed.

## Requirements

- Add a Theme color row to Appearance settings using the existing shadcn
  `Select` component.
- Expose exactly seven fixed choices: Neutral, Blue, Green, Orange, Red, Rose,
  and Violet.
- Show a circular swatch to the left of every color label, including the
  selected value rendered in the trigger.
- Apply a successfully saved selection without a reload to shadcn `primary`
  and its matching `primary-foreground` contrast token in both light and dark
  modes.
- Persist the preference through the existing typed Tauri/SQLite settings
  flow and hydrate it on application startup.
- Use Neutral as the default for existing installations and for an absent
  stored value, preserving the current appearance.
- Provide typed Simplified Chinese and English labels and an accessible field
  label.
- On persistence failure, keep the previous color active and surface the
  existing Appearance settings error treatment.

## Acceptance Criteria

- [ ] Appearance settings displays a Theme color select alongside Theme mode.
- [ ] Opening the select shows every approved color with a matching circular
      swatch on its left; the trigger also shows the selected color's swatch.
- [ ] After a successful save, selecting a color updates UI surfaces that use
      shadcn `primary` without a reload while retaining readable
      `primary-foreground` contrast in both light and dark modes.
- [ ] The selected color is restored after restarting the application.
- [ ] A fresh or upgraded profile without the setting uses Neutral and matches
      the current UI.
- [ ] Invalid IPC values are rejected and failed writes leave the prior value
      selected and applied.
- [ ] Focus, keyboard selection, disabled/loading behavior, and bilingual
      labels remain accessible and covered by tests.

## Out of Scope

- Arbitrary custom color input or a color picker.
- Changing background, card, accent, chart, destructive, or other theme token
  families beyond the `primary` foreground pair.
- Replacing the existing Theme mode toggle.
