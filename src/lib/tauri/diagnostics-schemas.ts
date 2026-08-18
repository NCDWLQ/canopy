import { z } from "zod"

export const LOGGING_LIMITS = {
  defaultMaxFileMib: 5,
  defaultMaxFiles: 5,
  maxFileMib: 20,
  maxFiles: 10,
  maxTotalMib: 100,
} as const

export const emptyDiagnosticsRequestSchema = z.object({}).strict()

export const loggingPolicyDtoSchema = z
  .object({
    max_file_mib: z.number().int().min(1).max(LOGGING_LIMITS.maxFileMib),
    max_files: z.number().int().min(1).max(LOGGING_LIMITS.maxFiles),
  })
  .strict()
  .refine(
    (value) =>
      value.max_file_mib * value.max_files <= LOGGING_LIMITS.maxTotalMib,
  )

export const saveLoggingSettingsRequestSchema = loggingPolicyDtoSchema

export const loggingLimitsDtoSchema = z
  .object({
    default_max_file_mib: z.literal(LOGGING_LIMITS.defaultMaxFileMib),
    default_max_files: z.literal(LOGGING_LIMITS.defaultMaxFiles),
    max_file_mib: z.literal(LOGGING_LIMITS.maxFileMib),
    max_files: z.literal(LOGGING_LIMITS.maxFiles),
    max_total_mib: z.literal(LOGGING_LIMITS.maxTotalMib),
  })
  .strict()

export const configStatusSchema = z.enum([
  "default",
  "custom",
  "recovered",
  "invalid_fallback",
])

export const sinkStatusSchema = z.enum([
  "persistent",
  "console_fallback",
  "disabled",
])

export const loggingSettingsDtoSchema = z
  .object({
    configured: loggingPolicyDtoSchema,
    active: loggingPolicyDtoSchema,
    limits: loggingLimitsDtoSchema,
    config_status: configStatusSchema,
    sink_status: sinkStatusSchema,
    restart_required: z.boolean(),
  })
  .strict()

export const openLogDirectoryResultSchema = z
  .object({
    opened: z.literal(true),
  })
  .strict()

export type LoggingPolicyDto = z.infer<typeof loggingPolicyDtoSchema>
export type LoggingSettingsDto = z.infer<typeof loggingSettingsDtoSchema>
export type OpenLogDirectoryResultDto = z.infer<
  typeof openLogDirectoryResultSchema
>
