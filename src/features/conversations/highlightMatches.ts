/**
 * Search-match highlighting shared by the search dialog snippets (inline
 * `<mark>` over plain text) and the message-pane reveal (CSS Custom Highlight
 * API over already-rendered content, which pierces markdown output without
 * mutating React-managed DOM).
 */

export type TextSegment = { text: string; isMatch: boolean }

// Case-insensitive for the same ASCII fold the backend applies; exact for
// other scripts. `fail-open`: an empty query returns the text untouched.
// `firstOnly` marks a single occurrence — the one the backend snippet is
// anchored to — for the pane reveal; the dialog marks every occurrence
// inside its short snippet.
export function splitQueryMatches(
  text: string,
  query: string,
  options?: { firstOnly?: boolean },
): readonly TextSegment[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return [{ text, isMatch: false }]

  const haystack = text.toLowerCase()
  const segments: TextSegment[] = []
  let cursor = 0
  let matched = false
  while (cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), isMatch: false })
    }
    segments.push({
      text: text.slice(index, index + needle.length),
      isMatch: true,
    })
    matched = true
    cursor = index + needle.length
    if (options?.firstOnly) break
  }
  const tail = text.slice(cursor)
  if (tail.length > 0 || !matched) {
    segments.push({ text: tail, isMatch: false })
  }
  return segments
}

/**
 * Collects one `Range` per case-insensitive occurrence of `query` inside
 * `root`'s text nodes. Pure DOM computation — testable in jsdom.
 */
export function findTextMatchRanges(
  root: Element,
  query: string,
): readonly Range[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return []

  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    const text = node.nodeValue ?? ""
    const haystack = text.toLowerCase()
    let cursor = 0
    while (cursor <= haystack.length) {
      const index = haystack.indexOf(needle, cursor)
      if (index === -1) break
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      ranges.push(range)
      cursor = index + needle.length
    }
    node = walker.nextNode()
  }
  return ranges
}

export const SEARCH_REVEAL_HIGHLIGHT_NAME = "canopy-search-reveal"

type HighlightRegistryContainer = {
  highlights?: Map<string, unknown>
}

/**
 * Applies the reveal highlight through the CSS Custom Highlight API,
 * marking only the first occurrence (the one the backend snippet anchors).
 * Returns `true` when applied; on engines without the API (jsdom, older
 * WebKit) it is a no-op.
 */
export function applySearchHighlight(
  root: Element | null,
  query: string,
): boolean {
  if (root === null || query.length === 0) return false
  const container = globalThis as typeof globalThis & {
    CSS?: HighlightRegistryContainer
  }
  const registry = container.CSS?.highlights
  if (registry === undefined) return false

  clearSearchHighlight()
  const matchRange = findTextMatchRanges(root, query)[0]
  if (matchRange === undefined) return false

  const HighlightConstructor = (
    globalThis as typeof globalThis & {
      Highlight?: new (...ranges: Range[]) => unknown
    }
  ).Highlight
  if (HighlightConstructor === undefined) return false

  registry.set(
    SEARCH_REVEAL_HIGHLIGHT_NAME,
    new HighlightConstructor(matchRange),
  )
  return true
}

export function clearSearchHighlight(): void {
  const container = globalThis as typeof globalThis & {
    CSS?: HighlightRegistryContainer
  }
  container.CSS?.highlights?.delete(SEARCH_REVEAL_HIGHLIGHT_NAME)
}
