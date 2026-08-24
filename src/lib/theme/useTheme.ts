import { useThemeStore } from "./theme-store"

export function useTheme() {
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const setTheme = useThemeStore((state) => state.setThemePreference)
  return { theme, resolvedTheme, setTheme }
}
