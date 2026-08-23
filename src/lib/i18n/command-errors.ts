import type { UiErrorCode } from "@/lib/tauri/types"

import { t, type StaticMessageKey } from "./index"

/**
 * Closed mapping from the Tauri command error code (owned by
 * `src/lib/tauri`, never redeclared here) to a localized message key.
 */
export const commandErrorKeys = {
  invalid_input: "errors.invalidInput",
  not_found: "errors.notFound",
  tree_integrity: "errors.treeIntegrity",
  database_unavailable: "errors.databaseUnavailable",
  migration_failure: "errors.migrationFailure",
  provider_authentication: "errors.providerAuthentication",
  rate_limited: "errors.rateLimited",
  provider_unavailable: "errors.providerUnavailable",
  network_failure: "errors.networkFailure",
  cancelled: "errors.cancelled",
  internal: "errors.internal",
} satisfies Record<UiErrorCode, StaticMessageKey>

/**
 * Localized display text for a command error code. Unknown values (defensive:
 * an unchecked code reaching the UI) resolve to the generic internal message;
 * machine-readable `details` stay untouched by this mapping.
 */
export function commandErrorMessage(code: string): string {
  if (!Object.hasOwn(commandErrorKeys, code)) {
    return t("errors.internal")
  }
  return t(commandErrorKeys[code as UiErrorCode])
}
