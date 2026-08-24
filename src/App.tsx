import * as React from "react"

import { ConversationWorkspace } from "@/features/conversations/components"
import { Toaster } from "@/components/ui/toaster"
import { useTranslation } from "@/lib/i18n"
import { useTheme, useThemeStore } from "@/lib/theme"

export default function App() {
  const { locale } = useTranslation()
  const { theme, resolvedTheme } = useTheme()

  // Keeps the document language in sync for assistive tech, hyphenation, and
  // translation hints; runs once on mount and after every locale switch.
  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // Synchronizes document dark class and colorScheme with resolved theme.
  React.useEffect(() => {
    const root = document.documentElement
    if (resolvedTheme === "dark") {
      root.classList.add("dark")
      root.style.colorScheme = "dark"
    } else {
      root.classList.remove("dark")
      root.style.colorScheme = "light"
    }
  }, [resolvedTheme])

  // When theme preference is 'system', listen for system color scheme changes.
  React.useEffect(() => {
    if (theme !== "system") return
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => {
      useThemeStore.getState().syncSystemTheme(event.matches)
    }
    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme])

  return (
    <main className="h-dvh overflow-hidden bg-background text-foreground">
      <ConversationWorkspace />
      <Toaster />
    </main>
  )
}
