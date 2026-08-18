import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SettingsDialog } from "./SettingsDialog"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import type { DiagnosticsClient, ProviderClient } from "@/lib/tauri"

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

function diagnosticsClient(): DiagnosticsClient {
  return {
    getLoggingSettings: vi.fn().mockResolvedValue({
      configured: { maxFileMib: 5, maxFiles: 5 },
      active: { maxFileMib: 5, maxFiles: 5 },
      limits: {
        defaultMaxFileMib: 5,
        defaultMaxFiles: 5,
        maxFileMib: 20,
        maxFiles: 10,
        maxTotalMib: 100,
      },
      configStatus: "default",
      sinkStatus: "persistent",
      restartRequired: false,
    }),
    saveLoggingSettings: vi.fn(),
    openLogDirectory: vi.fn(),
  }
}

function client() {
  return {
    listProviders: vi.fn(),
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setActiveProvider: vi.fn(),
    setAutoGenerateTitle: vi.fn().mockResolvedValue(true),
    setTitleModelBinding: vi.fn().mockResolvedValue(null),
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
    })
  })

  it("opens on the provider list with category nav and breadcrumb", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog client={client() as ProviderClient} readOnly={false} />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    expect(screen.getByRole("navigation", { name: "设置分类" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "模型提供商", current: "page" }),
    ).toBeVisible()
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
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })

  it("supports controlled opening and resets to the provider list on reopen", async () => {
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
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
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
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })

  it("clears provider editor state when switching to conversation and back", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.revealProviderApiKey.mockResolvedValue("STORED_SECRET_SENTINEL")
    render(
      <SettingsDialog
        client={bridge as ProviderClient}
        diagnosticsClient={diagnosticsClient()}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    const field = screen.getByLabelText("API 密钥")
    await waitFor(() => expect(field).toHaveValue("STORED_SECRET_SENTINEL"))
    await user.click(screen.getByRole("button", { name: "会话" }))
    expect(screen.getByRole("heading", { name: "会话" })).toBeVisible()
    expect(screen.getByRole("switch", { name: "自动生成标题" })).toBeVisible()
    expect(screen.queryByLabelText("API 密钥")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "诊断" }))
    expect(screen.getByRole("heading", { name: "诊断" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("API 密钥")).not.toBeInTheDocument()
  })

  it("keeps diagnostics available when conversation settings are read-only", async () => {
    const user = userEvent.setup()
    render(
      <SettingsDialog
        client={client() as ProviderClient}
        diagnosticsClient={diagnosticsClient()}
        readOnly
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(screen.getByRole("button", { name: "诊断" }))
    expect(screen.getByRole("heading", { name: "诊断" })).toBeVisible()
    expect(screen.getByRole("button", { name: "打开日志目录" })).toBeEnabled()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled(),
    )
  })
})
