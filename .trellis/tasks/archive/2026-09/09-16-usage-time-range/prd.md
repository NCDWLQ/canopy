# Usage time range filter

## Goal

Let users inspect source, provider/model, and daily token usage for one coherent selected period without changing the all-time overview. The feature should make recent usage easier to understand while preserving access to full history.

## Confirmed facts

- Target worktree: `/home/jwh/Code/canopy-token-stats`, branch `feat/token-usage-stats`.
- The reviewed baseline already commits the current UsagePanel, tests, and locale changes. Preserve later unrelated worktree edits, but do not treat the earlier UsagePanel changes as uncommitted input.
- The overview currently shows `总 Token / 输入输出 / 今日 Token / 近 7 日 Token`; the Chinese detail headers are localized.
- The annual heatmap is responsive and must not regain horizontal scrolling.
- The current `get_usage_summary` request is empty. Totals/model/source aggregates cover all history; daily data is limited to 371 local-calendar days and the frontend table further limits it to 30 days.
- `records` remains part of the backend and IPC aggregates. It is useful for empty-state detection and diagnostics even when it is not shown in overview cards.
- The user requested `近 7 日 / 近 30 日 / 全部`; the default is `近 30 日`.

## Requirements

- **R1 — Period selector:** Add a labeled, keyboard-accessible single-select period control with last 7 days, last 30 days, and all time. Use the existing shadcn `ToggleGroup`; it is controlled, cannot be cleared by reselecting the active option, and defaults to last 30 days.
- **R2 — One date boundary:** Capture one local `throughDay` for each initial load or explicit refresh and use it for both overview and selected-period requests. Last 7 days is the inclusive interval `[throughDay - 6, throughDay]`; last 30 days is `[throughDay - 29, throughDay]`; future dates are excluded. All time includes every active day through `throughDay`, including records older than 371 days.
- **R3 — Consistent selected-period data:** Apply the selected interval to totals, source aggregates, provider/model aggregates, and daily aggregates with the same SQL predicate. Source percentages use the selected-period total as their denominator.
- **R4 — Stable overview:** Keep the four committed overview cards exactly as total tokens, input/output tokens, today tokens, and last-7-day tokens. These values and the past-year heatmap come from the all-time overview snapshot and do not change when the detail period changes. The heatmap stays responsive without horizontal scrolling.
- **R5 — User-facing call counts:** Remove record count from source cards and replace that row with per-source input/output tokens. Keep the diagnostic count in the model and daily tables, but rename the column from `记录数 / Records` to `调用次数 / Calls`. Keep the wire/domain `records` fields unchanged.
- **R6 — Independent async states:** Maintain an all-time overview snapshot and a separately keyed selected-period snapshot. Never render rows from a previous range under a newly selected range. Keep the selector available for selected-period loading, error, and empty states. Refresh and clear must invalidate stale requests coherently.
- **R7 — Accurate localized copy:** Provide matching Chinese and English labels for the selector, period section, empty/error states, neutral `按日 / By day` tab, source input/output values, and `调用次数 / Calls`. Remove the hard-coded `按日（近 30 天） / By day (last 30 days)` wording.
- **R8 — Compatibility and verification:** An omitted range remains a valid all-time request; clearing remains an empty request; no schema migration or chart dependency is added. Update the shared fixture, Rust/TypeScript contracts, current usage specs, and deterministic regression tests.

## Acceptance criteria

- **AC1 (R1):** The selector exposes exactly three localized options, supports keyboard interaction, always has one selected value, and initially selects last 30 days.
- **AC2 (R2–R3):** Fixed-date repository tests prove both inclusive boundaries and exclusion of the immediately older and future dates for 7- and 30-day ranges. Totals, sources, models, days, and source percentage denominators all describe the same interval.
- **AC3 (R2):** All time returns daily aggregates older than 371 days while excluding dates after `throughDay`.
- **AC4 (R4):** Switching all three ranges leaves the four overview cards and annual heatmap unchanged; the heatmap has no horizontal scroll container.
- **AC5 (R5):** Source cards show total, share, and input/output without a record count. Model/day tables show `调用次数 / Calls` and no user-facing `记录数 / Records` label remains.
- **AC6 (R6):** Overview success remains visible if period loading fails. Period switching immediately hides old rows; empty periods remain switchable; stale rapid-switch/refresh responses cannot overwrite current state. Selecting all time reuses the overview snapshot without a duplicate request.
- **AC7 (R6):** A globally empty overview keeps the current whole-panel empty state. Clearing cancels pending loads and returns to that state; clear failure preserves both last-good snapshots and exposes the existing error treatment.
- **AC8 (R2, R6):** Refresh captures a new local `throughDay` once and uses it for both snapshots. A cross-midnight test proves overview and selected-period values share the new boundary.
- **AC9 (R7–R8):** Both locale dictionaries have identical keys; empty and explicit requests round-trip through the shared IPC fixture; unknown range values and malformed dates are rejected at the Rust boundary and TypeScript schema boundary.
- **AC10 (R8):** Focused tests and the explicit frontend/Rust quality commands in `implement.md` pass.

## Out of scope

- Cache-accounting corrections, cost estimation, new charts, custom date ranges, period-over-period comparisons, persistent selector preferences, pagination, and schema migrations.

## Review status

Revised against the current branch, implemented, independently reviewed, and
verified against AC1–AC10 on 2026-09-22.
