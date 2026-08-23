import type { NodeRole } from "@/lib/tauri/types"

/**
 * Pure presentation-layer helpers for exporting a conversation prefix as a
 * Markdown file. Message content is inserted verbatim (assistant Markdown
 * stays Markdown; user plain text is not translated or escaped — other
 * viewers may interpret it as Markdown, an accepted trade-off). Only the
 * role headings follow the active UI locale.
 */

// Characters illegal in file names on Windows and macOS (union of both).
// No /g flag: this pattern is only ever tested against a single character.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/u
const EXPORT_FILENAME_SCALAR_LIMIT = 80
const EXPORT_FILENAME_FALLBACK = "conversation"

/** C0 controls (plus DEL) are stripped even though titles rarely carry them. */
function isControlScalar(character: string): boolean {
  const codePoint = character.codePointAt(0)
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
}

/** Structural slice of a path message needed to render one export section. */
export type ExportMessage = {
  id: string
  role: NodeRole
  content: string
}

export type ExportLabels = {
  userLabel: string
  assistantLabel: string
}

/**
 * Render `# {title}` followed by one `## {role label}` section per message.
 * Non-user/assistant roles are dropped defensively; an active path only
 * contains user and assistant nodes.
 */
export function buildExportMarkdown(
  input: {
    messages: readonly ExportMessage[]
    title: string
  } & ExportLabels,
): string {
  const sections = input.messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map(
      (message) =>
        `## ${message.role === "user" ? input.userLabel : input.assistantLabel}\n\n${message.content}`,
    )
  return [`# ${input.title}`, ...sections].join("\n\n") + "\n"
}

/**
 * Turn a conversation title into a safe default file name (without the
 * extension): strip characters illegal on Windows/macOS plus control
 * characters, trim, cap at 80 Unicode scalars, and fall back to
 * "conversation" when nothing usable remains.
 */
export function sanitizeExportFilename(title: string): string {
  const cleaned = [...title]
    .filter(
      (character) =>
        !ILLEGAL_FILENAME_CHARS.test(character) && !isControlScalar(character),
    )
    .join("")
    .trim()
  const scalars = Array.from(cleaned)
  if (scalars.length === 0) return EXPORT_FILENAME_FALLBACK
  return scalars.slice(0, EXPORT_FILENAME_SCALAR_LIMIT).join("")
}
