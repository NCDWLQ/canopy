import { z } from "zod"

import type { JsonValue } from "@/features/conversations/types"

function isRustWhitespace(codePoint: number): boolean {
  return (
    (codePoint >= 0x0009 && codePoint <= 0x000d) ||
    codePoint === 0x0020 ||
    codePoint === 0x0085 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  )
}

export function containsNonRustWhitespace(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && !isRustWhitespace(codePoint)
  })
}

function containsOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff)
        return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

export function trimRustWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && isRustWhitespace(value.charCodeAt(start))) start += 1
  while (end > start && isRustWhitespace(value.charCodeAt(end - 1))) end -= 1
  return value.slice(start, end)
}

export const unicodeScalarStringSchema = z
  .string()
  .refine(containsOnlyUnicodeScalars)
export const idSchema = unicodeScalarStringSchema.refine(
  containsNonRustWhitespace,
)
const titleSchema = unicodeScalarStringSchema
  .transform(trimRustWhitespace)
  .refine((value) => value.length > 0 && [...value].length <= 200)
const contentSchema = unicodeScalarStringSchema
  .refine(containsNonRustWhitespace)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 1024 * 1024)

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
)

export const createConversationRequestSchema = z
  .object({ title: titleSchema, content: contentSchema })
  .strict()
export const appendNodeRequestSchema = z
  .object({
    conversation_id: idSchema,
    parent_node_id: idSchema,
    content: contentSchema,
  })
  .strict()
export const createBranchRequestSchema = appendNodeRequestSchema
export const editNodeAsBranchRequestSchema = z
  .object({
    conversation_id: idSchema,
    source_node_id: idSchema,
    content: contentSchema,
  })
  .strict()
export const loadConversationTreeRequestSchema = z
  .object({ conversation_id: idSchema })
  .strict()
export const listConversationsRequestSchema = z.object({}).strict()
export const loadActivePathRequestSchema = z
  .object({ conversation_id: idSchema, active_node_id: idSchema })
  .strict()
export const archiveConversationRequestSchema =
  loadConversationTreeRequestSchema

export const commandErrorCodeSchema = z.enum([
  "invalid_input",
  "not_found",
  "tree_integrity",
  "database_unavailable",
  "migration_failure",
  "provider_authentication",
  "rate_limited",
  "provider_unavailable",
  "network_failure",
  "cancelled",
  "internal",
])

export const commandErrorSchema = z
  .object({
    code: commandErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(jsonValueSchema).optional(),
  })
  .strict()

export const conversationDtoSchema = z
  .object({
    id: idSchema,
    title: z.string(),
    root_node_id: idSchema,
    is_archived: z.boolean(),
  })
  .strict()

export const conversationSummaryDtoSchema = conversationDtoSchema.extend({
  updated_at: z.number().int().safe(),
})

export const conversationSummariesDtoSchema = z
  .array(conversationSummaryDtoSchema)
  .superRefine((summaries, context) => {
    const ids = new Set<string>()
    summaries.forEach((summary, index) => {
      if (ids.has(summary.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate conversation summary",
          path: [index, "id"],
        })
      }
      ids.add(summary.id)
    })
  })

export const nodeDtoSchema = z
  .object({
    id: idSchema,
    parent_id: idSchema.nullable(),
    conversation_id: idSchema,
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    model: z.string().nullable(),
    created_at: z.number().int().safe(),
    metadata: jsonValueSchema,
  })
  .strict()

export const conversationTreeDtoSchema = z
  .object({
    conversation: conversationDtoSchema,
    nodes: z.array(nodeDtoSchema),
  })
  .strict()

export const activePathDtoSchema = z
  .object({
    conversation_id: idSchema,
    active_node_id: idSchema,
    nodes: z.array(nodeDtoSchema),
  })
  .strict()

export type ConversationDto = z.infer<typeof conversationDtoSchema>
export type ConversationSummaryDto = z.infer<
  typeof conversationSummaryDtoSchema
>
export type NodeDto = z.infer<typeof nodeDtoSchema>
export type ConversationTreeDto = z.infer<typeof conversationTreeDtoSchema>
export type ActivePathDto = z.infer<typeof activePathDtoSchema>
