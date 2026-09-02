export type ThemePreference = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

export const THEME_COLORS = [
  "neutral",
  "blue",
  "green",
  "orange",
  "red",
  "rose",
  "violet",
] as const

export type ThemeColorPreference = (typeof THEME_COLORS)[number]
