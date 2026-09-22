# Implementation plan

1. After the user approves the revised planning summary, validate task context, activate the task, and dispatch Trellis implementation with the curated research/spec manifests. Do not start from the pre-audit assumptions.
2. Add the optional range/through-day wire contract, Rust validation, service boundary, and one shared repository interval predicate. Preserve `{}` as all time and keep clear empty. Update the shared fixture and database-unavailable command coverage.
3. Replace the fixed 371-day repository window with range-aware totals/source/model/day aggregation. Add fixed-day tests for inclusive 7/30-day bounds, future exclusion, all-time history older than 371 days, both sources, and multiple provider/models.
4. Update TypeScript request schemas/types and `UsageClient.getUsageSummary(options?)`. Add request/response contract tests for omitted and explicit options plus malformed range/date values.
5. Refactor UsagePanel into independent overview and selected-period states. Capture one `throughDay` per load/refresh; implement default selection, all-time reuse, stale-response rejection, period-local loading/error/empty behavior, coherent refresh, and clear invalidation.
6. Update the UI with the controlled single-select `ToggleGroup`, move source cards into the period section, replace their record count with input/output, rename table counts to `调用次数 / Calls`, and make the day tab range-neutral. Preserve the committed four overview cards and responsive no-scroll heatmap.
7. Extend focused UI tests for all ranges, percentages, labels, keyboard selection, source input/output, exact table columns, selected-period empty/error states, rapid switching, refresh/clear races, all-time request reuse, and cross-midnight refresh.
8. Update the backend usage database contract and any affected frontend contract guidance. Re-run task context validation and review the diff for unrelated or overwritten worktree changes.
9. Run focused checks first, then the full quality gate with an explicit test environment:

   ```bash
   NODE_ENV=test pnpm exec vitest run src/lib/tauri/usage-client.test.ts src/features/settings/components/UsagePanel.test.tsx src/features/settings/components/UsageHeatmap.test.tsx
   pnpm format:check
   pnpm lint
   pnpm typecheck
   NODE_ENV=test pnpm test
   pnpm build
   cargo fmt --check --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
   ```

10. Report validation and remaining limitations. Commit only task-related files; do not include unrelated edits.
