import type { ApiKeyInputAction, ProviderProfileView } from "../types"

export function resolveApiKeyAction(
  profile: ProviderProfileView | null,
  apiKey: string,
  removeKey: boolean,
): ApiKeyInputAction {
  if (profile !== null && removeKey) return { action: "remove" }
  if (apiKey.length > 0) return { action: "replace", value: apiKey }
  return profile === null ? { action: "remove" } : { action: "keep" }
}
