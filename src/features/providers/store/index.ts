import { create } from "zustand"

import type {
  ProviderView,
  SaveProviderInput,
  TitleModelBinding,
} from "../types"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
import type { UiError } from "@/lib/tauri/types"
import {
  effectiveLocale,
  resolveLocalePreference,
  resolveSystemLocale,
  t,
  type LocalePreference,
} from "@/lib/i18n"
import { useLocaleStore } from "@/lib/i18n/locale-store"
import {
  resolveThemePreference,
  useThemeStore,
  type ThemePreference,
} from "@/lib/theme"

export type ProviderState = (
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
) & {
  autoGenerateTitle: boolean
  titleModelBinding: TitleModelBinding | null
  defaultSystemPrompt: string | null
  language: LocalePreference
  theme: ThemePreference
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
  setAutoGenerateTitle: (
    client: ProviderClient,
    enabled: boolean,
  ) => Promise<void>
  setTitleModelBinding: (
    client: ProviderClient,
    binding: TitleModelBinding | null,
  ) => Promise<void>
  setLanguage: (
    client: ProviderClient,
    language: LocalePreference,
  ) => Promise<void>
  setTheme: (client: ProviderClient, theme: ThemePreference) => Promise<void>
  setDefaultSystemPrompt: (
    client: ProviderClient,
    prompt: string | null,
  ) => Promise<void>
}

// Display sites render this through commandErrorMessage(code); the message
// field carries localized text only for wire/debug inspection.
const INTERNAL_ERROR: UiError = {
  code: "internal",
  message: t("errors.internal"),
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
  autoGenerateTitle: boolean,
  titleModelBinding: TitleModelBinding | null,
  language: LocalePreference,
  theme: ThemePreference,
  defaultSystemPrompt: string | null,
): ProviderState {
  if (activeProviderId !== null) {
    return {
      phase: "ready",
      providers,
      activeProviderId,
      autoGenerateTitle,
      titleModelBinding,
      defaultSystemPrompt,
      language,
      theme,
    }
  }
  return {
    phase: providers.length === 0 ? "unconfigured" : "idle",
    providers,
    activeProviderId: null,
    autoGenerateTitle,
    titleModelBinding,
    defaultSystemPrompt,
    language,
    theme,
  }
}

function detectedSystemLocale(): ReturnType<typeof resolveSystemLocale> {
  return resolveSystemLocale(
    typeof navigator === "undefined" ? [] : navigator.languages,
  )
}

/**
 * Applies a stored preference over the detected system locale onto the UI
 * locale store (design 08-22-i18n §3). No-op when the resolved locale already
 * matches, so an unchanged preference never re-renders the tree.
 */
