import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { UsagePanel } from "./UsagePanel"
import {
  ConversationCommandError,
  type UsageClient,
  type UsageSummaryView,
} from "@/lib/tauri"

const NOW = new Date(2026, 8, 10, 15, 0, 0)

function emptySummary(): UsageSummaryView {
  return {
    totals: { input: 0, output: 0, total: 0, records: 0 },
    byDay: [],
    byModel: [],
    bySource: [],
  }
}

function populatedSummary(): UsageSummaryView {
  return {
    totals: { input: 85300, output: 43100, total: 128450, records: 342 },
    byDay: [
      {
        day: "2026-08-11",
        input: 100,
        output: 20,
        total: 120,
        records: 1,
      },
      {
        day: "2026-08-12",
        input: 400,
        output: 100,
        total: 500,
        records: 2,
      },
      {
        day: "2026-09-03",
        input: 2000,
        output: 500,
        total: 2500,
        records: 3,
      },
      {
        day: "2026-09-04",
        input: 3000,
        output: 1000,
        total: 4000,
        records: 4,
      },
      {
        day: "2026-09-09",
        input: 8000,
        output: 2000,
        total: 10000,
        records: 8,
      },
      {
        day: "2026-09-10",
        input: 10100,
        output: 2200,
        total: 12300,
        records: 18,
      },
    ],
    byModel: [
      {
        providerId: "openai",
        model: "gpt-5",
        input: 80200,
        output: 40100,
        total: 120300,
        records: 300,
      },
      {
        providerId: "anthropic",
        model: "claude-opus",
        input: 5100,
        output: 3000,
        total: 8100,
        records: 42,
      },
    ],
    bySource: [
      {
        source: "chat",
        input: 84200,
        output: 42400,
        total: 126650,
        records: 324,
      },
      { source: "title", input: 1100, output: 700, total: 1800, records: 18 },
    ],
  }
}

