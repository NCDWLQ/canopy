import { describe, expect, it } from "vitest"

import {
  effectiveTheme,
  isThemeColorPreference,
  resolveSystemTheme,
  resolveThemeColorPreference,
  resolveThemePreference,
} from "./resolve"
import { THEME_COLORS } from "./types"

describe("resolveSystemTheme", () => {
  it("resolves dark when system is dark", () => {
    expect(resolveSystemTheme(true)).toBe("dark")
  })

  it("resolves light when system is light", () => {
    expect(resolveSystemTheme(false)).toBe("light")
  })
})

describe("resolveThemePreference", () => {
  it("accepts valid theme preferences", () => {
    expect(resolveThemePreference("system")).toBe("system")
    expect(resolveThemePreference("light")).toBe("light")
    expect(resolveThemePreference("dark")).toBe("dark")
  })

  it("falls back to system for invalid/missing values", () => {
    expect(resolveThemePreference(null)).toBe("system")
    expect(resolveThemePreference(undefined)).toBe("system")
    expect(resolveThemePreference("")).toBe("system")
    expect(resolveThemePreference("solarized")).toBe("system")
  })
})

describe("resolveThemeColorPreference", () => {
  it("accepts valid theme color preferences", () => {
    for (const color of THEME_COLORS) {
      expect(isThemeColorPreference(color)).toBe(true)
      expect(resolveThemeColorPreference(color)).toBe(color)
    }
  })

  it("falls back to neutral for invalid/missing values", () => {
    expect(resolveThemeColorPreference(null)).toBe("neutral")
    expect(resolveThemeColorPreference(undefined)).toBe("neutral")
    expect(resolveThemeColorPreference("")).toBe("neutral")
    expect(resolveThemeColorPreference("solarized")).toBe("neutral")
    expect(isThemeColorPreference("solarized")).toBe(false)
  })
})

describe("effectiveTheme", () => {
  it("follows the system theme when preference is system", () => {
    expect(effectiveTheme("system", true)).toBe("dark")
    expect(effectiveTheme("system", false)).toBe("light")
  })

  it("forces light/dark when explicitly set", () => {
    expect(effectiveTheme("light", true)).toBe("light")
    expect(effectiveTheme("light", false)).toBe("light")
    expect(effectiveTheme("dark", true)).toBe("dark")
    expect(effectiveTheme("dark", false)).toBe("dark")
  })
})
