import { create } from "zustand"

import {
  effectiveTheme,
  resolveThemeColorPreference,
  resolveThemePreference,
} from "./resolve"
import type {
  ResolvedTheme,
  ThemeColorPreference,
  ThemePreference,
} from "./types"

export type ThemeStore = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  themeColor: ThemeColorPreference
  setThemePreference: (theme: ThemePreference) => void
  setThemeColorPreference: (themeColor: ThemeColorPreference) => void
  syncSystemTheme: (isDark: boolean) => void
}

export function systemPrefersDark(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * UI-only theme state. Deliberately not persisted in localStorage: the durable
 * preference round-trips through the backend `app_settings` store via invoke.
 */
export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: "system",
  resolvedTheme: effectiveTheme("system", systemPrefersDark()),
  themeColor: "neutral",
  setThemePreference: (preference) => {
    const theme = resolveThemePreference(preference)
    const resolvedTheme = effectiveTheme(theme, systemPrefersDark())
    set({ theme, resolvedTheme })
  },
  setThemeColorPreference: (preference) => {
    set({ themeColor: resolveThemeColorPreference(preference) })
  },
  syncSystemTheme: (isDark) => {
    const current = get()
    if (current.theme === "system") {
      const nextResolved = effectiveTheme("system", isDark)
      if (current.resolvedTheme !== nextResolved) {
        set({ resolvedTheme: nextResolved })
      }
    }
  },
}))
