import { useLocaleStore } from "./locale-store"
import { en } from "./locales/en"
import { zhCN } from "./locales/zh-CN"
import type { Dictionary } from "./locales/zh-CN"
import type { SupportedLocale } from "./types"

export { commandErrorMessage, commandErrorKeys } from "./command-errors"
export {
  effectiveLocale,
  resolveLocalePreference,
  resolveSystemLocale,
} from "./resolve"
export type { Dictionary } from "./locales/zh-CN"
export type { LocalePreference, SupportedLocale } from "./types"

/**
 * Internal union of every dictionary entry. Function entries are widened to
 * `(params: never) => string` so both dictionaries' signatures are assignable
 * (parameter types are contravariant); callers go through the overloads.
 */
type MessageEntry = string | ((params: never) => string)

/** Keys whose dictionary value is literal text. */
export type StaticMessageKey = {
  [K in keyof Dictionary]: Dictionary[K] extends string ? K : never
}[keyof Dictionary]

/** Keys whose dictionary value interpolates exactly the params `P`. */
export type ParamMessageKey<P> = {
  [K in keyof Dictionary]: Dictionary[K] extends (params: P) => string
    ? K
    : never
}[keyof Dictionary]

function messageEntry(
  locale: SupportedLocale,
  key: keyof Dictionary,
): MessageEntry {
  // Only "en" has its own dictionary; anything else (defensive: dirty stored
  // data smuggling an unsupported locale into the store) falls back to zh-CN.
  const dictionary = locale === "en" ? en : zhCN
  return dictionary[key]
}

export function t(key: StaticMessageKey): string
export function t<P>(key: ParamMessageKey<P>, params: P): string
export function t(key: keyof Dictionary, params?: unknown): string {
  const entry = messageEntry(useLocaleStore.getState().locale, key)
  if (typeof entry === "string") return entry
  if (params === undefined) {
    throw new Error(`i18n message "${key}" requires interpolation parameters`)
  }
  // The overloads guarantee `params` matches this entry's signature; the
  // `never` parameter type exists only for assignability, so assert through.
  return entry(params as never)
}

/**
 * Translation access for React components. Subscribes to the locale store so
 * a `setLocale` call re-renders every consumer with fresh text.
 */
export function useTranslation(): { t: typeof t; locale: SupportedLocale } {
  const locale = useLocaleStore((state) => state.locale)
  return { t, locale }
}
