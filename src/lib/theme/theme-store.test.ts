import { beforeEach, describe, expect, it } from "vitest"

import { useThemeStore } from "./theme-store"

describe("useThemeStore", () => {
  beforeEach(() => {
    useThemeStore.setState({
      theme: "system",
      resolvedTheme: "light",
    })
  })

  it("updates preference and resolves theme immediately", () => {
    useThemeStore.getState().setThemePreference("dark")
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().resolvedTheme).toBe("dark")

    useThemeStore.getState().setThemePreference("light")
    expect(useThemeStore.getState().theme).toBe("light")
    expect(useThemeStore.getState().resolvedTheme).toBe("light")
  })

  it("syncs system theme change only when preference is system", () => {
    useThemeStore.getState().setThemePreference("system")
    useThemeStore.getState().syncSystemTheme(true)
    expect(useThemeStore.getState().resolvedTheme).toBe("dark")

    useThemeStore.getState().syncSystemTheme(false)
    expect(useThemeStore.getState().resolvedTheme).toBe("light")

    // When explicit, system change does not override resolved theme
    useThemeStore.getState().setThemePreference("light")
    useThemeStore.getState().syncSystemTheme(true)
    expect(useThemeStore.getState().resolvedTheme).toBe("light")
  })
})
