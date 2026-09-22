import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n"

import {
  buildHeatmapCells,
  heatmapLevel,
  type HeatmapDay,
} from "./usageHeatmap"

const LEVEL_CLASS = [
  "bg-muted",
  "bg-primary/20",
  "bg-primary/40",
  "bg-primary/70",
  "bg-primary",
] as const

export function UsageHeatmap({
  byDay,
  now = new Date(),
}: {
  byDay: readonly HeatmapDay[]
  now?: Date
}) {
  const { t } = useTranslation()
  const cells = buildHeatmapCells(byDay, now)
  const max = cells.reduce(
    (current, cell) =>
      cell.inFuture ? current : Math.max(current, cell.total),
    0,
  )
  const weekdayLabels = [
    t("settings.usage.weekdaySun"),
    t("settings.usage.weekdayMon"),
    t("settings.usage.weekdayTue"),
    t("settings.usage.weekdayWed"),
    t("settings.usage.weekdayThu"),
    t("settings.usage.weekdayFri"),
    t("settings.usage.weekdaySat"),
  ]

  return (
    <div className="flex w-full gap-2 pb-1">
      <div
        className="grid shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground"
        aria-hidden="true"
      >
        {weekdayLabels.map((label, index) => (
          <span
            key={`${index}-${label}`}
            className={cn(
              "flex h-2.5 items-center",
              index % 2 === 1 ? "visible" : "invisible",
            )}
          >
            {label}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={t("settings.usage.heatmapLabel")}
        className="grid min-w-0 flex-1 grid-flow-col grid-cols-[repeat(53,minmax(0,1fr))] grid-rows-[repeat(7,0.625rem)] items-center gap-[3px]"
      >
        {cells.map((cell) => {
          const level = cell.inFuture ? 0 : heatmapLevel(cell.total, max)
          return (
            <Tooltip key={cell.date}>
              <TooltipTrigger asChild>
                <span
                  data-date={cell.date}
                  data-level={level}
                  aria-label={t("settings.usage.heatmapCell", {
                    day: cell.date,
                    tokens: cell.total,
                  })}
                  className={cn(
                    "block aspect-square w-full max-w-2.5 justify-self-center rounded-[2px]",
                    LEVEL_CLASS[level],
                    cell.inFuture && "opacity-40",
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>
                {t("settings.usage.heatmapTooltip", {
                  day: cell.date,
                  tokens: cell.total,
                })}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
