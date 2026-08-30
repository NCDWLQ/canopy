import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SettingsDialog } from "./SettingsDialog"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import type { ProviderClient } from "@/lib/tauri"

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
    setDefaultSystemPrompt: vi.fn().mockResolvedValue(null),
    revealProviderApiKey: vi.fn().mockResolvedValue(null),
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
}

function setupDom() {
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
}

describe("SettingsDialog", () => {
  beforeEach(() => {
    setupDom()
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

  it("opens on the general category; providers render on demand", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog client={client() as ProviderClient} readOnly={false} />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "通用", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("combobox", { name: "语言" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "全部提供商" }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.getByLabelText("当前全局默认")).toHaveTextContent("默认")
    expect(screen.getByText("fixture-model")).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    expect(screen.getByLabelText("名称")).toBeVisible()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "设置" }))
    // Reopening resets to the general category and clears the editor.
    expect(screen.getByRole("combobox", { name: "语言" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })

  it("navigates from the default general panel to appearance", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog client={client() as ProviderClient} readOnly={false} />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    const appearance = screen.getByRole("button", { name: "外观" })
    expect(appearance).toBeVisible()
    expect(appearance).not.toHaveAttribute("aria-current")

    await user.click(appearance)
    expect(
      screen.getByRole("button", { name: "外观", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("combobox", { name: "主题模式" })).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "语言" }),
    ).not.toBeInTheDocument()
  })

  it("navigates from the default general panel to providers", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog client={client() as ProviderClient} readOnly={false} />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    const providers = screen.getByRole("button", { name: "模型提供商" })
    expect(providers).toBeVisible()
    expect(providers).not.toHaveAttribute("aria-current")
    expect(
      screen.getByRole("button", { name: "通用", current: "page" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "全部提供商" }),
    ).not.toBeInTheDocument()

    await user.click(providers)
    expect(
      screen.getByRole("button", { name: "模型提供商", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "语言" }),
    ).not.toBeInTheDocument()
  })

  it("supports controlled opening and resets to the general panel on reopen", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const bridge = client() as ProviderClient
    const { rerender } = render(
      <SettingsDialog
        client={bridge}
        readOnly={false}
        open={false}
        onOpenChange={onOpenChange}
      />,
    )
    rerender(
      <SettingsDialog
        client={bridge}
        readOnly={false}
        open
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.getByRole("combobox", { name: "语言" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    expect(screen.getByLabelText("名称")).toBeVisible()
    rerender(
      <SettingsDialog
        client={bridge}
        readOnly={false}
        open={false}
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    rerender(
      <SettingsDialog
        client={bridge}
        readOnly={false}
        open
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.getByRole("combobox", { name: "语言" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "全部提供商" }),
    ).not.toBeInTheDocument()
  })

  it("clears provider editor state when switching to conversation and back", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.revealProviderApiKey.mockResolvedValue("STORED_SECRET_SENTINEL")
    render(
      <SettingsDialog client={bridge as ProviderClient} readOnly={false} />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    const field = screen.getByLabelText("API 密钥")
    await waitFor(() => expect(field).toHaveValue("STORED_SECRET_SENTINEL"))
    await user.click(screen.getByRole("button", { name: "对话" }))
    expect(screen.getByRole("switch", { name: "自动生成标题" })).toBeVisible()
    expect(screen.queryByLabelText("API 密钥")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("API 密钥")).not.toBeInTheDocument()
  })

  it("opens directly to the specified initialCategory panel", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
        initialCategory="providers"
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    expect(
      screen.getByRole("button", { name: "模型提供商", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "语言" }),
    ).not.toBeInTheDocument()
  })

  it("opens directly to initialCategory in controlled mode", () => {
    const onOpenChange = vi.fn()
    render(
      <SettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
        open
        onOpenChange={onOpenChange}
        initialCategory="conversation"
      />,
    )
    expect(
      screen.getByRole("button", { name: "对话", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("switch", { name: "自动生成标题" })).toBeVisible()
    expect(
      screen.queryByRole("combobox", { name: "语言" }),
    ).not.toBeInTheDocument()
  })
})
