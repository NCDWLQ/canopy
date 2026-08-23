import { z } from "zod"

import {
  commandErrorSchema,
  containsNonRustWhitespace,
  idSchema,
  nodeDtoSchema,
  trimRustWhitespace,
  unicodeScalarStringSchema,
} from "./schemas"

export const MAX_GENERATED_CONTENT_BYTES = 1024 * 1024
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const generationUuidSchema = z.string().regex(UUID_V4_PATTERN)
export const protocolSchema = z.enum(["openai_compatible", "anthropic"])
export const reasoningEffortSchema = z.enum(["low", "medium", "high"])
export const languagePreferenceSchema = z.enum(["system", "zh-CN", "en"])

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
      value.length > 0 && new TextEncoder().encode(value).byteLength <= 200,
  )
const providerNameSchema = unicodeScalarStringSchema
  .transform(trimRustWhitespace)
  .refine((value) => value.length > 0 && [...value].length <= 100)
const secretSchema = unicodeScalarStringSchema
  .refine(containsNonRustWhitespace)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 16 * 1024)
const generatedChunkSchema = unicodeScalarStringSchema.refine(
  (value) =>
    new TextEncoder().encode(value).byteLength <= MAX_GENERATED_CONTENT_BYTES,
)

export const apiKeyActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("replace"), value: secretSchema }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
])
export const emptyProviderRequestSchema = z.object({}).strict()
export const saveProviderRequestSchema = z
  .object({
    id: idSchema.optional(),
    name: providerNameSchema,
    protocol: protocolSchema,
    base_endpoint: endpointSchema,
    model: modelSchema,
    models: z.array(modelSchema).min(1).max(50),
    api_key: apiKeyActionSchema,
  })
  .strict()
export const deleteProviderRequestSchema = z
  .object({ provider_id: idSchema })
  .strict()
export const setActiveProviderRequestSchema = deleteProviderRequestSchema
export const setAutoGenerateTitleRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict()
export const setAutoGenerateTitleResultSchema =
  setAutoGenerateTitleRequestSchema
export const titleModelBindingDtoSchema = z
  .object({ provider_id: idSchema, model: modelSchema })
  .strict()
export const setTitleModelBindingRequestSchema = z
  .object({ binding: titleModelBindingDtoSchema.nullable() })
  .strict()
export const setTitleModelBindingResultSchema =
  setTitleModelBindingRequestSchema
export const setLanguageRequestSchema = z
  .object({ language: languagePreferenceSchema })
  .strict()
export const setLanguageResultSchema = setLanguageRequestSchema
export const revealProviderApiKeyRequestSchema = deleteProviderRequestSchema
export const revealProviderApiKeyResultSchema = z
  .object({ api_key: secretSchema.nullable() })
  .strict()
export const listProviderModelsRequestSchema = z
  .object({
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("saved"), provider_id: idSchema }).strict(),
      z
        .object({
          type: z.literal("draft"),
          protocol: protocolSchema,
          base_endpoint: endpointSchema,
          api_key: secretSchema.nullable(),
        })
        .strict(),
    ]),
  })
  .strict()
export const generateFromActivePathRequestSchema = z
  .object({ conversation_id: idSchema, active_node_id: idSchema })
  .strict()
export const cancelGenerationRequestSchema = z
  .object({ generation_id: generationUuidSchema })
  .strict()

export const providerDtoSchema = z
  .object({
    id: idSchema,
    name: providerNameSchema,
    protocol: protocolSchema,
    base_endpoint: endpointSchema,
    model: modelSchema,
    models: z.array(modelSchema).min(1).max(50),
    has_api_key: z.boolean(),
    created_at: z.number().int().safe(),
    updated_at: z.number().int().safe(),
  })
  .strict()
export const listProvidersResultSchema = z
  .object({
    providers: z.array(providerDtoSchema),
    active_provider_id: idSchema.nullable().optional(),
    auto_generate_title: z.boolean(),
    title_model_binding: titleModelBindingDtoSchema.nullable(),
    language: languagePreferenceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const ids = new Set<string>()
    result.providers.forEach((provider, index) => {
      if (ids.has(provider.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate provider",
          path: ["providers", index, "id"],
        })
      }
      ids.add(provider.id)
    })
    if (
      result.active_provider_id !== undefined &&
      result.active_provider_id !== null &&
      !ids.has(result.active_provider_id)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "active provider is absent",
        path: ["active_provider_id"],
      })
    }
  })
export const deleteProviderResultSchema = z
  .object({ deleted: z.boolean() })
  .strict()
export const setActiveProviderResultSchema = z
  .object({ active_provider_id: idSchema })
  .strict()
export const modelSummaryDtoSchema = z
  .object({ id: modelSchema, display_name: z.string().optional() })
  .strict()
export const listProviderModelsResultSchema = z
  .object({ models: z.array(modelSummaryDtoSchema).max(500) })
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
    content: generatedChunkSchema,
  })
  .strict()
const thinkingDeltaEventSchema = deltaEventSchema.extend({
  type: z.literal("thinking_delta"),
})
export const generationEventDtoSchema = z.discriminatedUnion("type", [
  startedEventSchema,
  deltaEventSchema,
  thinkingDeltaEventSchema,
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
  .object({ type: z.literal("cancelled"), generation_id: generationUuidSchema })
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

export type ProviderDto = z.infer<typeof providerDtoSchema>
export type ListProvidersResultDto = z.infer<typeof listProvidersResultSchema>
export type ModelSummaryDto = z.infer<typeof modelSummaryDtoSchema>
export type GenerationEventDto = z.infer<typeof generationEventDtoSchema>
export type GenerationTerminalDto = z.infer<typeof generationTerminalDtoSchema>
