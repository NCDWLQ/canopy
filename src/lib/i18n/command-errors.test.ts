import { beforeEach, describe, expect, it } from "vitest"

import { commandErrorCodeSchema } from "@/lib/tauri/schemas"

import { t } from "./index"
import { commandErrorKeys, commandErrorMessage } from "./command-errors"
import { useLocaleStore } from "./locale-store"

/** The closed UiErrorCode union, mirrored from the Tauri bridge schema. */
const EXPECTED_CODES = [
  "invalid_input",
  "not_found",
  "tree_integrity",
  "database_unavailable",
  "migration_failure",
  "provider_authentication",
  "rate_limited",
  "provider_unavailable",
  "network_failure",
  "cancelled",
  "internal",
] as const

describe("commandErrorKeys", () => {
  it("covers exactly the closed schema code set", () => {
    expect(Object.keys(commandErrorKeys).sort()).toEqual(
      [...commandErrorCodeSchema.options].sort(),
    )
    expect([...commandErrorCodeSchema.options].sort()).toEqual(
      [...EXPECTED_CODES].sort(),
    )
  })
})

describe("commandErrorMessage", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-CN")
  })

  it("returns non-empty localized text for every code", () => {
    for (const code of commandErrorCodeSchema.options) {
      expect(commandErrorMessage(code)).toMatch(/\S/)
    }
  })

  it("maps each code through its own dictionary entry", () => {
    for (const code of EXPECTED_CODES) {
      expect(commandErrorMessage(code)).toBe(t(commandErrorKeys[code]))
    }
  })

  it("falls back to the internal message for unknown codes", () => {
    expect(commandErrorMessage("something_new")).toBe(t("errors.internal"))
    expect(commandErrorMessage("")).toBe("发生意外错误。")
  })

  it("localizes through the active locale", () => {
    useLocaleStore.getState().setLocale("en")
    expect(commandErrorMessage("cancelled")).toBe("Generation was cancelled.")
    useLocaleStore.getState().setLocale("zh-CN")
    expect(commandErrorMessage("cancelled")).toBe("生成已取消。")
  })
})
