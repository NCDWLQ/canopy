import { create } from "zustand"

import type { ProviderProfileView, SaveProviderProfileInput } from "../types"
import type { UiError } from "@/features/conversations/types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"

export type ProviderProfileState =
  | { phase: "idle" | "loading"; profile: ProviderProfileView | null }
  | { phase: "ready"; profile: ProviderProfileView }
  | { phase: "unconfigured"; profile: null }
  | {
      phase: "error"
      profile: ProviderProfileView | null
      error: UiError
    }

export type ProviderProfileStore = ProviderProfileState & {
  loadProfile: (client: ProviderClient) => Promise<void>
  saveProfile: (
    client: ProviderClient,
    input: SaveProviderProfileInput,
  ) => Promise<void>
  deleteProfile: (client: ProviderClient) => Promise<void>
}

const INTERNAL_ERROR: UiError = {
  code: "internal",
  message: "An unexpected error occurred.",
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

export const useProviderProfileStore = create<ProviderProfileStore>(
  (set, get) => {
    let requestEpoch = 0

    const beginRequest = () => {
      const epoch = ++requestEpoch
      const previousProfile = get().profile
      set({ phase: "loading", profile: previousProfile })
      return { epoch, previousProfile }
    }

    const isCurrent = (epoch: number) => epoch === requestEpoch

    return {
      phase: "idle",
      profile: null,

      loadProfile: async (client) => {
        const { epoch, previousProfile } = beginRequest()
        try {
          const profile = await client.loadProviderProfile()
          if (isCurrent(epoch)) set({ phase: "ready", profile })
        } catch (error: unknown) {
          if (!isCurrent(epoch)) return
          if (
            error instanceof ConversationCommandError &&
            error.code === "not_found"
          ) {
            set({ phase: "unconfigured", profile: null })
            return
          }
          set({
            phase: "error",
            profile: previousProfile,
            error: normalizeError(error),
          })
        }
      },

      saveProfile: async (client, input) => {
        const { epoch, previousProfile } = beginRequest()
        try {
          const profile = await client.saveProviderProfile(input)
          if (isCurrent(epoch)) set({ phase: "ready", profile })
        } catch (error: unknown) {
          if (!isCurrent(epoch)) return
          set({
            phase: "error",
            profile: previousProfile,
            error: normalizeError(error),
          })
        }
      },

      deleteProfile: async (client) => {
        const { epoch, previousProfile } = beginRequest()
        try {
          await client.deleteProviderProfile()
          if (isCurrent(epoch)) {
            set({ phase: "unconfigured", profile: null })
          }
        } catch (error: unknown) {
          if (!isCurrent(epoch)) return
          set({
            phase: "error",
            profile: previousProfile,
            error: normalizeError(error),
          })
        }
      },
    }
  },
)
