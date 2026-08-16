import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationProviderPicker } from "./ConversationProviderPicker"
import { useConversationStore } from "../store"
import { useProviderStore } from "@/features/providers/store"
import type { ConversationClient } from "@/lib/tauri"

const provider = {
  id: "provider-1",
  name: "OpenAI",
  protocol: "openai_compatible" as const,
  baseEndpoint: "https://api.example.com/v1",
  model: "gpt-default",
  models: ["gpt-default", "gpt-alt"],
  hasApiKey: true,
  createdAt: 1,
  updatedAt: 1,
}

describe("ConversationProviderPicker", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    useConversationStore.setState({
      conversationId: "conversation-1",
      isArchived: false,
      providerId: null,
      model: null,
      reasoningEffort: null,
    })
  })

  it("shows the effective global model and opens workspace settings from the picker", async () => {
    const user = userEvent.setup()
    const onManageProviders = vi.fn()
    const conversationClient = {
      setConversationProvider: vi.fn(),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={onManageProviders}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    expect(screen.getByText("跟随全局默认")).toBeVisible()
    expect(screen.getByRole("button", { name: "gpt-default" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "管理服务提供商…" }))
    expect(onManageProviders).toHaveBeenCalledOnce()
  })

  it("binds the provider with its default model when selected from the list", async () => {
    const user = userEvent.setup()
    const conversationClient = {
      setConversationProvider: vi.fn().mockResolvedValue({
        id: "conversation-1",
        providerId: provider.id,
        model: provider.model,
        reasoningEffort: null,
      }),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    await user.click(screen.getByRole("button", { name: /OpenAI/ }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: provider.model },
      reasoningEffort: null,
    })
  })

  it("switches the model within the provider's persisted list", async () => {
    const user = userEvent.setup()
    const conversationClient = {
      setConversationProvider: vi.fn().mockResolvedValue({
        id: "conversation-1",
        providerId: provider.id,
        model: "gpt-alt",
        reasoningEffort: null,
      }),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    await user.click(screen.getByRole("button", { name: "gpt-alt" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: "gpt-alt" },
      reasoningEffort: null,
    })
  })

  it("clears the binding back to the global default while keeping effort", async () => {
    const user = userEvent.setup()
    const conversationClient = {
      setConversationProvider: vi.fn().mockResolvedValue({
        id: "conversation-1",
        providerId: null,
        model: null,
        reasoningEffort: "low",
      }),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={provider.id}
        model={provider.model}
        reasoningEffort="low"
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    await user.click(screen.getByRole("button", { name: "跟随全局默认" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: null,
      reasoningEffort: "low",
    })
  })

  it("submits effort independently of an existing binding", async () => {
    const user = userEvent.setup()
    const conversationClient = {
      setConversationProvider: vi.fn().mockResolvedValue({
        id: "conversation-1",
        providerId: provider.id,
        model: provider.model,
        reasoningEffort: "high",
      }),
    } as unknown as ConversationClient
    const view = render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={provider.id}
        model={provider.model}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    await user.click(screen.getByRole("radio", { name: "高" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: provider.model },
      reasoningEffort: "high",
    })

    // 未选择（默认）不发参数：切换回「默认」提交 null。保存成功后 store
    // 会把持久化的 effort 回灌为 prop（此处用 rerender 模拟父组件重渲染）。
    view.rerender(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={provider.id}
        model={provider.model}
        reasoningEffort="high"
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )
    await user.click(screen.getByRole("radio", { name: "默认" }))
    expect(conversationClient.setConversationProvider).toHaveBeenLastCalledWith(
      {
        conversationId: "conversation-1",
        binding: { providerId: provider.id, model: provider.model },
        reasoningEffort: null,
      },
    )
  })

  it("disables every binding control for archived conversations", async () => {
    const user = userEvent.setup()
    const setConversationProvider = vi.fn()
    const conversationClient = {
      setConversationProvider,
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly
        onManageProviders={vi.fn()}
      />,
    )

    expect(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole("button", { name: "选择服务提供商和模型" }),
    )
    expect(setConversationProvider).not.toHaveBeenCalled()
  })
})
