const RUST_UNICODE_WHITESPACE = /\p{White_Space}+/gu
const TITLE_SCALAR_LIMIT = 40

export function deriveConversationTitle(prompt: string): string {
  const normalized = prompt
    .replace(RUST_UNICODE_WHITESPACE, " ")
    .replace(/^ | $/g, "")
  const scalars = Array.from(normalized)

  if (scalars.length <= TITLE_SCALAR_LIMIT) return normalized
  return `${scalars.slice(0, TITLE_SCALAR_LIMIT).join("")}…`
}
