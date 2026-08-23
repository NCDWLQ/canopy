import { create } from "zustand"

import { resolveSystemLocale } from "./resolve"
import type { SupportedLocale } from "./types"

export type LocaleStore = {
  locale: SupportedLocale
  setLocale: (locale: SupportedLocale) => void
}

function initialLocale(): SupportedLocale {
  return resolveSystemLocale(
    typeof navigator === "undefined" ? [] : navigator.languages,
  )
}

/**
 * UI-only locale state. Deliberately not persisted: the durable preference
 * round-trips through the backend `app_settings` store, never localStorage.
 */
export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => set({ locale }),
}))
