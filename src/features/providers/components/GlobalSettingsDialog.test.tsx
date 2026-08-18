import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GlobalSettingsDialog } from "./GlobalSettingsDialog"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
import type { ProviderClient } from "@/lib/tauri"

type SaveProviderInput = Parameters<ProviderClient["saveProvider"]>[0]

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
    revealProviderApiKey: vi.fn().mockResolvedValue(null),
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
}

async function openProviderEditor(
  user: ReturnType<typeof userEvent.setup>,
  providerName = provider.name,
) {
  await user.click(screen.getByRole("button", { name: "设置" }))
  await user.click(
    screen.getByRole("button", { name: `编辑：${providerName}` }),
  )
}

describe("GlobalSettingsDialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
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
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
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
  })

  it("configures automatic titles in the conversation category", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.setTitleModelBinding.mockImplementation((binding) =>
      Promise.resolve(binding),
    )
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(screen.getByRole("button", { name: "会话" }))

    const toggle = screen.getByRole("switch", {
      name: "自动生成会话标题",
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(toggle.closest("fieldset")).toContainElement(
      screen.getByText("标题模型"),
    )
    expect(
      screen.getByText("标题模型").closest("[data-slot=field]"),
    ).toHaveClass("pl-4")
    await user.click(screen.getByRole("button", { name: "跟随会话" }))
    await user.click(
      screen.getByRole("menuitem", {
        name: `${provider.name} · ${provider.model}`,
      }),
    )
    await waitFor(() =>
      expect(bridge.setTitleModelBinding).toHaveBeenCalledWith({
        providerId: provider.id,
        model: provider.model,
      }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `${provider.name} · ${provider.model}`,
        }),
      ).toBeEnabled(),
    )

    useProviderStore.setState({ autoGenerateTitle: false })
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `${provider.name} · ${provider.model}`,
        }),
      ).toBeDisabled(),
    )
  })

  it("summarizes long model lists on each provider row", async () => {
    const user = userEvent.setup()
    useProviderStore.setState({
      phase: "ready",
      providers: [
        {
          ...provider,
          models: ["alpha", "beta", "gamma", "delta"],
        },
      ],
      activeProviderId: provider.id,
    })
    render(
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    expect(screen.getByText("alpha, beta 等 2 个")).toBeVisible()
  })

  it("keeps the saved draft values after a successful save", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.saveProvider.mockImplementation((input: SaveProviderInput) =>
      Promise.resolve({
        ...provider,
        name: input.name,
        baseEndpoint: input.baseEndpoint,
        model: input.model,
        models: [...input.models],
        updatedAt: 11,
      }),
    )
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    const name = screen.getByLabelText("名称")
    await user.clear(name)
    await user.type(name, "Renamed")
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed" }),
      ),
    )
    expect(screen.getByLabelText("名称")).toHaveValue("Renamed")
  })

  it("reveals the saved key masked, toggles visibility, and keeps it when unchanged", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.revealProviderApiKey.mockResolvedValue("STORED_SECRET_SENTINEL")
    bridge.saveProvider.mockResolvedValue({ ...provider, updatedAt: 11 })
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    expect(bridge.revealProviderApiKey).toHaveBeenCalledWith(provider.id)
    const field = screen.getByLabelText("API 密钥")
    await waitFor(() => expect(field).toHaveValue("STORED_SECRET_SENTINEL"))
    expect(field).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "显示 API 密钥" }))
    expect(field).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "隐藏 API 密钥" })).toBeVisible()

    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: { action: "keep" },
        }),
      ),
    )
    // A successful save reselects the provider, which reveals the key again.
    await waitFor(() =>
      expect(bridge.revealProviderApiKey).toHaveBeenCalledTimes(2),
    )
    expect(JSON.stringify(useProviderStore.getState())).not.toContain(
      "STORED_SECRET_SENTINEL",
    )
  })

  it("sends replace when the revealed key is edited", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.revealProviderApiKey.mockResolvedValue("OLD_SECRET_SENTINEL")
    bridge.saveProvider.mockResolvedValue({ ...provider, updatedAt: 11 })
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    const field = screen.getByLabelText("API 密钥")
    await waitFor(() => expect(field).toHaveValue("OLD_SECRET_SENTINEL"))
    await user.clear(field)
    await user.type(field, "DIALOG_SECRET_SENTINEL")
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseEndpoint: provider.baseEndpoint,
        model: provider.model,
        models: provider.models,
        apiKey: { action: "replace", value: "DIALOG_SECRET_SENTINEL" },
      }),
    )
  })

  it("sends remove when the revealed key is cleared, but keep when the reveal failed", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.revealProviderApiKey.mockResolvedValueOnce("OLD_SECRET_SENTINEL")
    bridge.saveProvider.mockResolvedValue({ ...provider, updatedAt: 11 })
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    const field = screen.getByLabelText("API 密钥")
    await waitFor(() => expect(field).toHaveValue("OLD_SECRET_SENTINEL"))
    await user.clear(field)
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: { action: "remove" } }),
      ),
    )

    // Return to list, then re-open; reveal fails so empty field must keep.
    bridge.revealProviderApiKey.mockRejectedValueOnce(new Error("keyring"))
    bridge.saveProvider.mockClear()
    await user.click(screen.getByRole("button", { name: "返回模型提供商列表" }))
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    await waitFor(() =>
      expect(bridge.revealProviderApiKey).toHaveBeenCalledTimes(3),
    )
    expect(field).toHaveValue("")
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: { action: "keep" } }),
      ),
    )
  })

  it("fetches draft models and adds one to the provider list before saving", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.listProviderModels.mockResolvedValueOnce([{ id: "gpt-test" }])
    bridge.saveProvider.mockResolvedValueOnce({
      ...provider,
      models: ["fixture-model", "gpt-test"],
      updatedAt: 11,
    })
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    await user.click(screen.getByRole("button", { name: "获取模型列表" }))
    await user.click(
      await screen.findByRole("button", { name: "加入模型：gpt-test" }),
    )
    expect(
      screen.getByRole("button", { name: "设为默认：gpt-test" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))
    await waitFor(() =>
      expect(bridge.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "fixture-model",
          models: ["fixture-model", "gpt-test"],
        }),
      ),
    )
  })

  it("adds a fetched model by its ID even when a display name exists", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.listProviderModels.mockResolvedValueOnce([
      {
        id: "claude-sonnet-4-20250514",
        displayName: "Claude Sonnet 4",
      },
    ])
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    await user.click(screen.getByRole("button", { name: "获取模型列表" }))
    await user.click(
      await screen.findByRole("button", {
        name: "加入模型：claude-sonnet-4-20250514",
      }),
    )
    expect(
      screen.getByRole("button", {
        name: "设为默认：claude-sonnet-4-20250514",
      }),
    ).toBeVisible()
  })

  it("keeps the editor viewable but disables mutations for archived conversations", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog client={client() as ProviderClient} readOnly />,
    )
    await openProviderEditor(user)
    expect(screen.getByText("只读")).toBeVisible()
    expect(screen.getByLabelText("名称")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "保存模型提供商" }),
    ).toBeDisabled()
  })

  it("returns to the list via the model-provider breadcrumb", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    expect(screen.getByLabelText("名称")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "返回模型提供商列表" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })

  it("cancels creating a provider and returns to the list", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(screen.getByRole("button", { name: "新建" }))
    expect(
      screen.getByRole("heading", { name: "新建模型提供商" }),
    ).toBeVisible()
    await user.type(screen.getByLabelText("名称"), "draft")
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })

  it("cancels editing a provider and returns to the list", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )
    await openProviderEditor(user)
    const name = screen.getByLabelText("名称")
    await user.clear(name)
    await user.type(name, "Unsaved rename")
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: `编辑：${provider.name}` }),
    )
    expect(screen.getByLabelText("名称")).toHaveValue(provider.name)
  })

  it("sets the global default from the provider row more menu", async () => {
    const user = userEvent.setup()
    const bridge = client()
    const other: ProviderView = {
      ...provider,
      id: "provider-2",
      name: "Anthropic",
      hasApiKey: false,
    }
    useProviderStore.setState({
      phase: "ready",
      providers: [provider, other],
      activeProviderId: provider.id,
    })
    bridge.setActiveProvider.mockResolvedValueOnce(other.id)
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(
      screen.getByRole("button", { name: "更多操作：Anthropic" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "设为默认" }))
    await waitFor(() =>
      expect(bridge.setActiveProvider).toHaveBeenCalledWith(other.id),
    )
  })

  it("disables default-provider actions with accessible reasons and native titles", async () => {
    const user = userEvent.setup()
    render(
      <GlobalSettingsDialog
        client={client() as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(
      screen.getByRole("button", { name: `更多操作：${provider.name}` }),
    )
    const setDefault = screen.getByRole("menuitem", {
      name: "设为默认（已是当前默认提供商）",
    })
    const remove = screen.getByRole("menuitem", {
      name: "删除（当前为默认提供商，无法删除）",
    })
    expect(setDefault).toHaveAttribute("data-disabled", "")
    expect(setDefault.closest("span")).toHaveAttribute(
      "title",
      "已是当前默认提供商",
    )
    expect(remove).toHaveAttribute("data-disabled", "")
    expect(remove.closest("span")).toHaveAttribute(
      "title",
      "当前为默认提供商，无法删除",
    )
  })

  it("deletes a provider from the provider row more menu after confirmation", async () => {
    const user = userEvent.setup()
    const bridge = client()
    const other: ProviderView = {
      ...provider,
      id: "provider-2",
      name: "Anthropic",
      hasApiKey: false,
    }
    useProviderStore.setState({
      phase: "ready",
      providers: [provider, other],
      activeProviderId: provider.id,
    })
    bridge.deleteProvider.mockResolvedValueOnce(true)
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(
      screen.getByRole("button", { name: "更多操作：Anthropic" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    expect(
      screen.getByRole("heading", { name: "删除「Anthropic」？" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "删除" }))
    await waitFor(() =>
      expect(bridge.deleteProvider).toHaveBeenCalledWith(other.id),
    )
    expect(
      screen.queryByRole("button", { name: "编辑：Anthropic" }),
    ).not.toBeInTheDocument()
  })
})
