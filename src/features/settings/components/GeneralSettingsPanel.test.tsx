import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GeneralSettingsPanel } from "./GeneralSettingsPanel"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
import { useLocaleStore } from "@/lib/i18n/locale-store"

const provider: ProviderView = {
  id: "provider-1",
  name: "OpenAI",
  protocol: "openai_compatible",
  baseEndpoint: "http://127.0.0.1:7788/v1",
  model: "fixture-model",
  models: ["fixture-model"],
  hasApiKey: true,
  createdAt: 1,
  updatedAt: 10,
}

function client() {
  return {
    listProviders: vi.fn(),
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setActiveProvider: vi.fn(),
    setAutoGenerateTitle: vi.fn().mockResolvedValue(true),
    setTitleModelBinding: vi.fn().mockResolvedValue(null),
    setLanguage: vi.fn().mockResolvedValue("system"),
    setTheme: vi.fn().mockResolvedValue("system"),
    revealProviderApiKey: vi.fn().mockResolvedValue(null),
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
}

describe("GeneralSettingsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
    Element.prototype.scrollIntoView = () => {}
    useLocaleStore.getState().setLocale("zh-CN")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
    })
  })

  it("shows the current persisted language preference", () => {
    useProviderStore.setState({ language: "en" })
    render(
      <GeneralSettingsPanel
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )

    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "English",
    )
  })

  it("persists an explicit language selection and switches the UI locale", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setLanguage.mockResolvedValue("en")
    render(
      <GeneralSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("combobox", { name: "语言" }))
    await user.click(await screen.findByRole("option", { name: "English" }))

    await waitFor(() => expect(bridge.setLanguage).toHaveBeenCalledWith("en"))
    await waitFor(() => expect(useProviderStore.getState().language).toBe("en"))
    // An explicit "en" preference pins the en locale regardless of the OS.
    expect(useLocaleStore.getState().locale).toBe("en")
    expect(
      await screen.findByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("English")
  })

  it("sends the system preference and recomputes the locale from the OS", async () => {
    // Pin the OS locale instead of relying on jsdom's navigator default.
    Object.defineProperty(window.navigator, "languages", {
      value: ["en-US"],
      configurable: true,
    })
    try {
      const user = userEvent.setup()
      const bridge = client()
      bridge.setLanguage.mockResolvedValue("system")
      useProviderStore.setState({ language: "zh-CN" })
      render(
        <GeneralSettingsPanel
          client={bridge as ProviderClient}
          readOnly={false}
        />,
      )

      await user.click(screen.getByRole("combobox", { name: "语言" }))
      await user.click(await screen.findByRole("option", { name: "跟随系统" }))

      await waitFor(() =>
        expect(bridge.setLanguage).toHaveBeenCalledWith("system"),
      )
      await waitFor(() =>
        expect(useProviderStore.getState().language).toBe("system"),
      )
      // The pinned zh-CN UI follows the (pinned) English OS locale again.
      expect(useLocaleStore.getState().locale).toBe("en")
    } finally {
      Reflect.deleteProperty(window.navigator, "languages")
    }
  })

  it("keeps the previous preference and surfaces the error when saving fails", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setLanguage.mockRejectedValue(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "database unavailable",
        retryable: false,
      }),
    )
    useProviderStore.setState({ language: "zh-CN" })
    render(
      <GeneralSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("combobox", { name: "语言" }))
    await user.click(await screen.findByRole("option", { name: "English" }))

    await waitFor(() => expect(bridge.setLanguage).toHaveBeenCalledWith("en"))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("语言设置未保存"),
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "会话数据库当前不可用。",
    )
    // The select still reflects the unchanged persisted preference.
    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "简体中文",
    )
    expect(useProviderStore.getState().language).toBe("zh-CN")
    expect(useLocaleStore.getState().locale).toBe("zh-CN")
  })

  it("disables the language control while read-only", () => {
    render(
      <GeneralSettingsPanel client={client() as ProviderClient} readOnly />,
    )

    expect(screen.getByRole("combobox", { name: "语言" })).toBeDisabled()
  })

  it("reloads nothing on its own; switching locale retranslates labels", () => {
    const bridge = client()
    render(
      <GeneralSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    expect(bridge.listProviders).not.toHaveBeenCalled()
    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("Follow system")
  })
})
