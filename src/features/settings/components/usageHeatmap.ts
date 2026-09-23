export type HeatmapDay = {
  day: string
  total: number
}

export type HeatmapCell = {
  date: string
  total: number
  inFuture: boolean
}

const CELL_COUNT = 371

export function localIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function buildHeatmapCells(
  byDay: readonly HeatmapDay[],
  now = new Date(),
): HeatmapCell[] {
  const totals = new Map(byDay.map((row) => [row.day, row.total]))
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const thisSunday = new Date(today)
  thisSunday.setDate(today.getDate() - today.getDay())
  const start = new Date(thisSunday)
  start.setDate(thisSunday.getDate() - 52 * 7)
  const cells: HeatmapCell[] = []
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = localIsoDate(date)
    cells.push({
      date: key,
      total: totals.get(key) ?? 0,
      inFuture: date > today,
    })
  }
  return cells
}

export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
