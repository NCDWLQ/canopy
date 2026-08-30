import { commandErrorMessage, t } from "@/lib/i18n"
import type { UiError } from "@/lib/tauri/types"

function detailString(
  details: UiError["details"],
  key: string,
): string | undefined {
  const value = details?.[key]
  return typeof value === "string" ? value : undefined
}

export function providerCommandErrorMessage(
  error: Pick<UiError, "code" | "details">,
  context?: { name?: string },
): string {
  if (
    error.code === "invalid_input" &&
    detailString(error.details, "field") === "name" &&
    detailString(error.details, "reason") === "duplicate"
  ) {
    const name = context?.name?.trim()
    if (name !== undefined && name !== "") {
      return t("settings.providers.errors.duplicateName", { name })
    }
  }
  return commandErrorMessage(error.code)
}
