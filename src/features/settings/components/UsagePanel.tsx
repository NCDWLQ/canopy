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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import {
  createUsageClient,
  type UsageClient,
  type UsageRange,
  type UsageSourceView,
  type UsageSummaryView,
} from "@/lib/tauri"
import type { UiError } from "@/lib/tauri/types"

import { UsageHeatmap } from "./UsageHeatmap"
import { localIsoDate } from "./usageHeatmap"

export type UsagePanelProps = { client?: UsageClient; now?: Date }
type SnapshotStatus = "loading" | "ready" | "empty" | "error"
type DetailTab = "model" | "day"
const DEFAULT_RANGE: UsageRange = "last_30_days"
const RANGE_OPTIONS: readonly UsageRange[] = [
  "last_7_days",
  "last_30_days",
  "all",
]

function addLocalDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
function sumTotalsBetween(
  byDay: UsageSummaryView["byDay"],
  start: string,
  end: string,
) {
  return byDay
    .filter((row) => row.day >= start && row.day <= end)
    .reduce((sum, row) => sum + row.total, 0)
}
function formatCompactCount(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`
  if (abs >= 1000) return `${trimTrailingZero(value / 1000)}k`
  return String(value)
}
function trimTrailingZero(value: number) {
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
function emptySummary(): UsageSummaryView {
  return {
    totals: { input: 0, output: 0, total: 0, records: 0 },
    byDay: [],
    byModel: [],
    bySource: [],
  }
}

export function UsagePanel({ client, now: nowProp }: UsagePanelProps) {
  const { t, locale } = useTranslation()
  const usageClient = React.useMemo(
    () => client ?? createUsageClient(),
    [client],
  )
  const [overview, setOverview] = React.useState<UsageSummaryView | null>(null)
  const [overviewStatus, setOverviewStatus] =
    React.useState<SnapshotStatus>("loading")
  const [overviewError, setOverviewError] = React.useState<UiError | null>(null)
  const [period, setPeriod] = React.useState<UsageSummaryView | null>(null)
  const [periodStatus, setPeriodStatus] =
    React.useState<SnapshotStatus>("loading")
  const [periodError, setPeriodError] = React.useState<UiError | null>(null)
  const [range, setRange] = React.useState<UsageRange>(DEFAULT_RANGE)
  const [refreshing, setRefreshing] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)
  const [clearError, setClearError] = React.useState<UiError | null>(null)
  const [detailTab, setDetailTab] = React.useState<DetailTab>("model")
  const [now, setNow] = React.useState(() => nowProp ?? new Date())
  const overviewRef = React.useRef<UsageSummaryView | null>(null)
  const overviewRequestRef = React.useRef(0)
  const periodRequestRef = React.useRef(0)
  const rangeRef = React.useRef<UsageRange>(DEFAULT_RANGE)
  const throughDayRef = React.useRef(localIsoDate(nowProp ?? new Date()))
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

  const loadPeriod = React.useCallback(
    (nextRange: UsageRange, throughDay: string) => {
      const requestId = ++periodRequestRef.current
      if (nextRange === "all") {
        setPeriod(null)
        setPeriodError(null)
        return
      }
      setPeriod(null)
      setPeriodError(null)
      setPeriodStatus("loading")
      void usageClient
        .getUsageSummary({ range: nextRange, through_day: throughDay })
        .then(
          (next) => {
            if (
              periodRequestRef.current !== requestId ||
              rangeRef.current !== nextRange ||
              throughDayRef.current !== throughDay
            )
              return
            setPeriod(next)
            setPeriodStatus(next.totals.records === 0 ? "empty" : "ready")
          },
          (caught: unknown) => {
            if (
              periodRequestRef.current !== requestId ||
              rangeRef.current !== nextRange ||
              throughDayRef.current !== throughDay
            )
              return
            setPeriodError(isUiError(caught) ? caught : null)
            setPeriodStatus("error")
          },
        )
    },
    [usageClient],
  )

  const loadOverview = React.useCallback(
    (throughDay: string, refresh: boolean, displayNow: Date) => {
      const requestId = ++overviewRequestRef.current
      if (!refresh) setOverviewStatus("loading")
      setOverviewError(null)
      void usageClient
        .getUsageSummary({ range: "all", through_day: throughDay })
        .then(
          (next) => {
            if (
              overviewRequestRef.current !== requestId ||
              throughDayRef.current !== throughDay
            )
              return
            overviewRef.current = next
            setNow(displayNow)
            setOverview(next)
            setOverviewStatus(next.totals.records === 0 ? "empty" : "ready")
            setRefreshing(false)
          },
          (caught: unknown) => {
            if (
              overviewRequestRef.current !== requestId ||
              throughDayRef.current !== throughDay
            )
              return
            setOverviewError(isUiError(caught) ? caught : null)
            if (overviewRef.current === null) setOverviewStatus("error")
            setRefreshing(false)
          },
        )
    },
    [usageClient],
  )

  React.useEffect(() => {
    const capturedNow = nowProp ?? new Date()
    const throughDay = localIsoDate(capturedNow)
    throughDayRef.current = throughDay
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      loadOverview(throughDay, false, capturedNow)
      loadPeriod(rangeRef.current, throughDay)
    })
    return () => {
      active = false
      overviewRequestRef.current += 1
      periodRequestRef.current += 1
    }
  }, [loadOverview, loadPeriod, nowProp])

  const selectRange = (nextRange: string) => {
    if (
      !RANGE_OPTIONS.includes(nextRange as UsageRange) ||
      nextRange === rangeRef.current
    )
      return
    const selected = nextRange as UsageRange
    rangeRef.current = selected
    setRange(selected)
    loadPeriod(selected, throughDayRef.current)
  }
  const handleRefresh = () => {
    const capturedNow = nowProp ?? new Date()
    const throughDay = localIsoDate(capturedNow)
    throughDayRef.current = throughDay
    setRefreshing(true)
    loadOverview(throughDay, true, capturedNow)
    loadPeriod(rangeRef.current, throughDay)
  }
  const handleClear = async () => {
    setConfirmClear(false)
    ++overviewRequestRef.current
    ++periodRequestRef.current
    setRefreshing(false)
    setClearing(true)
    setClearError(null)
    try {
      await usageClient.clearUsageRecords()
      const empty = emptySummary()
      overviewRef.current = empty
      setOverview(empty)
      setOverviewStatus("empty")
      setOverviewError(null)
      setPeriod(null)
      setPeriodStatus("empty")
      setPeriodError(null)
    } catch (caught: unknown) {
      setClearError(isUiError(caught) ? caught : null)
    } finally {
      setClearing(false)
    }
  }

  const today = localIsoDate(now)
  const last7Start = localIsoDate(addLocalDays(now, -6))
  const todayTotal = overview
    ? sumTotalsBetween(overview.byDay, today, today)
    : 0
  const last7Total = overview
    ? sumTotalsBetween(overview.byDay, last7Start, today)
    : 0
  const detail = range === "all" ? overview : period
  const detailStatus = range === "all" ? overviewStatus : periodStatus
  const detailError = range === "all" ? overviewError : periodError
  const busy = overviewStatus === "loading" || refreshing || clearing

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
          {refreshing || overviewStatus === "loading" ? (
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
          {clearError !== null && (
            <UsageErrorAlert
              title={t("settings.usage.clearFailed")}
              error={clearError}
            />
          )}
          {overviewError !== null && (
            <UsageErrorAlert
              title={t("settings.usage.loadFailed")}
              error={overviewError}
            />
          )}
          {overviewStatus === "loading" && overview === null && (
            <Loading label={t("settings.usage.loading")} />
          )}
          {overviewStatus === "error" &&
            overview === null &&
            overviewError === null && (
              <UsageErrorAlert title={t("settings.usage.loadFailed")} />
            )}
          {overviewStatus === "empty" && <UsageEmpty />}
          {overview !== null && overviewStatus !== "empty" && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryCard
                  label={t("settings.usage.totalTokens")}
                  value={numberFormat.format(overview.totals.total)}
                />
                <SummaryCard
                  label={t("settings.usage.inputOutput")}
                  value={`${numberFormat.format(overview.totals.input)} / ${numberFormat.format(overview.totals.output)}`}
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
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">
                  {t("settings.usage.heatmapTitle")}
                </h2>
                <UsageHeatmap byDay={overview.byDay} now={now} />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {t("settings.usage.detailTitle")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <span
                      id="usage-period-label"
                      className="text-xs text-muted-foreground"
                    >
                      {t("settings.usage.period")}
                    </span>
                    <ToggleGroup
                      type="single"
                      value={range}
                      disabled={clearing}
                      variant="outline"
                      size="sm"
                      spacing={0}
                      aria-labelledby="usage-period-label"
                      onValueChange={selectRange}
                    >
                      <ToggleGroupItem
                        value="last_7_days"
                        aria-label={t("settings.usage.periodLast7Days")}
                      >
                        {t("settings.usage.periodLast7Days")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="last_30_days"
                        aria-label={t("settings.usage.periodLast30Days")}
                      >
                        {t("settings.usage.periodLast30Days")}
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="all"
                        aria-label={t("settings.usage.periodAll")}
                      >
                        {t("settings.usage.periodAll")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>
                {detailStatus === "loading" && (
                  <Loading label={t("settings.usage.periodLoading")} />
                )}
                {detailStatus === "error" && (
                  <UsageErrorAlert
                    title={t("settings.usage.periodLoadFailed")}
                    error={detailError}
                  />
                )}
                {detailStatus === "empty" && (
                  <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {t("settings.usage.periodEmptyTitle")}
                    </p>
                    <p>{t("settings.usage.periodEmptyDescription")}</p>
                  </div>
                )}
                {detail !== null && detailStatus === "ready" && (
                  <UsageDetails
                    detail={detail}
                    detailTab={detailTab}
                    setDetailTab={setDetailTab}
                    numberFormat={numberFormat}
                    percentageFormat={percentageFormat}
                    t={t}
                  />
                )}
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

function UsageDetails({
  detail,
  detailTab,
  setDetailTab,
  numberFormat,
  percentageFormat,
  t,
}: {
  detail: UsageSummaryView
  detailTab: DetailTab
  setDetailTab: (tab: DetailTab) => void
  numberFormat: Intl.NumberFormat
  percentageFormat: Intl.NumberFormat
  t: ReturnType<typeof useTranslation>["t"]
}) {
  const sourceRows = [...detail.bySource].sort(
    (left, right) => right.total - left.total,
  )
  return (
    <>
      {sourceRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {t("settings.usage.bySourceTitle")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {sourceRows.map((row) => (
              <SourceCard
                key={row.source}
                label={sourceLabel(row.source, t)}
                total={formatCompactCount(row.total)}
                inputOutput={`${numberFormat.format(row.input)} / ${numberFormat.format(row.output)}`}
                inputOutputLabel={t("settings.usage.inputOutput")}
                share={percentageFormat.format(
                  detail.totals.total > 0 ? row.total / detail.totals.total : 0,
                )}
                shareValue={
                  detail.totals.total > 0
                    ? (row.total / detail.totals.total) * 100
                    : 0
                }
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div
          role="tablist"
          aria-label={t("settings.usage.detailTitle")}
          className="inline-flex w-fit rounded-lg border bg-muted p-0.5"
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
        <UsageTable
          id="usage-detail-model-panel"
          labelledBy="usage-detail-model-tab"
          hidden={detailTab !== "model"}
          label={t("settings.usage.modelTableLabel")}
          headers={[
            t("settings.usage.provider"),
            t("settings.usage.model"),
            t("settings.usage.input"),
            t("settings.usage.output"),
            t("settings.usage.total"),
            t("settings.usage.callCount"),
          ]}
          rows={[...detail.byModel]
            .sort((left, right) => right.total - left.total)
            .map((row) => [
              row.providerId,
              row.model,
              formatCompactCount(row.input),
              formatCompactCount(row.output),
              formatCompactCount(row.total),
              numberFormat.format(row.records),
            ])}
        />
        <UsageTable
          id="usage-detail-day-panel"
          labelledBy="usage-detail-day-tab"
          hidden={detailTab !== "day"}
          label={t("settings.usage.dayTableLabel")}
          headers={[
            t("settings.usage.date"),
            t("settings.usage.input"),
            t("settings.usage.output"),
            t("settings.usage.total"),
            t("settings.usage.callCount"),
          ]}
          rows={[...detail.byDay]
            .sort((left, right) => right.day.localeCompare(left.day))
            .map((row) => [
              row.day,
              formatCompactCount(row.input),
              formatCompactCount(row.output),
              formatCompactCount(row.total),
              numberFormat.format(row.records),
            ])}
        />
      </div>
    </>
  )
}
function UsageTable({
  id,
  labelledBy,
  hidden,
  label,
  headers,
  rows,
}: {
  id: string
  labelledBy: string
  hidden: boolean
  label: string
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      className="overflow-x-auto rounded-lg border"
    >
      <table className="w-full text-sm" aria-label={label}>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {headers.map((header, index) => (
              <th
                key={header}
                className={`px-3 py-2 font-medium ${index > 1 ? "text-right" : ""}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.slice(0, 2).join(":")}
              className="border-b last:border-b-0"
            >
              {row.map((value, index) => (
                <td
                  key={`${index}:${value}`}
                  className={`px-3 py-2 ${index > 1 ? "text-right tabular-nums" : ""}`}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function UsageEmpty() {
  const { t } = useTranslation()
  return (
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
  )
}
function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-4" aria-label={label} />
      <span>{label}</span>
    </div>
  )
}
function UsageErrorAlert({
  title,
  error,
}: {
  title: string
  error?: UiError | null
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      {error !== null && error !== undefined && (
        <AlertDescription>{commandErrorMessage(error.code)}</AlertDescription>
      )}
    </Alert>
  )
}
function sourceLabel(
  source: UsageSourceView,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return source === "chat"
    ? t("settings.usage.sourceChat")
    : t("settings.usage.sourceTitle")
}
function SourceCard({
  label,
  total,
  inputOutput,
  inputOutputLabel,
  share,
  shareValue,
}: {
  label: string
  total: string
  inputOutput: string
  inputOutputLabel: string
  share: string
  shareValue: number
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {inputOutputLabel} {inputOutput}
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
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
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
