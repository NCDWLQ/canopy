import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationSettingsPanel } from "./ConversationSettingsPanel"
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
    revealProviderApiKey: vi.fn().mockResolvedValue(null),
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
}

describe("ConversationSettingsPanel", () => {
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
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
    })
  })

  it("configures automatic titles in the conversation category", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTitleModelBinding.mockImplementation((binding) =>
      Promise.resolve(binding),
    )
    render(
      <ConversationSettingsPanel
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )

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
})
