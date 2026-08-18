import { describe, expect, it } from "vitest"

import { createDiagnosticsClient } from "./index"
import type { InvokeTransport } from "./client"
import { LOGGING_LIMITS } from "./diagnostics-schemas"

type RecordedCall = { command: string; args: Record<string, unknown> }

const settings = {
  configured: { max_file_mib: 5, max_files: 5 },
  active: { max_file_mib: 5, max_files: 5 },
  limits: {
    default_max_file_mib: 5,
    default_max_files: 5,
    max_file_mib: 20,
    max_files: 10,
    max_total_mib: 100,
  },
  config_status: "default",
  sink_status: "persistent",
  restart_required: false,
}

function recordingTransport(
  responses: Readonly<Record<string, unknown>> | ((command: string) => unknown),
): InvokeTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    invoke(command, args) {
      calls.push({ command, args })
      const value =
        typeof responses === "function"
          ? responses(command)
          : responses[command]
      if (value instanceof Error) return Promise.reject(value)
      return Promise.resolve(value)
    },
  }
}

describe("diagnostics Tauri contract", () => {
  it("uses the diagnostics command list and snake_case request wrappers", async () => {
    const transport = recordingTransport({
      get_logging_settings: settings,
      save_logging_settings: {
        ...settings,
        configured: { max_file_mib: 8, max_files: 4 },
        config_status: "custom",
        restart_required: true,
      },
      open_log_directory: { opened: true },
    })
    const client = createDiagnosticsClient(transport)
    await expect(client.getLoggingSettings()).resolves.toEqual({
      configured: { maxFileMib: 5, maxFiles: 5 },
      active: { maxFileMib: 5, maxFiles: 5 },
      limits: {
        defaultMaxFileMib: 5,
        defaultMaxFiles: 5,
        maxFileMib: 20,
        maxFiles: 10,
        maxTotalMib: 100,
      },
      configStatus: "default",
      sinkStatus: "persistent",
      restartRequired: false,
    })
    await expect(client.saveLoggingSettings(8, 4)).resolves.toMatchObject({
      configured: { maxFileMib: 8, maxFiles: 4 },
      restartRequired: true,
    })
    await expect(client.openLogDirectory()).resolves.toBe(true)
    expect(transport.calls.map((call) => call.command)).toEqual([
      "get_logging_settings",
      "save_logging_settings",
      "open_log_directory",
    ])
    expect(transport.calls[0]?.args).toEqual({ request: {} })
    expect(transport.calls[1]?.args).toEqual({
      request: { max_file_mib: 8, max_files: 4 },
    })
    expect(transport.calls[2]?.args).toEqual({ request: {} })
    expect(LOGGING_LIMITS.maxTotalMib).toBe(100)
  })

  it("rejects over-budget and non-integer save requests locally", async () => {
    const transport = recordingTransport({})
    const client = createDiagnosticsClient(transport)
    await expect(client.saveLoggingSettings(20, 10)).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
    })
    await expect(client.saveLoggingSettings(1.5, 5)).rejects.toMatchObject({
      code: "invalid_input",
    })
    expect(transport.calls).toEqual([])
  })

  it("normalizes malformed and rejected payloads", async () => {
    const malformed = recordingTransport({
      get_logging_settings: { opened: true },
    })
    await expect(
      createDiagnosticsClient(malformed).getLoggingSettings(),
    ).rejects.toMatchObject({ code: "internal", retryable: false })

    const rejected = recordingTransport({
      open_log_directory: Object.assign(new Error("无法打开日志目录。"), {
        code: "internal",
        retryable: true,
      }),
    })
    await expect(
      createDiagnosticsClient(rejected).openLogDirectory(),
    ).rejects.toMatchObject({
      code: "internal",
      message: "无法打开日志目录。",
      retryable: true,
    })
  })
})
