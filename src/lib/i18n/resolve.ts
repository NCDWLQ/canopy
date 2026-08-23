import type { LocalePreference, SupportedLocale } from "./types"

/**
 * Maps the WebView's `navigator.languages` onto the supported set: any tag
 * starting with `zh` (zh-CN, zh-TW, zh-Hans, ...) resolves to zh-CN,
 * everything else falls back to en.
 */
export function resolveSystemLocale(
  languages: readonly string[],
): SupportedLocale {
  return languages.some((tag) => tag.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en"
}

/**
 * Validates a stored preference. Only the three literal values survive;
 * missing or corrupted storage resolves back to `"system"`.
 */
export function resolveLocalePreference(
  stored: string | null | undefined,
): LocalePreference {
  switch (stored) {
    case "zh-CN":
    case "en":
    case "system":
      return stored
    default:
      return "system"
  }
}

/** Applies a preference over the detected system locale. */
export function effectiveLocale(
  preference: LocalePreference,
  system: SupportedLocale,
): SupportedLocale {
  return preference === "system" ? system : preference
}
