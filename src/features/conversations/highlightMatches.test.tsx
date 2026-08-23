import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  applySearchHighlight,
  findTextMatchRanges,
  splitQueryMatches,
} from "./highlightMatches"
import { HighlightedText } from "./components/HighlightedText"

describe("splitQueryMatches", () => {
  it("splits ASCII case-insensitively and keeps exact CJK matches", () => {
    expect(splitQueryMatches("Hello WATERMELON world", "watermelon")).toEqual([
      { text: "Hello ", isMatch: false },
      { text: "WATERMELON", isMatch: true },
      { text: " world", isMatch: false },
    ])
    expect(splitQueryMatches("讨论分支结构", "分支")).toEqual([
      { text: "讨论", isMatch: false },
      { text: "分支", isMatch: true },
      { text: "结构", isMatch: false },
    ])
  })

  it("marks every occurrence and fails open on empty or missing queries", () => {
    expect(splitQueryMatches("aba ba", "a")).toEqual([
      { text: "a", isMatch: true },
      { text: "b", isMatch: false },
      { text: "a", isMatch: true },
      { text: " b", isMatch: false },
      { text: "a", isMatch: true },
    ])
    expect(splitQueryMatches("unchanged", "")).toEqual([
      { text: "unchanged", isMatch: false },
    ])
    expect(splitQueryMatches("nothing here", "zzz")).toEqual([
      { text: "nothing here", isMatch: false },
    ])
  })
})

describe("HighlightedText", () => {
  it("wraps matches in mark elements and leaves plain text untouched", () => {
    const { container } = render(
      <HighlightedText text="say NEEDLE twice: needle" query="needle" />,
    )
    const marks = container.querySelectorAll("mark")
    expect(marks).toHaveLength(2)
    expect(marks[0]?.textContent).toBe("NEEDLE")
    expect(marks[1]?.textContent).toBe("needle")

    render(<HighlightedText text="no query hit" query="zzz" />)
    expect(screen.getByText("no query hit")).toBeInTheDocument()
  })
})

describe("findTextMatchRanges", () => {
  it("collects one range per occurrence across nested text nodes", () => {
    const container = document.createElement("div")
    container.innerHTML =
      "<p>alpha Needle</p><p>nested <span>needle</span> tail</p>"

    const ranges = findTextMatchRanges(container, "needle")
    expect(ranges).toHaveLength(2)
    expect(ranges[0]?.toString()).toBe("Needle")
    expect(ranges[1]?.toString()).toBe("needle")
  })

  it("returns nothing for empty queries", () => {
    const container = document.createElement("div")
    container.textContent = "anything"
    expect(findTextMatchRanges(container, "")).toEqual([])
  })
})

describe("applySearchHighlight", () => {
  it("is a graceful no-op without the CSS Custom Highlight API", () => {
    const container = document.createElement("div")
    container.textContent = "needle in a haystack"
    // jsdom has no CSS.highlights registry; the reveal ring is the fallback.
    expect(applySearchHighlight(container, "needle")).toBe(false)
    expect(applySearchHighlight(null, "needle")).toBe(false)
    expect(applySearchHighlight(container, "")).toBe(false)
  })
})
