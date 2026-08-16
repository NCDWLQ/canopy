import { create } from "zustand"

import type { ProviderView, SaveProviderInput } from "../types"
import type { UiError } from "@/features/conversations/types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
export type ProviderState =
  | {
      phase: "idle" | "loading" | "unconfigured"
      providers: readonly ProviderView[]
      activeProviderId: string | null
    }
  | {
      phase: "ready"
      providers: readonly ProviderView[]
      activeProviderId: string
    }
  | {
      phase: "error"
      providers: readonly ProviderView[]
      activeProviderId: string | null
      error: UiError
    }

export type ProviderStore = ProviderState & {
  loadProviders: (client: ProviderClient) => Promise<void>
  saveProvider: (
    client: ProviderClient,
    input: SaveProviderInput,
  ) => Promise<ProviderView | null>
  deleteProvider: (
    client: ProviderClient,
    providerId: string,
  ) => Promise<boolean>
  setActiveProvider: (
    client: ProviderClient,
    providerId: string,
  ) => Promise<void>
}

const INTERNAL_ERROR: UiError = {
  code: "internal",
  message: "发生意外错误。",
  retryable: false,
}

function normalizeError(error: unknown): UiError {
  if (error instanceof ConversationCommandError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  return INTERNAL_ERROR
}

function readyOrUnconfigured(
  providers: readonly ProviderView[],
  activeProviderId: string | null,
): ProviderState {
  if (activeProviderId !== null) {
    return { phase: "ready", providers, activeProviderId }
  }
  return {
    phase: providers.length === 0 ? "unconfigured" : "idle",
    providers,
    activeProviderId: null,
  }
}

export const useProviderStore = create<ProviderStore>((set, get) => {
  let requestEpoch = 0

  const beginRequest = () => {
    const epoch = ++requestEpoch
    const previous = get()
    set({
      phase: "loading",
      providers: previous.providers,
      activeProviderId: previous.activeProviderId,
    })
    return { epoch, previous }
  }
  const isCurrent = (epoch: number) => epoch === requestEpoch
  const fail = (epoch: number, previous: ProviderState, error: unknown) => {
    if (!isCurrent(epoch)) return
    set({
      phase: "error",
      providers: previous.providers,
      activeProviderId: previous.activeProviderId,
      error: normalizeError(error),
    })
  }

  return {
    phase: "idle",
    providers: [],
    activeProviderId: null,

    loadProviders: async (client) => {
      const { epoch, previous } = beginRequest()
      try {
        const result = await client.listProviders()
        if (isCurrent(epoch)) {
          set(readyOrUnconfigured(result.providers, result.activeProviderId))
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    saveProvider: async (client, input) => {
      const { epoch, previous } = beginRequest()
      try {
        const provider = await client.saveProvider(input)
        if (!isCurrent(epoch)) return null
        const providers = [
          ...previous.providers.filter((item) => item.id !== provider.id),
          provider,
        ]
        if (isCurrent(epoch)) {
          set(readyOrUnconfigured(providers, previous.activeProviderId))
        }
        return provider
      } catch (error: unknown) {
        fail(epoch, previous, error)
        return null
      }
    },

    deleteProvider: async (client, providerId) => {
      const { epoch, previous } = beginRequest()
      try {
        const deleted = await client.deleteProvider(providerId)
        if (!isCurrent(epoch)) return false
        const providers = deleted
          ? previous.providers.filter((provider) => provider.id !== providerId)
          : previous.providers
        const activeProviderId =
          previous.activeProviderId === providerId
            ? null
            : previous.activeProviderId
        set(readyOrUnconfigured(providers, activeProviderId))
        return deleted
      } catch (error: unknown) {
        fail(epoch, previous, error)
        return false
      }
    },

    setActiveProvider: async (client, providerId) => {
      const { epoch, previous } = beginRequest()
      try {
        const activeProviderId = await client.setActiveProvider(providerId)
        if (isCurrent(epoch)) {
          set(readyOrUnconfigured(previous.providers, activeProviderId))
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },
  }
})
