import type { SupportedLocale } from "@/lib/i18n/types"

const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function formatRelativeUpdatedAt(
  updatedAtMs: number,
  locale: SupportedLocale,
  nowMs = Date.now(),
): string {
  const diffMs = nowMs - updatedAtMs
  const absDiffMs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })

  if (absDiffMs < MINUTE_MS) {
    return rtf.format(-Math.round(diffMs / SECOND_MS), "second")
  }
  if (absDiffMs < HOUR_MS) {
    return rtf.format(-Math.round(diffMs / MINUTE_MS), "minute")
  }
  if (absDiffMs < DAY_MS) {
    return rtf.format(-Math.round(diffMs / HOUR_MS), "hour")
  }
  if (absDiffMs < 7 * DAY_MS) {
    return rtf.format(-Math.round(diffMs / DAY_MS), "day")
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(updatedAtMs),
  )
}
