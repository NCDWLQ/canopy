import * as React from "react"

import { ConversationWorkspace } from "@/features/conversations/components"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"
import { useTheme, useThemeStore } from "@/lib/theme"

function DocumentLocaleSync() {
  const { locale } = useTranslation()

  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return null
}

function DocumentThemeSync() {
  const { theme, resolvedTheme, themeColor } = useTheme()

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

  React.useEffect(() => {
    const root = document.documentElement
    if (themeColor === "neutral") {
      delete root.dataset.themeColor
    } else {
      root.dataset.themeColor = themeColor
    }
  }, [themeColor])

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

  return null
}

export default function App() {
  return (
    <TooltipProvider>
      <DocumentLocaleSync />
      <DocumentThemeSync />
      <main className="h-dvh overflow-hidden bg-background text-foreground">
        <ConversationWorkspace />
        <Toaster />
      </main>
    </TooltipProvider>
  )
}
