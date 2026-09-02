import { describe, expect, it } from "vitest"

import { formatRelativeUpdatedAt } from "./format-relative-time"

describe("formatRelativeUpdatedAt", () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0)

  it("formats recent updates as relative time", () => {
    expect(
      formatRelativeUpdatedAt(now - 2 * 60 * 60 * 1000, "en", now),
    ).toBe("2 hours ago")
    expect(
      formatRelativeUpdatedAt(now - 2 * 60 * 60 * 1000, "zh-CN", now),
    ).toBe("2小时前")
  })

  it("formats older updates as an absolute date", () => {
    expect(formatRelativeUpdatedAt(Date.UTC(2025, 0, 1), "en", now)).toBe(
      "Jan 1, 2025",
    )
    expect(formatRelativeUpdatedAt(Date.UTC(2025, 0, 1), "zh-CN", now)).toBe(
      "2025年1月1日",
    )
  })
})
