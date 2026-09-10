import { z } from "zod"

const tokenCountSchema = z.number().int().nonnegative()
const usageSourceSchema = z.enum(["chat", "title"])

export const emptyUsageRequestSchema = z.object({}).strict()

const usageTotalsDtoSchema = z
  .object({
    input: tokenCountSchema,
    output: tokenCountSchema,
    total: tokenCountSchema,
    records: tokenCountSchema,
  })
  .strict()

const usageByDayDtoSchema = z
  .object({
    day: z.string().min(1),
    input: tokenCountSchema,
    output: tokenCountSchema,
    total: tokenCountSchema,
    records: tokenCountSchema,
  })
  .strict()

const usageByModelDtoSchema = z
  .object({
    provider_id: z.string().min(1),
    model: z.string().min(1),
    input: tokenCountSchema,
    output: tokenCountSchema,
    total: tokenCountSchema,
    records: tokenCountSchema,
  })
  .strict()

const usageBySourceDtoSchema = z
  .object({
    source: usageSourceSchema,
    input: tokenCountSchema,
    output: tokenCountSchema,
    total: tokenCountSchema,
    records: tokenCountSchema,
  })
  .strict()

export const usageSummaryDtoSchema = z
  .object({
    totals: usageTotalsDtoSchema,
    by_day: z.array(usageByDayDtoSchema),
    by_model: z.array(usageByModelDtoSchema),
    by_source: z.array(usageBySourceDtoSchema),
  })
  .strict()

export const clearUsageRecordsResultSchema = z
  .object({ cleared: z.literal(true) })
  .strict()

export type UsageSummaryDto = z.infer<typeof usageSummaryDtoSchema>
export type ClearUsageRecordsResultDto = z.infer<
  typeof clearUsageRecordsResultSchema
>
