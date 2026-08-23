import { z } from "zod"

import type { JsonValue } from "./types"

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
export const setConversationProviderRequestSchema = z
  .object({
    conversation_id: idSchema,
    binding: z
      .object({ provider_id: idSchema, model: unicodeScalarStringSchema })
      .strict()
      .nullable(),
    reasoning_effort: z.enum(["low", "medium", "high"]).nullable(),
  })
  .strict()
export const conversationProviderBindingResultSchema = z
  .object({
    conversation_id: idSchema,
    provider_id: idSchema.nullable().optional(),
    model: unicodeScalarStringSchema.nullable().optional(),
    reasoning_effort: z.enum(["low", "medium", "high"]).nullable().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    const providerId = result.provider_id ?? null
    const model = result.model ?? null
    if ((providerId === null) !== (model === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provider binding is incomplete",
      })
    }
  })

export const searchConversationsRequestSchema = z
  .object({
    query: unicodeScalarStringSchema
      .transform(trimRustWhitespace)
      .refine((value) => value.length > 0 && [...value].length <= 200),
  })
  .strict()

export const searchHitDtoSchema = z
  .object({
    node_id: idSchema,
    role: z.enum(["user", "assistant"]),
    created_at: z.number().int().safe(),
    snippet: z.string(),
  })
  .strict()

export const conversationSearchResultDtoSchema = z
  .object({
    conversation_id: idSchema,
    title: z.string(),
    is_archived: z.boolean(),
    title_matched: z.boolean(),
    updated_at: z.number().int().safe(),
    hits: z.array(searchHitDtoSchema).max(5),
  })
  .strict()
  .superRefine((result, context) => {
    const nodeIds = new Set<string>()
    result.hits.forEach((hit, index) => {
      if (nodeIds.has(hit.node_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate search hit",
          path: ["hits", index, "node_id"],
        })
      }
      nodeIds.add(hit.node_id)
    })
  })

export const conversationSearchResultsDtoSchema = z
  .array(conversationSearchResultDtoSchema)
  .max(50)
  .superRefine((results, context) => {
    const conversationIds = new Set<string>()
    results.forEach((result, index) => {
      if (conversationIds.has(result.conversation_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate conversation search result",
          path: [index, "conversation_id"],
        })
      }
      conversationIds.add(result.conversation_id)
    })
  })

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

const conversationDtoBaseSchema = z
  .object({
    id: idSchema,
    title: z.string(),
    root_node_id: idSchema,
    is_archived: z.boolean(),
    provider_id: idSchema.nullable().optional(),
    model: unicodeScalarStringSchema.nullable().optional(),
    reasoning_effort: z.enum(["low", "medium", "high"]).nullable().optional(),
  })
  .strict()
export const conversationDtoSchema = conversationDtoBaseSchema.superRefine(
  (conversation, context) => {
    if (
      (conversation.provider_id ?? null) === null &&
      (conversation.model ?? null) !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provider binding is incomplete",
      })
    }
  },
)

export const conversationSummaryDtoSchema = conversationDtoBaseSchema.extend({
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
export type SearchHitDto = z.infer<typeof searchHitDtoSchema>
export type ConversationSearchResultDto = z.infer<
  typeof conversationSearchResultDtoSchema
>
export type NodeDto = z.infer<typeof nodeDtoSchema>
export type ConversationTreeDto = z.infer<typeof conversationTreeDtoSchema>
export type ActivePathDto = z.infer<typeof activePathDtoSchema>
export type ConversationProviderBindingResultDto = z.infer<
  typeof conversationProviderBindingResultSchema
>
