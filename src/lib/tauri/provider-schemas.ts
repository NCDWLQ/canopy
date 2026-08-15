import { z } from "zod"

import {
  commandErrorSchema,
  containsNonRustWhitespace,
  idSchema,
  nodeDtoSchema,
  trimRustWhitespace,
  unicodeScalarStringSchema,
} from "./schemas"

const MAX_GENERATED_CONTENT_BYTES = 1024 * 1024
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const generationUuidSchema = z.string().regex(UUID_V4_PATTERN)

const endpointSchema = unicodeScalarStringSchema.refine((value) => {
  try {
    const url = new URL(value)
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.host === ""
    ) {
      return false
    }
    const exactLoopbackAuthority =
      /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
        value,
      )
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && exactLoopbackAuthority)
    )
  } catch {
    return false
  }
})

const modelSchema = unicodeScalarStringSchema
  .transform(trimRustWhitespace)
  .refine(
    (value) =>
      value.length > 0 && new TextEncoder().encode(value).length <= 200,
  )
const secretSchema = unicodeScalarStringSchema
  .refine(containsNonRustWhitespace)
  .refine((value) => new TextEncoder().encode(value).length <= 16 * 1024)

export const apiKeyActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("replace"), value: secretSchema }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
])
export const saveProviderProfileRequestSchema = z
  .object({
    base_endpoint: endpointSchema,
    model: modelSchema,
    api_key: apiKeyActionSchema,
  })
  .strict()
export const emptyProviderRequestSchema = z.object({}).strict()
export const generateFromActivePathRequestSchema = z
  .object({ conversation_id: idSchema, active_node_id: idSchema })
  .strict()
export const cancelGenerationRequestSchema = z
  .object({ generation_id: generationUuidSchema })
  .strict()

export const providerProfileDtoSchema = z
  .object({
    base_endpoint: endpointSchema,
    model: modelSchema,
    has_api_key: z.boolean(),
    updated_at: z.number().int().safe(),
  })
  .strict()
export const deleteProviderProfileResultSchema = z
  .object({ deleted: z.boolean() })
  .strict()
export const cancelGenerationResultSchema = z
  .object({ accepted: z.boolean() })
  .strict()
export const generationIdProbeSchema = z
  .object({ generation_id: generationUuidSchema })
  .passthrough()
const startedEventSchema = z
  .object({
    type: z.literal("started"),
    generation_id: generationUuidSchema,
    conversation_id: idSchema,
    active_node_id: idSchema,
    model: modelSchema,
  })
  .strict()
const deltaEventSchema = z
  .object({
    type: z.literal("delta"),
    generation_id: generationUuidSchema,
    content: unicodeScalarStringSchema.refine(
      (value) =>
        new TextEncoder().encode(value).byteLength <=
        MAX_GENERATED_CONTENT_BYTES,
    ),
  })
  .strict()
export const generationEventDtoSchema = z.discriminatedUnion("type", [
  startedEventSchema,
  deltaEventSchema,
])

const generationFailureStageSchema = z.enum(["generation", "persistence"])
const generatedContentSchema = unicodeScalarStringSchema
  .refine(containsNonRustWhitespace)
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <= MAX_GENERATED_CONTENT_BYTES,
  )
const generatedModelSchema = unicodeScalarStringSchema.refine(
  (value) =>
    value === trimRustWhitespace(value) &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 200,
)
const generatedAssistantNodeDtoSchema = nodeDtoSchema.extend({
  parent_id: idSchema,
  role: z.literal("assistant"),
  content: generatedContentSchema,
  model: generatedModelSchema,
})
const completedTerminalSchema = z
  .object({
    type: z.literal("completed"),
    generation_id: generationUuidSchema,
    node: generatedAssistantNodeDtoSchema,
  })
  .strict()
const cancelledTerminalSchema = z
  .object({
    type: z.literal("cancelled"),
    generation_id: generationUuidSchema,
  })
  .strict()
const failedTerminalSchema = z
  .object({
    type: z.literal("failed"),
    generation_id: generationUuidSchema,
    stage: generationFailureStageSchema,
    error: commandErrorSchema,
  })
  .strict()

export const generationTerminalDtoSchema = z.discriminatedUnion("type", [
  completedTerminalSchema,
  cancelledTerminalSchema,
  failedTerminalSchema,
])

export type ProviderProfileDto = z.infer<typeof providerProfileDtoSchema>
export type GenerationEventDto = z.infer<typeof generationEventDtoSchema>
export type GenerationTerminalDto = z.infer<typeof generationTerminalDtoSchema>
