import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  ConversationCommandError,
  type UsageClient,
  type UsageSummaryView,
} from "@/lib/tauri"

import { UsagePanel } from "./UsagePanel"

const NOW = new Date(2026, 8, 10, 15, 0, 0)
type UsageOptions = Parameters<UsageClient["getUsageSummary"]>[0]

function summary(total = 128450, marker = "gpt-5"): UsageSummaryView {
  const output = total === 128450 ? 43100 : Math.floor(total / 3)
  const input = total - output
  return {
    totals: { input, output, total, records: total ? 342 : 0 },
    byDay: total
      ? [
          {
            day: "2026-09-10",
            input: 10100,
            output: 2200,
            total: 12300,
            records: 18,
          },
        ]
      : [],
    byModel: total
      ? [
          {
            providerId: "openai",
            model: marker,
            input,
            output,
            total,
            records: 342,
          },
        ]
      : [],
    bySource: total
      ? [{ source: "chat", input, output, total, records: 342 }]
      : [],
  }
}

function overviewForDay(day: string, total: number): UsageSummaryView {
  return {
    totals: { input: total, output: 0, total, records: 1 },
    byDay: [{ day, input: total, output: 0, total, records: 1 }],
    byModel: [
      {
        providerId: "openai",
        model: `overview-${day}`,
        input: total,
        output: 0,
        total,
        records: 1,
      },
    ],
    bySource: [{ source: "chat", input: total, output: 0, total, records: 1 }],
  }
}

function usageClient(
  getUsageSummary: UsageClient["getUsageSummary"] = vi.fn(
    (options: UsageOptions) =>
      Promise.resolve(
        options?.range === "all" ? summary() : summary(300, "last-30"),
      ),
  ),
): UsageClient {
  return {
    getUsageSummary,
    clearUsageRecords: vi.fn().mockResolvedValue(undefined),
  }
}

