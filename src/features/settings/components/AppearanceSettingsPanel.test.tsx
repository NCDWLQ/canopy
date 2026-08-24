import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
import { useLocaleStore } from "@/lib/i18n/locale-store"
import { useThemeStore } from "@/lib/theme"

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

describe("AppearanceSettingsPanel", () => {
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
    useThemeStore.getState().setThemePreference("system")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
    })
  })

  it("shows the current persisted theme preference", () => {
    useProviderStore.setState({ theme: "dark" })
    render(
      <AppearanceSettingsPanel
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )

    expect(
      screen.getByRole("combobox", { name: "主题模式" }),
    ).toHaveTextContent("深色模式")
  })

  it("persists an explicit theme selection and switches the UI theme", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTheme.mockResolvedValue("dark")
    render(
      <AppearanceSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("combobox", { name: "主题模式" }))
    await user.click(await screen.findByRole("option", { name: "深色模式" }))

    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith("dark"))
    await waitFor(() => expect(useProviderStore.getState().theme).toBe("dark"))
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().resolvedTheme).toBe("dark")
  })

  it("keeps the previous preference and surfaces the error when saving fails", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTheme.mockRejectedValue(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "database unavailable",
        retryable: false,
      }),
    )
    useProviderStore.setState({ theme: "light" })
    render(
      <AppearanceSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("combobox", { name: "主题模式" }))
    await user.click(await screen.findByRole("option", { name: "深色模式" }))

    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith("dark"))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("外观设置未保存"),
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "会话数据库当前不可用。",
    )
    expect(
      screen.getByRole("combobox", { name: "主题模式" }),
    ).toHaveTextContent("浅色模式")
    expect(useProviderStore.getState().theme).toBe("light")
  })

  it("disables the theme control while read-only", () => {
    render(
      <AppearanceSettingsPanel client={client() as ProviderClient} readOnly />,
    )

    expect(screen.getByRole("combobox", { name: "主题模式" })).toBeDisabled()
  })

  it("retranslates labels when switching locale", () => {
    const bridge = client()
    render(
      <AppearanceSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(
      screen.getByRole("combobox", { name: "Theme mode" }),
    ).toHaveTextContent("Follow system")
  })
})
