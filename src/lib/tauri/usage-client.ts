import {
  defaultTransport,
  internalError,
  normalizeCommandError,
  type InvokeTransport,
} from "./client"
import {
  clearUsageRecordsResultSchema,
  emptyUsageRequestSchema,
  usageSummaryRequestSchema,
  usageSummaryDtoSchema,
  type UsageSummaryRequestDto,
  type UsageSummaryDto,
} from "./usage-schemas"

export const USAGE_COMMANDS = {
  getUsageSummary: "get_usage_summary",
  clearUsageRecords: "clear_usage_records",
} as const

export type UsageTotalsView = {
  input: number
  output: number
  total: number
  records: number
}

export type UsageByDayView = {
  day: string
  input: number
  output: number
  total: number
  records: number
}

export type UsageByModelView = {
  providerId: string
  model: string
  input: number
  output: number
  total: number
  records: number
}

export type UsageSourceView = UsageSummaryDto["by_source"][number]["source"]

export type UsageBySourceView = {
  source: UsageSourceView
  input: number
  output: number
  total: number
  records: number
}

export type UsageSummaryView = {
  totals: UsageTotalsView
  byDay: UsageByDayView[]
  byModel: UsageByModelView[]
  bySource: UsageBySourceView[]
}

export type UsageRange = NonNullable<UsageSummaryRequestDto["range"]>
export type GetUsageSummaryOptions = UsageSummaryRequestDto

export type UsageClient = ReturnType<typeof createUsageClient>

export function createUsageClient(
  transport: InvokeTransport = defaultTransport,
) {
  return {
    async getUsageSummary(
      options: GetUsageSummaryOptions = {},
    ): Promise<UsageSummaryView> {
      return usageCall(
        transport,
        USAGE_COMMANDS.getUsageSummary,
        usageSummaryRequestSchema,
        options,
        usageSummaryDtoSchema,
        mapUsageSummary,
      )
    },

    async clearUsageRecords(): Promise<void> {
      await usageCall(
        transport,
        USAGE_COMMANDS.clearUsageRecords,
        emptyUsageRequestSchema,
        {},
        clearUsageRecordsResultSchema,
        () => undefined,
      )
    },
  }
}

function mapUsageSummary(value: UsageSummaryDto): UsageSummaryView {
  return {
    totals: value.totals,
    byDay: value.by_day,
    byModel: value.by_model.map((row) => ({
      providerId: row.provider_id,
      model: row.model,
      input: row.input,
      output: row.output,
      total: row.total,
      records: row.records,
    })),
    bySource: value.by_source,
  }
}

async function usageCall<TResponse, TResult>(
  transport: InvokeTransport,
  command: string,
  requestSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: Record<string, unknown> } | { success: false }
  },
  request: unknown,
  responseSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TResponse } | { success: false }
  },
  project: (value: TResponse) => TResult,
): Promise<TResult> {
  const parsedRequest = requestSchema.safeParse(request)
  if (!parsedRequest.success) throw internalError()
  let value: unknown
  try {
    value = await transport.invoke(command, { request: parsedRequest.data })
  } catch (error: unknown) {
    throw normalizeCommandError(error)
  }
  const parsedResponse = responseSchema.safeParse(value)
  if (!parsedResponse.success) throw internalError()
  return project(parsedResponse.data)
}
