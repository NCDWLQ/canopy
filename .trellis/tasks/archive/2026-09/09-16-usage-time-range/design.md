# Design

## Wire contract and compatibility

Extend the existing request without changing the response shape:

```text
UsageRange = last_7_days | last_30_days | all

GetUsageSummaryRequest {
  range?: UsageRange,
  through_day?: YYYY-MM-DD
}
```

- `{}` remains valid and resolves to all time through the command's current local day.
- UsagePanel always captures one local `throughDay` and sends it to both requests in an initial load or refresh. This prevents the overview and period request from using opposite sides of midnight.
- Rust validates the enum and strict calendar date at the command boundary. The TypeScript client validates the request before invoke and keeps `getUsageSummary()` with no arguments source-compatible.
- `clear_usage_records({})` and `UsageSummary` remain wire-compatible. The aggregate `records` fields stay in the response.

## Backend aggregation

Resolve one inclusive local-calendar interval before querying:

```text
last_7_days:  start = through_day - 6 days,  end = through_day
last_30_days: start = through_day - 29 days, end = through_day
all:          no lower bound,               end = through_day
```

Pass the resolved boundary through command → service → repository. Apply the identical predicate to totals, by-model, by-source, and by-day queries. Continue grouping stored RFC3339 UTC timestamps with SQLite `date(created_at, 'localtime')`; add an upper bound so future dates are excluded.

All-time `by_day` no longer applies `USAGE_SUMMARY_DAY_WINDOW`. The annual heatmap already selects its own 371 aligned cells from the returned daily rows, so older rows do not alter its visual window. No schema migration is required.

Repository tests call the range-aware API with an explicit fixed `through_day`. They cover the exact lower boundary, one day before it, the upper boundary, one future day, both sources, multiple provider/models, and an older-than-371-day record.

## Frontend state and requests

UsagePanel owns two independent snapshots:

- **Overview:** all-time `UsageSummaryView`, its request state, last-good data, error, and `throughDay`.
- **Period:** selected range, matching `throughDay`, request state, last-good data, error, and request identity.

Initial load captures one day and loads overview plus the default 30-day period concurrently. Selecting a new range invalidates the prior period request, hides its rows immediately, and loads the new range. Selecting `all` reuses the overview snapshot and does not invoke a duplicate all-time request.

Refresh captures a new day once, invalidates both request identities, and refreshes overview plus the selected range (unless `all`, which reuses refreshed overview). Last-good overview remains visible with the existing refresh error treatment. Period rows are hidden while their request is loading and remain hidden on failure, while the selector and a period-local error stay visible.

If overview is globally empty, keep the current whole-panel empty state. If overview has data but the selected period is empty, render a period-local empty state beneath the still-operable selector. Clear success invalidates every load and clears both snapshots; clear failure preserves both snapshots and uses the existing alert treatment.

Every async completion must match request identity, selected range, and `throughDay` before publication.

## UI composition

Render in this order:

1. The committed four-card overview: total tokens, input/output, today tokens, last-7-day tokens.
2. The existing responsive annual heatmap, unchanged and without horizontal scrolling.
3. A clearly labeled period-details section.
4. A controlled single-select shadcn `ToggleGroup` for 7 days, 30 days, and all. Ignore an empty `onValueChange` so one option remains selected.
5. Selected-period source cards followed by the existing model/day tabs.

Source cards show source name, total tokens, selected-period share, and per-source input/output. They no longer show record count. Model and day tables retain the count as a diagnostic column renamed to `调用次数 / Calls`; their other columns stay unchanged. Rename the day tab to the range-neutral `按日 / By day`, because the selector already communicates the period.

Use current shadcn primitives and semantic tokens. Do not add a chart library, duplicate button group, new visual language, or horizontal scrolling to the heatmap.

## Locale and test contract

Update both typed dictionaries in the same change. UI tests assert accessible names, selected states, current-range rows, absence of old-range rows, period-local empty/error states, source input/output, `Calls`, and the no-scroll heatmap regression.

Update the shared IPC fixture with empty and explicit range requests. Rust and frontend contract tests cover valid values plus invalid range/date rejection. Update the usage scenario in the database spec after implementation so the executable contract describes range and boundary behavior.

## Trade-offs and rollback

- Returning every active day for all time can grow with years of history, but remains one aggregate row per active day. Pagination is deferred until measured need.
- The optional `through_day` makes dual requests deterministic and coherent while preserving `{}` compatibility.
- Roll back only this task's contract, repository, client, panel, tests, locale, and spec changes. Preserve committed token-usage work, persisted usage records, and unrelated worktree edits.