function applyLanguagePreference(language: LocalePreference): void {
  const resolved = effectiveLocale(language, detectedSystemLocale())
  const { locale, setLocale } = useLocaleStore.getState()
  if (resolved !== locale) setLocale(resolved)
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
      autoGenerateTitle: previous.autoGenerateTitle,
      titleModelBinding: previous.titleModelBinding,
      defaultSystemPrompt: previous.defaultSystemPrompt,
      language: previous.language,
      theme: previous.theme,
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
      autoGenerateTitle: previous.autoGenerateTitle,
      titleModelBinding: previous.titleModelBinding,
      defaultSystemPrompt: previous.defaultSystemPrompt,
      language: previous.language,
      theme: previous.theme,
      error: normalizeError(error),
    })
  }

  return {
    phase: "idle",
    providers: [],
    activeProviderId: null,
    autoGenerateTitle: true,
    titleModelBinding: null,
    defaultSystemPrompt: null,
    language: "system",
    theme: "system",

    loadProviders: async (client) => {
      const { epoch, previous } = beginRequest()
      try {
        const result = await client.listProviders()
        if (isCurrent(epoch)) {
          // The zod-validated client already guarantees the three literal
          // values; resolveLocalePreference additionally absorbs untyped
          // fixtures (App smoke mocks) that bypass the bridge.
          const language = resolveLocalePreference(result.language)
          const theme = resolveThemePreference(result.theme)
          set(
            readyOrUnconfigured(
              result.providers,
              result.activeProviderId,
              result.autoGenerateTitle,
              result.titleModelBinding,
              language,
              theme,
              result.defaultSystemPrompt,
            ),
          )
          // Boot hydration (design 08-22-i18n §3): only an explicit preference
          // overrides the locale detected at startup; "system" keeps it.
          if (language !== "system") applyLanguagePreference(language)
          useThemeStore.getState().setThemePreference(theme)
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
        const activeProviderId =
          previous.activeProviderId === null && previous.providers.length === 0
            ? provider.id
            : previous.activeProviderId
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              providers,
              activeProviderId,
              previous.autoGenerateTitle,
              previous.titleModelBinding,
              previous.language,
              previous.theme,
              previous.defaultSystemPrompt,
            ),
          )
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
        set(
          readyOrUnconfigured(
            providers,
            activeProviderId,
            previous.autoGenerateTitle,
            previous.titleModelBinding?.providerId === providerId
              ? null
              : previous.titleModelBinding,
            previous.language,
            previous.theme,
            previous.defaultSystemPrompt,
          ),
        )
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
          set(
            readyOrUnconfigured(
              previous.providers,
              activeProviderId,
              previous.autoGenerateTitle,
              previous.titleModelBinding,
              previous.language,
              previous.theme,
              previous.defaultSystemPrompt,
            ),
          )
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    setAutoGenerateTitle: async (client, enabled) => {
      const { epoch, previous } = beginRequest()
      try {
        const autoGenerateTitle = await client.setAutoGenerateTitle(enabled)
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              previous.providers,
              previous.activeProviderId,
              autoGenerateTitle,
              previous.titleModelBinding,
              previous.language,
              previous.theme,
              previous.defaultSystemPrompt,
            ),
          )
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    setTitleModelBinding: async (client, binding) => {
      const { epoch, previous } = beginRequest()
      try {
        const titleModelBinding = await client.setTitleModelBinding(binding)
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              previous.providers,
              previous.activeProviderId,
              previous.autoGenerateTitle,
              titleModelBinding,
              previous.language,
              previous.theme,
              previous.defaultSystemPrompt,
            ),
          )
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    setLanguage: async (client, language) => {
      const { epoch, previous } = beginRequest()
      try {
        const stored = await client.setLanguage(language)
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              previous.providers,
              previous.activeProviderId,
              previous.autoGenerateTitle,
              previous.titleModelBinding,
              stored,
              previous.theme,
              previous.defaultSystemPrompt,
            ),
          )
          // Unlike boot hydration, an explicit "system" selection recomputes
          // the detected locale so the UI follows the OS again immediately.
          applyLanguagePreference(stored)
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    setTheme: async (client, theme) => {
      const { epoch, previous } = beginRequest()
      try {
        const stored = await client.setTheme(theme)
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              previous.providers,
              previous.activeProviderId,
              previous.autoGenerateTitle,
              previous.titleModelBinding,
              previous.language,
              stored,
              previous.defaultSystemPrompt,
            ),
          )
          useThemeStore.getState().setThemePreference(stored)
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },

    setDefaultSystemPrompt: async (client, prompt) => {
      const { epoch, previous } = beginRequest()
      try {
        const defaultSystemPrompt = await client.setDefaultSystemPrompt(prompt)
        if (isCurrent(epoch)) {
          set(
            readyOrUnconfigured(
              previous.providers,
              previous.activeProviderId,
              previous.autoGenerateTitle,
              previous.titleModelBinding,
              previous.language,
              previous.theme,
              defaultSystemPrompt,
            ),
          )
        }
      } catch (error: unknown) {
        fail(epoch, previous, error)
      }
    },
  }
})
