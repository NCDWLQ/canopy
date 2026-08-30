import { describe, expect, it } from "vitest"

import { providerCommandErrorMessage } from "./provider-error-message"
import { useLocaleStore } from "@/lib/i18n/locale-store"

describe("providerCommandErrorMessage", () => {
  it("maps duplicate provider names to a specific message", () => {
    useLocaleStore.getState().setLocale("zh-CN")
    expect(
      providerCommandErrorMessage(
        {
          code: "invalid_input",
          details: { field: "name", reason: "duplicate" },
        },
        { name: "DeepSeek" },
      ),
    ).toBe("名称「DeepSeek」已被使用")
  })

  it("falls back to the generic invalid-input message without a name", () => {
    useLocaleStore.getState().setLocale("zh-CN")
    expect(
      providerCommandErrorMessage({
        code: "invalid_input",
        details: { field: "name", reason: "duplicate" },
      }),
    ).toBe("请求包含无效输入。")
  })
})
