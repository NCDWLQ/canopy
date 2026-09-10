import fixture from "../../../contract-fixtures/usage-ipc.json"

import { USAGE_COMMANDS, createUsageClient } from "./usage-client"
import { usageSummaryDtoSchema } from "./usage-schemas"
import { type InvokeTransport } from "./client"

type RecordedCall = { command: string; args: Record<string, unknown> }

class WireDatabaseError extends Error {
  readonly code = "database_unavailable"
  readonly retryable = true
}

function recordingTransport(
  responses: Readonly<Record<string, unknown>>,
): InvokeTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    invoke(command, args) {
      calls.push({ command, args })
      return Promise.resolve(responses[command])
    },
  }
}

describe("usage Tauri contract", () => {
  it("uses the usage command list and projects snake_case summaries", async () => {
    expect(Object.values(USAGE_COMMANDS)).toEqual(fixture.command_names)
    expect(
      usageSummaryDtoSchema.safeParse(fixture.successes.get_usage_summary)
        .success,
    ).toBe(true)

    const transport = recordingTransport({
      get_usage_summary: fixture.successes.get_usage_summary,
      clear_usage_records: fixture.successes.clear_usage_records,
    })
    const client = createUsageClient(transport)

    await expect(client.getUsageSummary()).resolves.toEqual({
      totals: { input: 80, output: 40, total: 120, records: 3 },
      byDay: [
        { day: "2026-09-10", input: 10, output: 2, total: 12, records: 1 },
      ],
      byModel: [
        {
          providerId: "openai",
          model: "gpt-5",
          input: 80,
          output: 40,
          total: 120,
          records: 3,
        },
      ],
      bySource: [
        { source: "chat", input: 70, output: 40, total: 110, records: 2 },
        { source: "title", input: 10, output: 0, total: 10, records: 1 },
      ],
    })
    expect(transport.calls[0]).toEqual({
      command: "get_usage_summary",
      args: { request: {} },
    })

    await expect(client.clearUsageRecords()).resolves.toBeUndefined()
    expect(transport.calls[1]).toEqual({
      command: "clear_usage_records",
      args: { request: {} },
    })
  })

  it("normalizes database_unavailable from the shared fixture", async () => {
    const transport: InvokeTransport = {
      invoke() {
        return Promise.reject(
          new WireDatabaseError(fixture.errors.database_unavailable.message),
        )
      },
    }
    await expect(
      createUsageClient(transport).getUsageSummary(),
    ).rejects.toMatchObject({
      code: "database_unavailable",
      retryable: true,
    })
  })

  it("rejects a malformed success payload as internal", async () => {
    const transport: InvokeTransport = {
      invoke() {
        return Promise.resolve({ totals: {} })
      },
    }
    await expect(
      createUsageClient(transport).getUsageSummary(),
    ).rejects.toMatchObject({ code: "internal", retryable: false })
  })
})
