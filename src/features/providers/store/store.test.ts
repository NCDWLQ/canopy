import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProviderStore } from "./index"
import type { ProviderView } from "../types"

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
    setAutoGenerateTitle: vi.fn(),
    setTitleModelBinding: vi.fn(),
    revealProviderApiKey: vi.fn(),
    listProviderModels: vi.fn(),
    generateFromActivePath: vi.fn(),
    cancelGeneration: vi.fn(),
  }
}

describe("provider store", () => {
  beforeEach(() => {
    useProviderStore.setState({
      phase: "idle",
      providers: [],
      activeProviderId: null,
      autoGenerateTitle: true,
      titleModelBinding: null,
    })
  })

  it("loads the redacted provider list and active provider", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState()).toMatchObject({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
  })

  it("stores only the redacted save result and does not auto-activate a new provider", async () => {
    const bridge = client()
    const secret = "STORE_SECRET_SENTINEL"
    bridge.saveProvider.mockResolvedValueOnce(provider)
    const saved = await useProviderStore.getState().saveProvider(bridge, {
      name: provider.name,
      protocol: provider.protocol,
      baseEndpoint: provider.baseEndpoint,
      model: provider.model,
      models: provider.models,
      apiKey: { action: "replace", value: secret },
    })
    expect(saved).toEqual(provider)
    expect(useProviderStore.getState()).toMatchObject({
      phase: "idle",
      providers: [provider],
      activeProviderId: null,
    })
    expect(JSON.stringify(useProviderStore.getState())).not.toContain(secret)
  })

  it("clears the active selection when deleting the active provider", async () => {
    const bridge = client()
    bridge.deleteProvider.mockResolvedValueOnce(true)
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    await useProviderStore.getState().deleteProvider(bridge, provider.id)
    expect(useProviderStore.getState()).toMatchObject({
      phase: "unconfigured",
      providers: [],
      activeProviderId: null,
    })
  })

  it("persists the automatic-title toggle and model binding", async () => {
    const bridge = client()
    bridge.setAutoGenerateTitle.mockResolvedValueOnce(false)
    bridge.setTitleModelBinding.mockResolvedValueOnce({
      providerId: provider.id,
      model: provider.model,
    })
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })

    await useProviderStore.getState().setAutoGenerateTitle(bridge, false)
    await useProviderStore.getState().setTitleModelBinding(bridge, {
      providerId: provider.id,
      model: provider.model,
    })

    expect(useProviderStore.getState()).toMatchObject({
      autoGenerateTitle: false,
      titleModelBinding: {
        providerId: provider.id,
        model: provider.model,
      },
    })
  })
})
