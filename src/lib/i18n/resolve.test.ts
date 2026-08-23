import { describe, expect, it } from "vitest"

import {
  effectiveLocale,
  resolveLocalePreference,
  resolveSystemLocale,
} from "./resolve"

describe("resolveSystemLocale", () => {
  it("maps any zh tag to zh-CN", () => {
    expect(resolveSystemLocale(["zh-CN"])).toBe("zh-CN")
    expect(resolveSystemLocale(["zh-TW", "en-US"])).toBe("zh-CN")
    expect(resolveSystemLocale(["en-US", "zh"])).toBe("zh-CN")
    expect(resolveSystemLocale(["zh-Hans-CN"])).toBe("zh-CN")
  })

  it("falls back to en without a zh tag", () => {
    expect(resolveSystemLocale(["en-US", "en"])).toBe("en")
    expect(resolveSystemLocale(["fr-FR", "de-DE"])).toBe("en")
    expect(resolveSystemLocale([])).toBe("en")
  })
})

describe("resolveLocalePreference", () => {
  it("accepts the three stored values", () => {
    expect(resolveLocalePreference("zh-CN")).toBe("zh-CN")
    expect(resolveLocalePreference("en")).toBe("en")
    expect(resolveLocalePreference("system")).toBe("system")
  })

  it("treats missing or corrupted storage as system", () => {
    expect(resolveLocalePreference(null)).toBe("system")
    expect(resolveLocalePreference(undefined)).toBe("system")
    expect(resolveLocalePreference("")).toBe("system")
    expect(resolveLocalePreference("fr")).toBe("system")
    // "zh" is not a supported locale; only the exact values persist.
    expect(resolveLocalePreference("zh")).toBe("system")
  })
})

describe("effectiveLocale", () => {
  it("follows the system locale for the system preference", () => {
    expect(effectiveLocale("system", "en")).toBe("en")
    expect(effectiveLocale("system", "zh-CN")).toBe("zh-CN")
  })

  it("lets an explicit preference override the system locale", () => {
    expect(effectiveLocale("en", "zh-CN")).toBe("en")
    expect(effectiveLocale("zh-CN", "en")).toBe("zh-CN")
  })
})
