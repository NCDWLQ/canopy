# Current usage contract audit

Audited on 2026-09-22 in `/home/jwh/Code/canopy-token-stats` on `feat/token-usage-stats`. This focused note replaces oversized full-spec injection for task implementation and review; always verify the live files before editing.

## Current wire and data flow

- Shared fixture: `contract-fixtures/usage-ipc.json`.
- Rust boundary: `src-tauri/src/usage/commands.rs`; `GetUsageSummaryRequest` and `ClearUsageRecordsRequest` are currently empty structs with `deny_unknown_fields`.
- Rust domain/service/repository: `src-tauri/src/usage/{domain,service,repository}.rs`.
- The current repository returns all-time totals/model/source data. Only `by_day` has a lower bound: 371 local-calendar days using `date(created_at, 'localtime')`; it has no upper bound.
- Usage timestamps are stored as RFC3339 UTC strings. Range filtering and grouping must use one shared local-date interval for totals, model, source, and day queries.
- TypeScript validation/client: `src/lib/tauri/usage-{schemas,client}.ts`; current `getUsageSummary()` sends `{}` and maps snake_case rows to camelCase.
- `UsageSummary` and `UsageSummaryView` contain totals plus `by_day/byDay`, `by_model/byModel`, and `by_source/bySource`. Every aggregate retains `input`, `output`, `total`, and `records`.

## Current UI baseline

- Main component: `src/features/settings/components/UsagePanel.tsx`; tests: `UsagePanel.test.tsx`.
- The committed overview cards are total tokens, input/output, today tokens, and last-7-day tokens. Do not restore generation records as an overview card.
- Source cards currently show total, share, and record count. This task replaces source record count with per-source input/output while retaining `records` in data contracts.
- Model/day tables currently expose record count. This task keeps the diagnostic column but renames it to `调用次数 / Calls`.
- The day tab currently hard-codes the 30-day range. This task makes it `按日 / By day` because the separate selector owns period communication.
- Current state is one `summary`, one panel `status`, and one request-id ref. The range feature requires independent overview and period request/data/error state.
- Heatmap component: `src/features/settings/components/UsageHeatmap.tsx`. It already flexes 53 columns into available width and has a regression assertion that its parent is not `overflow-x-auto`. Preserve that behavior.
- Locales: `src/lib/i18n/locales/{zh-CN,en}.ts`; key parity is type-checked and tested.

## Task-specific invariants

- Three range choices use the existing controlled shadcn `ToggleGroup`; do not create a button-loop control or add a dependency.
- Capture one local `throughDay` per initial load/refresh and use it for both overview and selected-period requests.
- Seven/thirty-day intervals are inclusive at both ends and exclude future dates. All time has no lower bound and is bounded by `throughDay`.
- The same predicate applies to totals, source, model, and day aggregates.
- Range changes never display prior-range rows under the new selection.
- Selecting all time reuses the overview snapshot.
- Overview cards and annual heatmap never change merely because the detail range changes.
- Globally empty data keeps the existing panel empty state; a selected-period-only empty result keeps the selector visible.
- Clear invalidates every pending request and both snapshots.
- No migration, cost estimation, chart library, custom range, period comparison, or persisted selector preference.

## Specs to update after implementation

- The executable token-usage contract currently begins near line 799 of `.trellis/spec/backend/database-guidelines.md`. Update its request, daily-window, aggregation, error, and test clauses after the code is correct.
- Keep frontend runtime decoding and locale rules aligned with `.trellis/spec/frontend/type-safety.md` and `.trellis/spec/frontend/i18n-guidelines.md`.
