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
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
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

  it("edits providers using a redacted key replacement and clears the draft secret", async () => {
    const user = userEvent.setup()
    const bridge = client()
    bridge.saveProvider.mockResolvedValueOnce({ ...provider, updatedAt: 11 })
    render(
      <GlobalSettingsDialog
        client={bridge as ProviderClient}
        readOnly={false}
      />,
    )
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.type(screen.getByLabelText("API 密钥"), "DIALOG_SECRET_SENTINEL")
    await user.click(screen.getByRole("button", { name: "保存服务提供商" }))
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
    expect(screen.getByLabelText("API 密钥")).toHaveValue("")
    expect(JSON.stringify(useProviderStore.getState())).not.toContain(
      "DIALOG_SECRET_SENTINEL",
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
    await user.click(screen.getByRole("button", { name: "设置" }))
    await user.click(screen.getByRole("button", { name: "获取模型列表" }))
    await user.click(
      await screen.findByRole("button", { name: "加入模型：gpt-test" }),
    )
    expect(
      screen.getByRole("button", { name: "设为默认：gpt-test" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "保存服务提供商" }))
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
    await user.click(screen.getByRole("button", { name: "设置" }))
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
    await user.click(screen.getByRole("button", { name: "设置" }))
    expect(screen.getByText("只读")).toBeVisible()
    expect(screen.getByLabelText("名称")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "保存服务提供商" }),
    ).toBeDisabled()
  })
})
