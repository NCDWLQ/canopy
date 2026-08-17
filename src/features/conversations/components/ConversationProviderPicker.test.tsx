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
      draftBinding: null,
      draftReasoningEffort: null,
    })
  })

  it("shows the default badge and opens workspace settings from the picker", async () => {
    const user = userEvent.setup()
    const onManageProviders = vi.fn()
    const conversationClient = {
      setConversationProvider: vi.fn(),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        draftMode={false}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={onManageProviders}
      />,
    )
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    ).toHaveTextContent("gpt-default")
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    ).not.toHaveTextContent("OpenAI")
    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    expect(screen.queryByText("跟随全局默认")).toBeNull()
    expect(screen.getByRole("listbox", { name: "服务提供商" })).toBeVisible()
    expect(screen.getByRole("listbox", { name: "模型" })).toBeVisible()
    const providerOption = screen.getByRole("option", { name: /OpenAI/ })
    expect(providerOption).toHaveAttribute("aria-selected", "true")
    expect(providerOption).toHaveTextContent("默认")
    expect(providerOption).not.toHaveTextContent("gpt-default")
    const defaultModel = screen.getByRole("option", { name: /gpt-default/ })
    expect(defaultModel).toHaveAttribute("aria-selected", "true")
    expect(defaultModel).toHaveTextContent("默认")
    expect(screen.getByRole("option", { name: "gpt-alt" })).toBeVisible()
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
        draftMode={false}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    await user.click(screen.getByRole("option", { name: /OpenAI/ }))

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
        draftMode={false}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    await user.click(screen.getByRole("option", { name: "gpt-alt" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: "gpt-alt" },
      reasoningEffort: null,
    })
  })

  it("snapshots the effective binding when changing effort on an unbound session", async () => {
    const user = userEvent.setup()
    const conversationClient = {
      setConversationProvider: vi.fn().mockResolvedValue({
        id: "conversation-1",
        providerId: provider.id,
        model: provider.model,
        reasoningEffort: "high",
      }),
    } as unknown as ConversationClient
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        draftMode={false}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    await user.click(screen.getByRole("radio", { name: "高" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: provider.model },
      reasoningEffort: "high",
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
        draftMode={false}
        providerId={provider.id}
        model={provider.model}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    await user.click(screen.getByRole("radio", { name: "高" }))

    expect(conversationClient.setConversationProvider).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      binding: { providerId: provider.id, model: provider.model },
      reasoningEffort: "high",
    })

    view.rerender(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        draftMode={false}
        providerId={provider.id}
        model={provider.model}
        reasoningEffort="high"
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    ).toHaveTextContent("gpt-default · 高")
    await user.click(screen.getByRole("radio", { name: "默认" }))
    expect(conversationClient.setConversationProvider).toHaveBeenLastCalledWith(
      {
        conversationId: "conversation-1",
        binding: { providerId: provider.id, model: provider.model },
        reasoningEffort: null,
      },
    )
  })

  it("writes draft state instead of IPC while composing a new conversation", async () => {
    const user = userEvent.setup()
    const setConversationProvider = vi.fn()
    const conversationClient = {
      setConversationProvider,
    } as unknown as ConversationClient
    useConversationStore.setState({ conversationId: null })
    render(
      <ConversationProviderPicker
        conversationClient={conversationClient}
        draftMode
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly={false}
        onManageProviders={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    await user.click(screen.getByRole("option", { name: "gpt-alt" }))

    expect(setConversationProvider).not.toHaveBeenCalled()
    expect(useConversationStore.getState().draftBinding).toEqual({
      providerId: provider.id,
      model: "gpt-alt",
    })
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
        draftMode={false}
        providerId={null}
        model={null}
        reasoningEffort={null}
        readOnly
        onManageProviders={vi.fn()}
      />,
    )

    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    )
    expect(setConversationProvider).not.toHaveBeenCalled()
  })
})
