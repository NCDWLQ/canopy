import * as React from "react"
import { ChartColumn, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  createUsageClient,
  type UsageByDayView,
  type UsageClient,
  type UsageSummaryView,
  type UsageSourceView,
} from "@/lib/tauri"
import type { UiError } from "@/lib/tauri/types"

import { UsageHeatmap } from "./UsageHeatmap"
import { localIsoDate } from "./usageHeatmap"

export type UsagePanelProps = {
  client?: UsageClient
  now?: Date
}

type PanelStatus = "loading" | "ready" | "empty" | "error"
type DetailTab = "model" | "day"

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function sumTotalsBetween(
  byDay: readonly UsageByDayView[],
  start: string,
  end: string,
): number {
  return byDay
    .filter((row) => row.day >= start && row.day <= end)
    .reduce((sum, row) => sum + row.total, 0)
}

function recentDays(
  byDay: readonly UsageByDayView[],
  now: Date,
  count: number,
): UsageByDayView[] {
  const end = localIsoDate(now)
  const start = localIsoDate(addLocalDays(now, 1 - count))
  return byDay
    .filter((row) => row.day >= start && row.day <= end)
    .slice()
    .sort((left, right) => right.day.localeCompare(left.day))
}

function formatCompactCount(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${trimTrailingZero(value / 1_000_000)}M`
  }
  if (abs >= 1000) {
    return `${trimTrailingZero(value / 1000)}k`
  }
  return String(value)
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function isUiError(error: unknown): error is UiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
}

export function UsagePanel({ client, now: nowProp }: UsagePanelProps) {
  const { t, locale } = useTranslation()
  const usageClient = React.useMemo(
    () => client ?? createUsageClient(),
    [client],
  )
  const [status, setStatus] = React.useState<PanelStatus>("loading")
  const [summary, setSummary] = React.useState<UsageSummaryView | null>(null)
  const [error, setError] = React.useState<UiError | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [errorSource, setErrorSource] = React.useState<"load" | "clear">("load")
  const [detailTab, setDetailTab] = React.useState<DetailTab>("model")
  const [now] = React.useState(() => nowProp ?? new Date())
  const numberFormat = React.useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  )
  const percentageFormat = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        style: "percent",
      }),
    [locale],
  )

  const requestIdRef = React.useRef(0)

  const applyLoaded = React.useCallback((next: UsageSummaryView) => {
    setSummary(next)
    setStatus(next.totals.records === 0 ? "empty" : "ready")
    setError(null)
  }, [])

  React.useEffect(() => {
    const requestId = ++requestIdRef.current
    void usageClient.getUsageSummary().then(
      (next) => {
        if (requestIdRef.current !== requestId) return
        applyLoaded(next)
      },
      (caught: unknown) => {
        if (requestIdRef.current !== requestId) return
        setErrorSource("load")
        setError(isUiError(caught) ? caught : null)
        setStatus("error")
      },
    )
    return () => {
      requestIdRef.current += 1
    }
  }, [usageClient, applyLoaded])

  const handleRefresh = () => {
    const requestId = ++requestIdRef.current
    setRefreshing(true)
    setError(null)
    void usageClient.getUsageSummary().then(
      (next) => {
        if (requestIdRef.current !== requestId) return
        applyLoaded(next)
        setRefreshing(false)
      },
      (caught: unknown) => {
        if (requestIdRef.current !== requestId) return
        setErrorSource("load")
        setError(isUiError(caught) ? caught : null)
        setRefreshing(false)
      },
    )
  }

  const handleClear = async () => {
    setConfirmClear(false)
    const requestId = ++requestIdRef.current
    setRefreshing(false)
    setClearing(true)
    setError(null)
    try {
      await usageClient.clearUsageRecords()
      if (requestIdRef.current !== requestId) return
      setSummary({
        totals: { input: 0, output: 0, total: 0, records: 0 },
        byDay: [],
        byModel: [],
        bySource: [],
      })
      setStatus("empty")
    } catch (caught: unknown) {
      if (requestIdRef.current !== requestId) return
      setErrorSource("clear")
      setError(isUiError(caught) ? caught : null)
    } finally {
      if (requestIdRef.current === requestId) {
        setClearing(false)
      }
    }
  }

  const today = localIsoDate(now)
  const last7Start = localIsoDate(addLocalDays(now, -6))
  const todayTotal = summary ? sumTotalsBetween(summary.byDay, today, today) : 0
  const last7Total = summary
    ? sumTotalsBetween(summary.byDay, last7Start, today)
    : 0
  const inputOutput =
    summary === null
      ? ""
      : `${numberFormat.format(summary.totals.input)} / ${numberFormat.format(summary.totals.output)}`
  const dayRows = summary ? recentDays(summary.byDay, now, 30) : []
  const sourceRows = summary
    ? [...summary.bySource].sort((left, right) => right.total - left.total)
    : []
  const busy = status === "loading" || refreshing || clearing

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label={t("common.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>{t("common.settings")}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("settings.usage.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={handleRefresh}
        >
          {refreshing || status === "loading" ? (
            <Spinner
              className="size-3.5"
              role="presentation"
              aria-hidden="true"
              aria-label={undefined}
            />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {t("settings.usage.refresh")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-label={t("settings.usage.title")}
          className="flex flex-col gap-6"
        >
          {error !== null && (
            <Alert variant="destructive">
              <AlertTitle>
                {errorSource === "clear"
                  ? t("settings.usage.clearFailed")
                  : t("settings.usage.loadFailed")}
              </AlertTitle>
              <AlertDescription>
                {commandErrorMessage(error.code)}
              </AlertDescription>
            </Alert>
          )}
          {status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner
                className="size-4"
                aria-label={t("settings.usage.loading")}
              />
              <span>{t("settings.usage.loading")}</span>
            </div>
          )}
          {status === "empty" && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChartColumn aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("settings.usage.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("settings.usage.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {status === "ready" && summary !== null && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryCard
                  label={t("settings.usage.totalTokens")}
                  value={numberFormat.format(summary.totals.total)}
                />
                <SummaryCard
                  label={t("settings.usage.inputOutput")}
                  value={inputOutput}
                />
                <SummaryCard
                  label={t("settings.usage.today")}
                  value={numberFormat.format(todayTotal)}
                />
                <SummaryCard
                  label={t("settings.usage.last7Days")}
                  value={numberFormat.format(last7Total)}
                />
              </div>
              {sourceRows.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">
                    {t("settings.usage.bySourceTitle")}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sourceRows.map((row) => (
                      <SourceCard
                        key={row.source}
                        label={sourceLabel(row.source, t)}
                        total={formatCompactCount(row.total)}
                        records={numberFormat.format(row.records)}
                        recordsLabel={t("settings.usage.recordCount")}
                        share={percentageFormat.format(
                          summary.totals.total > 0
                            ? row.total / summary.totals.total
                            : 0,
                        )}
                        shareValue={
                          summary.totals.total > 0
                            ? (row.total / summary.totals.total) * 100
                            : 0
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">
                  {t("settings.usage.heatmapTitle")}
                </h2>
                <UsageHeatmap byDay={summary.byDay} now={now} />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {t("settings.usage.detailTitle")}
                  </h2>
                  <div
                    role="tablist"
                    aria-label={t("settings.usage.detailTitle")}
                    className="inline-flex rounded-lg border bg-muted p-0.5"
                  >
                    <DetailTabButton
                      id="usage-detail-model-tab"
                      selected={detailTab === "model"}
                      controls="usage-detail-model-panel"
                      onClick={() => setDetailTab("model")}
                    >
                      {t("settings.usage.byModelTitle")}
                    </DetailTabButton>
                    <DetailTabButton
                      id="usage-detail-day-tab"
                      selected={detailTab === "day"}
                      controls="usage-detail-day-panel"
                      onClick={() => setDetailTab("day")}
                    >
                      {t("settings.usage.byDayTitle")}
                    </DetailTabButton>
                  </div>
                </div>
                <div
                  id="usage-detail-model-panel"
                  role="tabpanel"
                  aria-labelledby="usage-detail-model-tab"
                  hidden={detailTab !== "model"}
                  className="overflow-x-auto rounded-lg border"
                >
                  <table
                    className="w-full text-sm"
                    aria-label={t("settings.usage.modelTableLabel")}
                  >
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">
                          {t("settings.usage.provider")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("settings.usage.model")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.input")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.output")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.total")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.recordCount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...summary.byModel]
                        .sort((left, right) => right.total - left.total)
                        .map((row) => (
                          <tr
                            key={`${row.providerId}:${row.model}`}
                            className="border-b last:border-b-0"
                          >
                            <td className="px-3 py-2">{row.providerId}</td>
                            <td className="px-3 py-2">{row.model}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCompactCount(row.input)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCompactCount(row.output)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCompactCount(row.total)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {numberFormat.format(row.records)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div
                  id="usage-detail-day-panel"
                  role="tabpanel"
                  aria-labelledby="usage-detail-day-tab"
                  hidden={detailTab !== "day"}
                  className="overflow-x-auto rounded-lg border"
                >
                  <table
                    className="w-full text-sm"
                    aria-label={t("settings.usage.dayTableLabel")}
                  >
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">
                          {t("settings.usage.date")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.input")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.output")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.total")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("settings.usage.recordCount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayRows.map((row) => (
                        <tr key={row.day} className="border-b last:border-b-0">
                          <td className="px-3 py-2 tabular-nums">{row.day}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCompactCount(row.input)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCompactCount(row.output)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCompactCount(row.total)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {numberFormat.format(row.records)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm font-medium">
                  {t("settings.usage.dangerTitle")}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmClear(true)}
                >
                  {t("settings.usage.clear")}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirmClear}
        title={t("settings.usage.clearConfirmTitle")}
        description={t("settings.usage.clearConfirmBody")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("settings.usage.clear")}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void handleClear()}
      />
    </div>
  )
}

function sourceLabel(
  source: UsageSourceView,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return source === "chat"
    ? t("settings.usage.sourceChat")
    : t("settings.usage.sourceTitle")
}

function SourceCard({
  label,
  total,
  records,
  recordsLabel,
  share,
  shareValue,
}: {
  label: string
  total: string
  records: string
  recordsLabel: string
  share: string
  shareValue: number
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {recordsLabel} {records}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">{total}</div>
          <div className="mt-1 text-xs text-muted-foreground">{share}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, Math.max(0, shareValue))}%` }}
        />
      </div>
    </div>
  )
}

function DetailTabButton({
  id,
  selected,
  controls,
  onClick,
  children,
}: {
  id: string
  selected: boolean
  controls: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
