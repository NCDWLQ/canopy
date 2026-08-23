import { splitQueryMatches } from "../highlightMatches"

export function HighlightedText({
  text,
  query,
  firstOnly = false,
}: {
  text: string
  query: string
  // Reveal rendering marks only the snippet-anchored occurrence; the search
  // dialog marks every occurrence inside its short snippet.
  firstOnly?: boolean
}) {
  const segments = splitQueryMatches(text, query, { firstOnly })
  if (segments.length === 1 && !segments[0]?.isMatch) return text
  return segments.map((segment, index) =>
    segment.isMatch ? (
      <mark
        key={index}
        className="rounded-sm bg-yellow-200/80 text-foreground dark:bg-yellow-500/40"
      >
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  )
}
