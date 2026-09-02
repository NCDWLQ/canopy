import { useThemeStore } from "./theme-store"

export function useTheme() {
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const themeColor = useThemeStore((state) => state.themeColor)
  const setTheme = useThemeStore((state) => state.setThemePreference)
  const setThemeColor = useThemeStore((state) => state.setThemeColorPreference)
  return { theme, resolvedTheme, themeColor, setTheme, setThemeColor }
}
