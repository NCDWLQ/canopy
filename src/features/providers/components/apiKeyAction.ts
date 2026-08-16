import type { ApiKeyInputAction, ProviderView } from "../types"

/**
 * Resolves the save action for the API-key field. `savedApiKey` is the key
 * revealed for the edited profile (`null` when the reveal failed or never
 * ran): an empty field then falls back to `keep` instead of removing a key
 * the dialog could not display.
 */
export function resolveApiKeyAction(
  profile: ProviderView | null,
  apiKey: string,
  savedApiKey: string | null,
): ApiKeyInputAction {
  if (apiKey.length > 0) {
    return apiKey === savedApiKey
      ? { action: "keep" }
      : { action: "replace", value: apiKey }
  }
  if (profile === null) return { action: "remove" }
  if (!profile.hasApiKey) return { action: "keep" }
  return savedApiKey === null ? { action: "keep" } : { action: "remove" }
}