function usageClient(overrides?: Partial<UsageClient>): UsageClient {
  return {
    getUsageSummary: vi.fn().mockResolvedValue(emptySummary()),
    clearUsageRecords: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("UsagePanel", () => {
  it("shows the empty copy without zero-value cards", async () => {
    render(<UsagePanel client={usageClient()} now={NOW} />)

    expect(await screen.findByText("暂无用量数据")).toBeVisible()
    expect(screen.queryByText("总 Token")).not.toBeInTheDocument()
    expect(screen.queryByText("生成记录数")).not.toBeInTheDocument()
    expect(screen.queryByText("今日")).not.toBeInTheDocument()
    expect(screen.queryByText("近 7 日")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("img", { name: "近一年每日用量热度图" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除统计数据" }),
    ).not.toBeInTheDocument()
  })

  it("renders summary cards, source breakdown, heatmap, and detail tabs from fixture data", async () => {
    const user = userEvent.setup()
    const numberFormat = new Intl.NumberFormat("zh-CN")
    render(
      <UsagePanel
        client={usageClient({
          getUsageSummary: vi.fn().mockResolvedValue(populatedSummary()),
        })}
        now={NOW}
      />,
    )

    expect(await screen.findByText("总 Token")).toBeVisible()
    expect(screen.getByText(numberFormat.format(128450))).toBeVisible()
    expect(screen.getByText(numberFormat.format(342))).toBeVisible()
    expect(screen.getByText(numberFormat.format(12300))).toBeVisible()
    expect(screen.getByText(numberFormat.format(26300))).toBeVisible()
    expect(screen.getByText("按来源")).toBeVisible()
    expect(screen.getByText("聊天回复")).toBeVisible()
    expect(screen.getByText("标题生成")).toBeVisible()
    expect(screen.getByText("126.7k")).toBeVisible()
    expect(screen.getByText("1.8k")).toBeVisible()
    expect(
      screen.getByRole("img", { name: "近一年每日用量热度图" }),
    ).toBeVisible()

    const modelTable = screen.getByRole("table", { name: "按模型用量" })
    expect(within(modelTable).getByText("openai")).toBeVisible()
    expect(within(modelTable).getByText("gpt-5")).toBeVisible()
    expect(within(modelTable).getByText("120.3k")).toBeVisible()
    expect(within(modelTable).getByText("80.2k")).toBeVisible()
    expect(within(modelTable).getByText("40.1k")).toBeVisible()
    expect(within(modelTable).getByText("anthropic")).toBeVisible()
    const modelRows = within(modelTable).getAllByRole("row")
    expect(modelRows[1]).toHaveTextContent("openai")
    expect(modelRows[2]).toHaveTextContent("anthropic")

    expect(
      screen.queryByRole("table", { name: "按日用量" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "按日（近 30 天）" }))
    const dayTable = screen.getByRole("table", { name: "按日用量" })
    const dayRows = within(dayTable).getAllByRole("row").slice(1)
    expect(dayRows.map((row) => row.firstChild?.textContent)).toEqual([
      "2026-09-10",
      "2026-09-09",
      "2026-09-04",
      "2026-09-03",
      "2026-08-12",
    ])
    expect(screen.queryByText("2026-08-11")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "清除统计数据" })).toBeVisible()
  })

  it("refetches on refresh", async () => {
    const user = userEvent.setup()
    const getUsageSummary = vi
      .fn()
      .mockResolvedValueOnce(emptySummary())
      .mockResolvedValueOnce(populatedSummary())
    render(<UsagePanel client={usageClient({ getUsageSummary })} now={NOW} />)
    expect(await screen.findByText("暂无用量数据")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "刷新" }))
    expect(await screen.findByText("总 Token")).toBeVisible()
    expect(getUsageSummary).toHaveBeenCalledTimes(2)
  })

  it("clears records after a second confirmation and returns to empty", async () => {
    const user = userEvent.setup()
    const clearUsageRecords = vi.fn().mockResolvedValue(undefined)
    render(
      <UsagePanel
        client={usageClient({
          getUsageSummary: vi.fn().mockResolvedValue(populatedSummary()),
          clearUsageRecords,
        })}
        now={NOW}
      />,
    )
    expect(await screen.findByText("总 Token")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "清除统计数据" }))
    const confirm = screen.getByRole("alertdialog")
    expect(confirm).toHaveTextContent("清除用量统计？")
    await user.click(
      within(confirm).getByRole("button", { name: "清除统计数据" }),
    )

    expect(await screen.findByText("暂无用量数据")).toBeVisible()
    expect(clearUsageRecords).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("总 Token")).not.toBeInTheDocument()
  })

  it("ignores a refresh that resolves after clear succeeds", async () => {
    const user = userEvent.setup()
    let resolveRefresh: ((value: UsageSummaryView) => void) | undefined
    const getUsageSummary = vi
      .fn()
      .mockResolvedValueOnce(populatedSummary())
      .mockImplementationOnce(
        () =>
          new Promise<UsageSummaryView>((resolve) => {
            resolveRefresh = resolve
          }),
      )
    const clearUsageRecords = vi.fn().mockResolvedValue(undefined)
    render(
      <UsagePanel
        client={usageClient({ getUsageSummary, clearUsageRecords })}
        now={NOW}
      />,
    )
    expect(await screen.findByText("总 Token")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "清除统计数据" }))
    fireEvent.click(screen.getByRole("button", { name: "刷新", hidden: true }))
    const confirm = screen.getByRole("alertdialog")
    await user.click(
      within(confirm).getByRole("button", { name: "清除统计数据" }),
    )
    expect(await screen.findByText("暂无用量数据")).toBeVisible()

    resolveRefresh?.(populatedSummary())
    await waitFor(() => {
      expect(screen.getByText("暂无用量数据")).toBeVisible()
      expect(screen.queryByText("总 Token")).not.toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled()
  })

  it("shows a load error that refresh can retry", async () => {
    const user = userEvent.setup()
    const getUsageSummary = vi
      .fn()
      .mockRejectedValueOnce(
        new ConversationCommandError({
          code: "database_unavailable",
          message: "database unavailable",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(emptySummary())
    render(<UsagePanel client={usageClient({ getUsageSummary })} now={NOW} />)

    expect(await screen.findByText("用量数据加载失败")).toBeVisible()
    expect(screen.getByText("对话数据库当前不可用。")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "刷新" }))
    expect(await screen.findByText("暂无用量数据")).toBeVisible()
  })
})
