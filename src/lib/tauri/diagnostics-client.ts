import {
  ConversationCommandError,
  defaultTransport,
  internalError,
  normalizeCommandError,
  type InvokeTransport,
} from "./client"
import {
  emptyDiagnosticsRequestSchema,
  loggingSettingsDtoSchema,
  openLogDirectoryResultSchema,
  saveLoggingSettingsRequestSchema,
  type LoggingSettingsDto,
} from "./diagnostics-schemas"

export const DIAGNOSTICS_COMMANDS = {
  getLoggingSettings: "get_logging_settings",
  saveLoggingSettings: "save_logging_settings",
  openLogDirectory: "open_log_directory",
} as const

export type LoggingPolicyView = {
  maxFileMib: number
  maxFiles: number
}

export type LoggingLimitsView = {
  defaultMaxFileMib: number
  defaultMaxFiles: number
  maxFileMib: number
  maxFiles: number
  maxTotalMib: number
}

export type LoggingConfigStatus =
  "default" | "custom" | "recovered" | "invalid_fallback"

export type LoggingSinkStatus = "persistent" | "console_fallback" | "disabled"

export type LoggingSettingsView = {
  configured: LoggingPolicyView
  active: LoggingPolicyView
  limits: LoggingLimitsView
  configStatus: LoggingConfigStatus
  sinkStatus: LoggingSinkStatus
  restartRequired: boolean
}

export type DiagnosticsClient = ReturnType<typeof createDiagnosticsClient>

export function createDiagnosticsClient(
  transport: InvokeTransport = defaultTransport,
) {
  return {
    async getLoggingSettings(): Promise<LoggingSettingsView> {
      return diagnosticsCall(
        transport,
        DIAGNOSTICS_COMMANDS.getLoggingSettings,
        emptyDiagnosticsRequestSchema,
        {},
        loggingSettingsDtoSchema,
        mapLoggingSettings,
      )
    },

    async saveLoggingSettings(
      maxFileMib: number,
      maxFiles: number,
    ): Promise<LoggingSettingsView> {
      return diagnosticsCall(
        transport,
        DIAGNOSTICS_COMMANDS.saveLoggingSettings,
        saveLoggingSettingsRequestSchema,
        { max_file_mib: maxFileMib, max_files: maxFiles },
        loggingSettingsDtoSchema,
        mapLoggingSettings,
      )
    },

    async openLogDirectory(): Promise<boolean> {
      return diagnosticsCall(
        transport,
        DIAGNOSTICS_COMMANDS.openLogDirectory,
        emptyDiagnosticsRequestSchema,
        {},
        openLogDirectoryResultSchema,
        (value) => value.opened,
      )
    },
  }
}

async function diagnosticsCall<TWire, TResponse, TResult>(
  transport: InvokeTransport,
  command: string,
  requestSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TWire } | { success: false }
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
  if (!parsedRequest.success) {
    throw new ConversationCommandError({
      code: "invalid_input",
      message: "请求包含无效输入。",
      retryable: false,
    })
  }
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

function mapLoggingSettings(dto: LoggingSettingsDto): LoggingSettingsView {
  return {
    configured: {
      maxFileMib: dto.configured.max_file_mib,
      maxFiles: dto.configured.max_files,
    },
    active: {
      maxFileMib: dto.active.max_file_mib,
      maxFiles: dto.active.max_files,
    },
    limits: {
      defaultMaxFileMib: dto.limits.default_max_file_mib,
      defaultMaxFiles: dto.limits.default_max_files,
      maxFileMib: dto.limits.max_file_mib,
      maxFiles: dto.limits.max_files,
      maxTotalMib: dto.limits.max_total_mib,
    },
    configStatus: dto.config_status,
    sinkStatus: dto.sink_status,
    restartRequired: dto.restart_required,
  }
}
