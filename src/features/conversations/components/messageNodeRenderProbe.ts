/** Test-only per-message render counter for memo verification. */
export const messageNodeRenderProbe = {
  counts: new Map<string, number>(),
  reset() {
    this.counts.clear()
  },
  record(messageId: string) {
    this.counts.set(messageId, (this.counts.get(messageId) ?? 0) + 1)
  },
}
