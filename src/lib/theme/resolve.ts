import {
  THEME_COLORS,
  type ThemeColorPreference,
  ResolvedTheme,
  ThemePreference,
} from "./types"

export function resolveSystemTheme(isDark: boolean): ResolvedTheme {
  return isDark ? "dark" : "light"
}

export function effectiveTheme(
  preference: ThemePreference,
  systemIsDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return resolveSystemTheme(systemIsDark)
  }
  return preference
}

export function resolveThemePreference(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value
  }
  return "system"
}

export function resolveThemeColorPreference(
  value: unknown,
): ThemeColorPreference {
  return THEME_COLORS.find((color) => color === value) ?? "neutral"
}

export function isThemeColorPreference(
  value: unknown,
): value is ThemeColorPreference {
  return THEME_COLORS.some((color) => color === value)
}
