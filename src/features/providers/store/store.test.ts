import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProviderProfileStore } from "./index"
import type { ProviderProfileView } from "../types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"

const profile: ProviderProfileView = {
  baseEndpoint: "http://127.0.0.1:7788/v1",
  model: "fixture-model",
  hasApiKey: true,
  updatedAt: 10,
}

function createClient() {
  return {
    saveProviderProfile: vi.fn<ProviderClient["saveProviderProfile"]>(),
    loadProviderProfile: vi.fn<ProviderClient["loadProviderProfile"]>(),
    deleteProviderProfile: vi.fn<ProviderClient["deleteProviderProfile"]>(),
    generateFromActivePath: vi.fn<ProviderClient["generateFromActivePath"]>(),
    cancelGeneration: vi.fn<ProviderClient["cancelGeneration"]>(),
    commitGeneration: vi.fn<ProviderClient["commitGeneration"]>(),
  } satisfies ProviderClient
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("provider profile store", () => {
  let client: ReturnType<typeof createClient>

  beforeEach(() => {
    client = createClient()
    useProviderProfileStore.setState({ phase: "idle", profile: null })
  })

  it("normalizes a missing profile to unconfigured", async () => {
    client.loadProviderProfile.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "not_found",
        message: "Provider profile not found.",
        retryable: false,
      }),
    )

    await useProviderProfileStore.getState().loadProfile(client)

    expect(useProviderProfileStore.getState()).toMatchObject({
      phase: "unconfigured",
      profile: null,
    })
  })

  it("stores only the redacted authoritative save result", async () => {
    const secret = "STORE_SECRET_SENTINEL"
    client.saveProviderProfile.mockResolvedValueOnce(profile)

    await useProviderProfileStore.getState().saveProfile(client, {
      baseEndpoint: profile.baseEndpoint,
      model: profile.model,
      apiKey: { action: "replace", value: secret },
    })

    expect(useProviderProfileStore.getState()).toMatchObject({
      phase: "ready",
      profile,
    })
    expect(JSON.stringify(useProviderProfileStore.getState())).not.toContain(
      secret,
    )
  })

  it("preserves the exact request-time profile when a mutation fails", async () => {
    useProviderProfileStore.setState({ phase: "ready", profile })
    client.deleteProviderProfile.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "provider_unavailable",
        message: "Credential store unavailable.",
        retryable: true,
      }),
    )

    await useProviderProfileStore.getState().deleteProfile(client)

    expect(useProviderProfileStore.getState()).toMatchObject({
      phase: "error",
      profile,
      error: { code: "provider_unavailable", retryable: true },
    })
  })

  it("ignores a stale load result after a newer save completes", async () => {
    const oldLoad = deferred<ProviderProfileView>()
    const newerProfile = { ...profile, model: "newer-model", updatedAt: 20 }
    client.loadProviderProfile.mockReturnValueOnce(oldLoad.promise)
    client.saveProviderProfile.mockResolvedValueOnce(newerProfile)

    const loadPromise = useProviderProfileStore.getState().loadProfile(client)
    await useProviderProfileStore.getState().saveProfile(client, {
      baseEndpoint: newerProfile.baseEndpoint,
      model: newerProfile.model,
      apiKey: { action: "keep" },
    })
    oldLoad.resolve(profile)
    await loadPromise

    expect(useProviderProfileStore.getState()).toMatchObject({
      phase: "ready",
      profile: newerProfile,
    })
  })
})
