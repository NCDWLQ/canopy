import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { UsageHeatmap } from "./UsageHeatmap"
import { buildHeatmapCells, heatmapLevel, localIsoDate } from "./usageHeatmap"

const NOW = new Date(2026, 8, 10, 12, 0, 0)

describe("heatmapLevel", () => {
  it("maps relative totals onto a 0-4 scale", () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(25, 100)).toBe(1)
    expect(heatmapLevel(26, 100)).toBe(2)
    expect(heatmapLevel(50, 100)).toBe(2)
    expect(heatmapLevel(51, 100)).toBe(3)
    expect(heatmapLevel(75, 100)).toBe(3)
    expect(heatmapLevel(76, 100)).toBe(4)
    expect(heatmapLevel(100, 0)).toBe(0)
  })
})

describe("buildHeatmapCells", () => {
  it("fills 371 Sunday-aligned cells including today", () => {
    const cells = buildHeatmapCells(
      [{ day: localIsoDate(NOW), total: 42 }],
      NOW,
    )
    expect(cells).toHaveLength(371)
    expect(cells[0]?.date).toBe("2025-09-07")
    expect(
      cells.some((cell) => cell.date === "2026-09-10" && cell.total === 42),
    ).toBe(true)
    const todayIndex = cells.findIndex((cell) => cell.date === "2026-09-10")
    expect(cells[todayIndex]?.inFuture).toBe(false)
    expect(cells[todayIndex + 1]?.inFuture).toBe(true)
  })
})

describe("UsageHeatmap", () => {
  it("renders 371 cells with relative levels and date labels", async () => {
    const user = userEvent.setup()
    render(
      <UsageHeatmap
        now={NOW}
        byDay={[
          { day: "2026-09-10", total: 100 },
          { day: "2026-09-09", total: 25 },
        ]}
      />,
    )

    const heatmap = screen.getByRole("img", { name: "近一年每日用量热度图" })
    const cells = heatmap.querySelectorAll("[data-date]")
    expect(cells).toHaveLength(371)

    const today = heatmap.querySelector('[data-date="2026-09-10"]')
    const yesterday = heatmap.querySelector('[data-date="2026-09-09"]')
    const empty = heatmap.querySelector('[data-date="2026-09-08"]')
    expect(today).toHaveAttribute("data-level", "4")
    expect(yesterday).toHaveAttribute("data-level", "1")
    expect(empty).toHaveAttribute("data-level", "0")
    expect(today).toHaveAccessibleName("2026-09-10：100 token")

    await user.hover(today as HTMLElement)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "2026-09-10 · 100 token",
    )
  })
})
