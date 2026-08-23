import { splitQueryMatches } from "../highlightMatches"

export function HighlightedText({
  text,
  query,
}: {
  text: string
  query: string
}) {
  const segments = splitQueryMatches(text, query)
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
