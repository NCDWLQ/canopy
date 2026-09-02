import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"

import { ConversationSettingsPanel } from "./ConversationSettingsPanel"
import { useProviderStore } from "@/features/providers/store"
import type { ProviderView } from "@/features/providers/types"
import type { ProviderClient } from "@/lib/tauri"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const toastSuccessMock = vi.mocked(toast.success)

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

describe("ConversationSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      defaultSystemPrompt: null,
    })
  })

  it("configures automatic titles in the conversation category", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTitleModelBinding.mockImplementation((binding) =>
      Promise.resolve(binding),
    )
    render(<ConversationSettingsPanel client={bridge as ProviderClient} />)

    const toggle = screen.getByRole("switch", {
      name: "自动生成标题",
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByText("首轮对话后，使用下方配置的模型自动生成标题"),
    ).toBeVisible()
    expect(toggle.closest("fieldset")).toContainElement(
      screen.getByText("标题模型"),
    )
    expect(
      screen.getByText("标题模型").closest("[data-slot=field]"),
    ).toHaveClass("pl-4")
    await user.click(screen.getByRole("combobox", { name: "标题模型" }))
    expect(
      await screen.findByRole("option", { name: "跟随对话" }),
    ).toBeVisible()
    expect(screen.getByRole("group", { name: provider.name })).toBeVisible()
    await user.click(
      await screen.findByRole("option", { name: provider.model }),
    )
    await waitFor(() =>
      expect(bridge.setTitleModelBinding).toHaveBeenCalledWith({
        providerId: provider.id,
        model: provider.model,
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "标题模型" }),
      ).toHaveTextContent(provider.model),
    )
    expect(screen.getByRole("combobox", { name: "标题模型" })).toBeEnabled()

    useProviderStore.setState({ autoGenerateTitle: false })
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "标题模型" })).toBeDisabled(),
    )
  })

  it("saves a dirty default system prompt and can clear it", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setDefaultSystemPrompt.mockResolvedValueOnce("Be helpful")
    render(<ConversationSettingsPanel client={bridge as ProviderClient} />)

    const textarea = screen.getByRole("textbox", { name: "默认系统提示词" })
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    await user.type(textarea, "Be helpful")
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(bridge.setDefaultSystemPrompt).toHaveBeenCalledWith("Be helpful"),
    )
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith("默认系统提示词已保存。"),
    )

    useProviderStore.setState({ defaultSystemPrompt: "Be helpful" })
    await waitFor(() => expect(textarea).toHaveValue("Be helpful"))
    await user.clear(textarea)
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(bridge.setDefaultSystemPrompt).toHaveBeenCalledWith(null),
    )
  })

  it("keeps the draft and surfaces an error alert when saving fails", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setDefaultSystemPrompt.mockRejectedValueOnce(new Error("offline"))
    render(<ConversationSettingsPanel client={bridge as ProviderClient} />)

    const textarea = screen.getByRole("textbox", { name: "默认系统提示词" })
    await user.type(textarea, "Be helpful")
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(await screen.findByText("对话设置未保存")).toBeVisible()
    expect(screen.getByText("发生意外错误。")).toBeVisible()
    // The draft is preserved for retry and no success toast fires.
    expect(textarea).toHaveValue("Be helpful")
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})
