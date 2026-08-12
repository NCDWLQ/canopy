import { describe, expect, it } from "vitest"

import { deriveConversationTitle } from "./deriveConversationTitle"

describe("deriveConversationTitle", () => {
  it("uses Rust-compatible Unicode whitespace trimming and collapsing", () => {
    expect(
      deriveConversationTitle("\u{3000}First\u{00a0}\t prompt\nline\u{2029}"),
    ).toBe("First prompt line")
  })

  it("keeps exactly 40 Unicode scalar values without splitting emoji", () => {
    const prefix = "🙂".repeat(39)

    expect(deriveConversationTitle(`${prefix}界tail`)).toBe(`${prefix}界…`)
    expect(deriveConversationTitle(`${prefix}界`)).toBe(`${prefix}界`)
  })
})