describe("UsagePanel", () => {
  it("keeps a globally empty overview as the whole-panel empty state", async () => {
    render(
      <UsagePanel
        client={usageClient(vi.fn().mockResolvedValue(summary(0)))}
        now={NOW}
      />,
    )
    expect(await screen.findByText("暂无用量数据")).toBeVisible()
    expect(
      screen.queryByRole("radiogroup", { name: "时间范围" }),
    ).not.toBeInTheDocument()
  })

  it("loads overview and default period with one through day, then shows source input/output and Calls", async () => {
    const user = userEvent.setup()
    const getUsageSummary = vi.fn((options: UsageOptions) =>
      Promise.resolve(
        options?.range === "all" ? summary() : summary(300, "last-30"),
      ),
    )
    render(<UsagePanel client={usageClient(getUsageSummary)} now={NOW} />)
    expect(await screen.findByText("总 Token")).toBeVisible()
    await waitFor(() => expect(screen.getByText("last-30")).toBeVisible())
    expect(getUsageSummary).toHaveBeenCalledWith({
      range: "all",
      through_day: "2026-09-10",
    })
    expect(getUsageSummary).toHaveBeenCalledWith({
      range: "last_30_days",
      through_day: "2026-09-10",
    })
    expect(screen.getByRole("radio", { name: "近 30 日" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByText("输入 / 输出 200 / 100")).toBeVisible()
    expect(screen.getAllByText("调用次数")).toHaveLength(2)
    expect(screen.queryByText("记录数")).not.toBeInTheDocument()
    const lastThirty = screen.getByRole("radio", { name: "近 30 日" })
    await user.click(lastThirty)
    expect(lastThirty).toHaveAttribute("aria-checked", "true")
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1)
    lastThirty.focus()
    await user.keyboard("{ArrowLeft}")
    const lastSeven = screen.getByRole("radio", { name: "近 7 日" })
    expect(lastSeven).toHaveFocus()
    await user.keyboard(" ")
    expect(lastSeven).toHaveAttribute("aria-checked", "true")
  })

  it("switches periods without showing old rows, ignores stale responses, and reuses overview for all time", async () => {
    const user = userEvent.setup()
    let resolveSeven: ((value: UsageSummaryView) => void) | undefined
    let resolveThirty: ((value: UsageSummaryView) => void) | undefined
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range === "all") return Promise.resolve(summary())
      if (options?.range === "last_30_days")
        return new Promise<UsageSummaryView>((resolve) => {
          resolveThirty = resolve
        })
      return new Promise<UsageSummaryView>((resolve) => {
        resolveSeven = resolve
      })
    })
    render(<UsagePanel client={usageClient(getUsageSummary)} now={NOW} />)
    expect(await screen.findByText("总 Token")).toBeVisible()
    resolveThirty?.(summary(300, "old-30"))
    expect(await screen.findByText("old-30")).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "近 7 日" }))
    expect(screen.queryByText("old-30")).not.toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: "近 30 日" }))
    resolveSeven?.(summary(70, "stale-7"))
    resolveThirty?.(summary(30, "current-30"))
    expect(await screen.findByText("current-30")).toBeVisible()
    expect(screen.queryByText("stale-7")).not.toBeInTheDocument()
    const beforeAll = getUsageSummary.mock.calls.length
    await user.click(screen.getByRole("radio", { name: "全部" }))
    expect(await screen.findByText("gpt-5")).toBeVisible()
    expect(getUsageSummary).toHaveBeenCalledTimes(beforeAll)
  })

  it("keeps overview visible when a selected period fails and keeps the selector operable", async () => {
    const user = userEvent.setup()
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range === "all") return Promise.resolve(summary())
      if (options?.range === "last_30_days")
        return Promise.resolve(summary(300, "last-30"))
      return Promise.reject(
        new ConversationCommandError({
          code: "database_unavailable",
          message: "no",
          retryable: true,
        }),
      )
    })
    render(<UsagePanel client={usageClient(getUsageSummary)} now={NOW} />)
    expect(await screen.findByText("总 Token")).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "近 7 日" }))
    expect(await screen.findByText("所选时间范围加载失败")).toBeVisible()
    expect(screen.getByText("总 Token")).toBeVisible()
    expect(screen.getByRole("radio", { name: "全部" })).toBeEnabled()
  })

  it("keeps a period-only empty state switchable beneath the non-empty overview", async () => {
    const user = userEvent.setup()
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range === "all") return Promise.resolve(summary())
      if (options?.range === "last_7_days") return Promise.resolve(summary(0))
      return Promise.resolve(summary(30, "last-30"))
    })
    render(<UsagePanel client={usageClient(getUsageSummary)} now={NOW} />)

    expect(await screen.findByText("last-30")).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "近 7 日" }))
    expect(await screen.findByText("此时间范围内暂无用量")).toBeVisible()
    expect(screen.getByRole("radio", { name: "全部" })).toBeEnabled()
    await user.click(screen.getByRole("radio", { name: "全部" }))
    expect(await screen.findByText("gpt-5")).toBeVisible()
  })

  it("uses the period result for day rows and the neutral day-tab copy", async () => {
    const user = userEvent.setup()
    render(<UsagePanel client={usageClient()} now={NOW} />)
    expect(await screen.findByText("last-30")).toBeVisible()
    await user.click(screen.getByRole("tab", { name: "按日" }))
    const table = screen.getByRole("table", { name: "按日用量" })
    expect(within(table).getByText("2026-09-10")).toBeVisible()
  })

  it("refreshes cards and the heatmap from the same newly captured day across midnight", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 23, 59, 0))
    const getUsageSummary = vi.fn((options: UsageOptions) =>
      Promise.resolve(
        options?.range === "all"
          ? overviewForDay(options.through_day ?? "2026-09-10", 20)
          : summary(30, "detail"),
      ),
    )
    try {
      const { unmount } = render(
        <UsagePanel client={usageClient(getUsageSummary)} />,
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText("总 Token")).toBeVisible()
      vi.setSystemTime(new Date(2026, 8, 11, 0, 1, 0))
      fireEvent.click(screen.getByRole("button", { name: "刷新" }))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(getUsageSummary).toHaveBeenCalledWith({
        range: "all",
        through_day: "2026-09-11",
      })
      const todayCard = screen.getByText("今日 Token").parentElement
      expect(todayCard).toHaveTextContent("20")
      const heatmap = screen.getByRole("img", {
        name: "近一年每日用量热度图",
      })
      expect(heatmap.querySelector('[data-date="2026-09-11"]')).toHaveAttribute(
        "data-level",
        "4",
      )

      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears records only after confirmation and keeps late selected-period results invalidated", async () => {
    const user = userEvent.setup()
    let resolveSeven: ((value: UsageSummaryView) => void) | undefined
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range === "all") return Promise.resolve(summary())
      if (options?.range === "last_7_days") {
        return new Promise<UsageSummaryView>((resolve) => {
          resolveSeven = resolve
        })
      }
      return Promise.resolve(summary(30, "last-30"))
    })
    const clearUsageRecords = vi.fn().mockResolvedValue(undefined)
    render(
      <UsagePanel client={{ getUsageSummary, clearUsageRecords }} now={NOW} />,
    )

    expect(await screen.findByText("总 Token")).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "近 7 日" }))
    await user.click(screen.getByRole("button", { name: "清除统计数据" }))
    const confirm = screen.getByRole("alertdialog")
    expect(confirm).toHaveTextContent("清除用量统计？")
    await user.click(
      within(confirm).getByRole("button", { name: "清除统计数据" }),
    )

    expect(await screen.findByText("暂无用量数据")).toBeVisible()
    expect(clearUsageRecords).toHaveBeenCalledTimes(1)
    resolveSeven?.(summary(7, "late-seven"))
    await waitFor(() => {
      expect(screen.queryByText("late-seven")).not.toBeInTheDocument()
      expect(screen.queryByText("总 Token")).not.toBeInTheDocument()
    })
  })

  it("lets refresh retry an initial overview failure", async () => {
    const user = userEvent.setup()
    let overviewAttempts = 0
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range !== "all")
        return Promise.resolve(summary(30, "detail"))
      overviewAttempts += 1
      if (overviewAttempts === 1) {
        return Promise.reject(
          new ConversationCommandError({
            code: "database_unavailable",
            message: "no",
            retryable: true,
          }),
        )
      }
      return Promise.resolve(summary())
    })
    render(<UsagePanel client={usageClient(getUsageSummary)} now={NOW} />)

    expect(await screen.findByText("用量数据加载失败")).toBeVisible()
    expect(screen.getByText("对话数据库当前不可用。")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "刷新" }))
    expect(await screen.findByText("总 Token")).toBeVisible()
    expect(overviewAttempts).toBe(2)
  })

  it("preserves both loaded snapshots when clearing fails", async () => {
    const user = userEvent.setup()
    const clearUsageRecords = vi.fn().mockRejectedValue(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "no",
        retryable: true,
      }),
    )
    render(
      <UsagePanel
        client={{
          getUsageSummary: vi.fn().mockResolvedValue(summary()),
          clearUsageRecords,
        }}
        now={NOW}
      />,
    )

    expect(await screen.findByText("gpt-5")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "清除统计数据" }))
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "清除统计数据",
      }),
    )

    expect(await screen.findByText("未能清除用量数据")).toBeVisible()
    expect(screen.getByText("gpt-5")).toBeVisible()
  })

  it("keeps the prior display day and overview together while a cross-midnight refresh waits or fails", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 23, 59, 0))
    let overviewCalls = 0
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    const getUsageSummary = vi.fn((options: UsageOptions) => {
      if (options?.range !== "all")
        return Promise.resolve(summary(30, "detail"))
      overviewCalls += 1
      if (overviewCalls === 1)
        return Promise.resolve(overviewForDay("2026-09-10", 10))
      return new Promise<UsageSummaryView>((_resolve, reject) => {
        rejectRefresh = reject
      })
    })
    try {
      const { unmount } = render(
        <UsagePanel client={usageClient(getUsageSummary)} />,
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      vi.setSystemTime(new Date(2026, 8, 11, 0, 1, 0))
      fireEvent.click(screen.getByRole("button", { name: "刷新" }))
      await act(async () => {
        await Promise.resolve()
      })
      expect(screen.getByText("今日 Token").parentElement).toHaveTextContent(
        "10",
      )

      rejectRefresh?.(
        new ConversationCommandError({
          code: "database_unavailable",
          message: "no",
          retryable: true,
        }),
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByText("用量数据加载失败")).toBeVisible()
      expect(screen.getByText("今日 Token").parentElement).toHaveTextContent(
        "10",
      )

      unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
