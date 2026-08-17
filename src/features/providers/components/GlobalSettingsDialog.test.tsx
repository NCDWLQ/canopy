import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GlobalSettingsDialog } from "./GlobalSettingsDialog"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
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
  await user.click(screen.getByRole("button", { name: `编辑：${providerName}` }))
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
    expect(
      screen.getByRole("navigation", { name: "设置分类" }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "模型提供商", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "模型提供商" })).toBeVisible()
    expect(screen.getByLabelText("当前全局默认")).toHaveTextContent("默认")
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
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
    await user.click(
      screen.getByRole("button", { name: "返回模型提供商列表" }),
    )
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
    await user.click(
      screen.getByRole("button", { name: "返回模型提供商列表" }),
    )
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  })
})
