import { create } from "zustand"

import { effectiveTheme, resolveThemePreference } from "./resolve"
import type { ResolvedTheme, ThemePreference } from "./types"

export type ThemeStore = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setThemePreference: (theme: ThemePreference) => void
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
  setThemePreference: (preference) => {
    const theme = resolveThemePreference(preference)
    const resolvedTheme = effectiveTheme(theme, systemPrefersDark())
    set({ theme, resolvedTheme })
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
