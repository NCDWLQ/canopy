import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
import { useLocaleStore } from "@/lib/i18n/locale-store"
import { THEME_COLORS, useThemeStore } from "@/lib/theme"

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
    setThemeColor: vi.fn().mockResolvedValue("neutral"),
    setDefaultSystemPrompt: vi.fn().mockResolvedValue(null),
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
    useThemeStore.getState().setThemeColorPreference("neutral")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      themeColor: "neutral",
    })
  })

  it("shows the current persisted theme preference", () => {
    useProviderStore.setState({ theme: "dark" })
    render(<AppearanceSettingsPanel client={client() as ProviderClient} />)

    expect(screen.getByRole("radio", { name: "深色模式" })).toBeChecked()
  })

  it("persists an explicit theme selection and switches the UI theme", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTheme.mockResolvedValue("dark")
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    await user.click(screen.getByRole("radio", { name: "深色模式" }))

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
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    await user.click(screen.getByRole("radio", { name: "深色模式" }))

    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith("dark"))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("外观设置未保存"),
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "对话数据库当前不可用。",
    )
    expect(screen.getByRole("radio", { name: "浅色模式" })).toBeChecked()
    expect(useProviderStore.getState().theme).toBe("light")
  })

  it("retranslates labels when switching locale", () => {
    const bridge = client()
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(screen.getByRole("radio", { name: "Follow system" })).toBeChecked()
  })

  it("shows the current persisted theme color preference and its swatch", () => {
    useProviderStore.setState({ themeColor: "blue" })
    render(<AppearanceSettingsPanel client={client() as ProviderClient} />)

    const trigger = screen.getByRole("combobox", { name: "主题色" })
    expect(trigger).toHaveTextContent("蓝色")
    expect(
      trigger.querySelector<HTMLSpanElement>('span[aria-hidden="true"]')?.style
        .backgroundColor,
    ).toBe("var(--theme-color-blue-primary)")
  })

  it("shows all seven theme colors with matching swatches", async () => {
    const user = userEvent.setup()
    render(<AppearanceSettingsPanel client={client() as ProviderClient} />)

    await user.click(screen.getByRole("combobox", { name: "主题色" }))

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(THEME_COLORS.length)
    const labels = ["中性", "蓝色", "绿色", "橙色", "红色", "玫红", "紫色"]
    THEME_COLORS.forEach((color, index) => {
      expect(options[index]).toHaveAccessibleName(labels[index])
      const swatch = options[index]?.querySelector<HTMLSpanElement>(
        `span[style*="--theme-color-${color}-primary"]`,
      )
      expect(swatch).toHaveAttribute("aria-hidden", "true")
    })
  })

  it("persists an explicit theme color selection and applies it to the UI theme store", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setThemeColor.mockResolvedValue("violet")
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: "紫色" }))

    await waitFor(() =>
      expect(bridge.setThemeColor).toHaveBeenCalledWith("violet"),
    )
    await waitFor(() =>
      expect(useProviderStore.getState().themeColor).toBe("violet"),
    )
    expect(useThemeStore.getState().themeColor).toBe("violet")
  })

  it("supports keyboard selection for the theme color", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setThemeColor.mockResolvedValue("blue")
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    const trigger = screen.getByRole("combobox", { name: "主题色" })
    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard("{Enter}{ArrowDown}{Enter}")

    await waitFor(() =>
      expect(bridge.setThemeColor).toHaveBeenCalledWith("blue"),
    )
  })

  it("keeps the previous theme color when saving fails", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setThemeColor.mockRejectedValue(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "database unavailable",
        retryable: false,
      }),
    )
    useProviderStore.setState({ themeColor: "green" })
    useThemeStore.getState().setThemeColorPreference("green")
    render(<AppearanceSettingsPanel client={bridge as ProviderClient} />)

    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByRole("option", { name: "红色" }))

    await waitFor(() =>
      expect(bridge.setThemeColor).toHaveBeenCalledWith("red"),
    )
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("外观设置未保存"),
    )
    expect(screen.getByRole("combobox")).toHaveTextContent("绿色")
    expect(useProviderStore.getState().themeColor).toBe("green")
    expect(useThemeStore.getState().themeColor).toBe("green")
  })

  it("disables the theme color select while settings are loading", () => {
    useProviderStore.setState({ phase: "loading" })
    render(<AppearanceSettingsPanel client={client() as ProviderClient} />)

    expect(screen.getByRole("combobox", { name: "主题色" })).toBeDisabled()
  })

  it("retranslates the theme color field and selected value", () => {
    render(<AppearanceSettingsPanel client={client() as ProviderClient} />)

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(
      screen.getByRole("combobox", { name: "Theme color" }),
    ).toHaveTextContent("Neutral")
  })
})
