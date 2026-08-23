/**
 * Locale identifiers shipped with the UI. The zh-CN dictionary in
 * `locales/zh-CN.ts` is the type-level source of truth for messages.
 */
export type SupportedLocale = "zh-CN" | "en"

/**
 * Persisted user preference. `"system"` follows the OS locale detected from
 * `navigator.languages`; the other values pin one supported locale.
 */
export type LocalePreference = SupportedLocale | "system"
