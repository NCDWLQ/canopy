import { describe, expect, it } from "vitest"

import {
  effectiveTheme,
  resolveSystemTheme,
  resolveThemePreference,
} from "./resolve"

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
