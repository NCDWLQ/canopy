import { t } from "@/lib/i18n"

/** Short list row summary: first few model ids, then "+N more" for the rest. */
export function formatProviderModelsSummary(
  models: readonly string[],
  visibleCount = 2,
): string {
  if (models.length === 0) return t("providers.modelsSummary.empty")
  const shown = models.slice(0, visibleCount)
  const remaining = models.length - shown.length
  const head = shown.join(", ")
  return remaining > 0
    ? t("providers.modelsSummary.more", { head, remaining })
    : head
}
