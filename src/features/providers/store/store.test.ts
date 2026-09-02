import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProviderStore } from "./index"
import type { ProviderView } from "../types"
import { useLocaleStore } from "@/lib/i18n/locale-store"
import { useThemeStore } from "@/lib/theme"

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
    setLanguage: vi.fn(),
    setTheme: vi.fn(),
    setThemeColor: vi.fn(),
    setDefaultSystemPrompt: vi.fn(),
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
      language: "system",
      theme: "system",
      themeColor: "neutral",
      defaultSystemPrompt: null,
    })
    useLocaleStore.getState().setLocale("zh-CN")
    useThemeStore.getState().setThemePreference("system")
  })

  it("loads the redacted provider list and active provider", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      themeColor: "neutral",
      defaultSystemPrompt: "Be helpful",
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState()).toMatchObject({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
      defaultSystemPrompt: "Be helpful",
    })
  })

  it("hydrates an explicit language preference from the provider list", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "en",
      defaultSystemPrompt: null,
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState().language).toBe("en")
    expect(useLocaleStore.getState().locale).toBe("en")
  })

  it("keeps the detected locale when the stored language is system", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      defaultSystemPrompt: null,
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState().language).toBe("system")
    expect(useLocaleStore.getState().locale).toBe("zh-CN")
  })

  it("persists the language preference and applies it to the UI locale", async () => {
    const bridge = client()
    bridge.setLanguage.mockResolvedValueOnce("en")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    await useProviderStore.getState().setLanguage(bridge, "en")
    expect(useProviderStore.getState().language).toBe("en")
    expect(useLocaleStore.getState().locale).toBe("en")
  })

  it("hydrates an explicit theme preference from the provider list", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "dark",
      themeColor: "blue",
      defaultSystemPrompt: null,
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().resolvedTheme).toBe("dark")
  })

  it("persists the theme preference and applies it to the UI theme store", async () => {
    const bridge = client()
    bridge.setTheme.mockResolvedValueOnce("dark")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    await useProviderStore.getState().setTheme(bridge, "dark")
    expect(useProviderStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().theme).toBe("dark")
    expect(useThemeStore.getState().resolvedTheme).toBe("dark")
  })

  it("hydrates an explicit theme color preference from the provider list", async () => {
    const bridge = client()
    bridge.listProviders.mockResolvedValueOnce({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      themeColor: "rose",
      defaultSystemPrompt: null,
    })
    await useProviderStore.getState().loadProviders(bridge)
    expect(useProviderStore.getState().themeColor).toBe("rose")
    expect(useThemeStore.getState().themeColor).toBe("rose")
  })

  it("persists the theme color preference and applies it to the UI theme store", async () => {
    const bridge = client()
    bridge.setThemeColor.mockResolvedValueOnce("orange")
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    await useProviderStore.getState().setThemeColor(bridge, "orange")
    expect(useProviderStore.getState().themeColor).toBe("orange")
    expect(useThemeStore.getState().themeColor).toBe("orange")
  })

  it("auto-activates the first saved provider when the list was empty", async () => {
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
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    expect(JSON.stringify(useProviderStore.getState())).not.toContain(secret)
  })

  it("does not auto-activate when saving a second provider", async () => {
    const bridge = client()
    const second: ProviderView = {
      ...provider,
      id: "provider-2",
      name: "Secondary",
    }
    bridge.saveProvider.mockResolvedValueOnce(second)
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })
    await useProviderStore.getState().saveProvider(bridge, {
      name: second.name,
      protocol: second.protocol,
      baseEndpoint: second.baseEndpoint,
      model: second.model,
      models: second.models,
      apiKey: { action: "keep" },
    })
    expect(useProviderStore.getState()).toMatchObject({
      phase: "ready",
      providers: [provider, second],
      activeProviderId: provider.id,
    })
  })

  it("does not auto-activate when active is cleared but providers remain", async () => {
    const bridge = client()
    bridge.saveProvider.mockResolvedValueOnce({
      ...provider,
      model: "updated-model",
      models: ["updated-model"],
    })
    useProviderStore.setState({
      phase: "idle",
      providers: [provider],
      activeProviderId: null,
    })
    await useProviderStore.getState().saveProvider(bridge, {
      name: provider.name,
      protocol: provider.protocol,
      baseEndpoint: provider.baseEndpoint,
      model: "updated-model",
      models: ["updated-model"],
      apiKey: { action: "keep" },
    })
    expect(useProviderStore.getState()).toMatchObject({
      phase: "idle",
      activeProviderId: null,
    })
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

  it("persists the default system prompt and can clear it", async () => {
    const bridge = client()
    bridge.setDefaultSystemPrompt
      .mockResolvedValueOnce("Be helpful")
      .mockResolvedValueOnce(null)
    useProviderStore.setState({
      phase: "ready",
      providers: [provider],
      activeProviderId: provider.id,
    })

    await useProviderStore
      .getState()
      .setDefaultSystemPrompt(bridge, "Be helpful")
    expect(useProviderStore.getState().defaultSystemPrompt).toBe("Be helpful")
    await useProviderStore.getState().setDefaultSystemPrompt(bridge, null)
    expect(useProviderStore.getState().defaultSystemPrompt).toBeNull()
    expect(bridge.setDefaultSystemPrompt).toHaveBeenNthCalledWith(
      1,
      "Be helpful",
    )
    expect(bridge.setDefaultSystemPrompt).toHaveBeenNthCalledWith(2, null)
  })
})
