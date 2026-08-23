/**
 * Search-match highlighting shared by the search dialog snippets (inline
 * `<mark>` over plain text) and the message-pane reveal (CSS Custom Highlight
 * API over already-rendered content, which pierces markdown output without
 * mutating React-managed DOM).
 */

export type TextSegment = { text: string; isMatch: boolean }

// Case-insensitive for the same ASCII fold the backend applies; exact for
// other scripts. `fail-open`: an empty query returns the text untouched.
export function splitQueryMatches(
  text: string,
  query: string,
): readonly TextSegment[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return [{ text, isMatch: false }]

  const haystack = text.toLowerCase()
  const segments: TextSegment[] = []
  let cursor = 0
  while (cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) {
      const tail = text.slice(cursor)
      if (tail.length > 0) segments.push({ text: tail, isMatch: false })
      break
    }
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), isMatch: false })
    }
    segments.push({
      text: text.slice(index, index + needle.length),
      isMatch: true,
    })
    cursor = index + needle.length
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
 * Applies the reveal highlight through the CSS Custom Highlight API.
 * Returns `true` when applied; on engines without the API (jsdom, older
 * WebKit) it is a no-op so callers keep their fallback emphasis.
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
  const matchRanges = findTextMatchRanges(root, query)
  if (matchRanges.length === 0) return false

  const HighlightConstructor = (
    globalThis as typeof globalThis & {
      Highlight?: new (...ranges: Range[]) => unknown
    }
  ).Highlight
  if (HighlightConstructor === undefined) return false

  registry.set(
    SEARCH_REVEAL_HIGHLIGHT_NAME,
    new HighlightConstructor(...matchRanges),
  )
  return true
}

export function clearSearchHighlight(): void {
  const container = globalThis as typeof globalThis & {
    CSS?: HighlightRegistryContainer
  }
  container.CSS?.highlights?.delete(SEARCH_REVEAL_HIGHLIGHT_NAME)
}
