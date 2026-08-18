/** Short list row summary: first few model ids, then “等 N 个” for the rest. */
export function formatProviderModelsSummary(
  models: readonly string[],
  visibleCount = 2,
): string {
  if (models.length === 0) return "未添加模型"
  const shown = models.slice(0, visibleCount)
  const remaining = models.length - shown.length
  const head = shown.join(", ")
  return remaining > 0 ? `${head} 等 ${remaining} 个` : head
}
