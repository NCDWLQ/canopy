import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { t, useTranslation } from "./index"
import { useLocaleStore } from "./locale-store"
import { en } from "./locales/en"
import { zhCN } from "./locales/zh-CN"
import type { SupportedLocale } from "./types"

describe("t", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-CN")
  })

  it("translates static keys", () => {
    expect(t("common.close")).toBe("关闭")
    expect(t("conversation.workspace.newConversation")).toBe("新建会话")
    expect(t("conversation.workspace.placeholderDraftOnly")).toBe(
      "可输入草稿；当前路径暂无法发送。",
    )
  })

  it("interpolates parameterized entries", () => {
    expect(t("settings.providers.deleteConfirm", { name: "OpenAI" })).toBe(
      "删除「OpenAI」？",
    )
    expect(t("settings.providers.removeModelAria", { model: "gpt-4o" })).toBe(
      "移除 gpt-4o",
    )
    expect(
      t("conversation.outline.togglePreview", {
        expanded: true,
        label: "帮我写一封信",
      }),
    ).toBe("收起 帮我写一封信")
    expect(t("conversation.messageBubble.messageAria", { role: "用户" })).toBe(
      "用户消息",
    )
  })

  it("handles the English plural form inside the params function", () => {
    useLocaleStore.getState().setLocale("en")
    expect(
      t("providers.modelsSummary.more", { head: "a, b", remaining: 1 }),
    ).toBe("a, b +1 more")
    expect(
      t("providers.modelsSummary.more", { head: "a, b", remaining: 3 }),
    ).toBe("a, b +3 more")
    expect(t("providers.modelsSummary.empty")).toBe("No models added")
  })

  it("keeps the Chinese summary without plural forms", () => {
    expect(
      t("providers.modelsSummary.more", { head: "a, b", remaining: 3 }),
    ).toBe("a, b 等 3 个")
  })

  it("switches with setLocale", () => {
    expect(t("common.close")).toBe("关闭")
    useLocaleStore.getState().setLocale("en")
    expect(t("common.close")).toBe("Close")
    useLocaleStore.getState().setLocale("zh-CN")
    expect(t("common.close")).toBe("关闭")
  })

  it("falls back to zh-CN for an unknown locale in the store", () => {
    // Defensive: the store type is closed, but dirty persisted data could
    // smuggle an unsupported value in. Anything but "en" reads zh-CN.
    useLocaleStore.setState({ locale: "fr-FR" as SupportedLocale })
    expect(t("common.close")).toBe("关闭")
  })
})

describe("useTranslation", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-CN")
  })

  it("exposes the active locale and re-renders on setLocale", () => {
    const { result } = renderHook(() => useTranslation())
    expect(result.current.locale).toBe("zh-CN")
    expect(result.current.t("common.close")).toBe("关闭")

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(result.current.locale).toBe("en")
    expect(result.current.t("common.close")).toBe("Close")

    act(() => {
      useLocaleStore.getState().setLocale("zh-CN")
    })
    expect(result.current.locale).toBe("zh-CN")
    expect(result.current.t("common.close")).toBe("关闭")
  })
})

describe("dictionary parity", () => {
  it("ships identical key sets for both locales", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
  })
})
