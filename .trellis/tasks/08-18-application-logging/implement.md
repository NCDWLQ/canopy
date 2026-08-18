# 应用日志记录功能 — Implementation Plan

## Environment status

- [x] Branch `feat/application-logging` exists from `main`.
- [x] Linked worktree exists at `/home/jwh/Code/canopy-application-logging`.
- [x] Planning task directory exists in both worktrees.
- [x] Reviewed planning artifacts synchronized to the linked worktree.
- [x] User explicitly approved the latest planning summary.

Do not rerun `git worktree add` or copy the task directory during
implementation. After approval and synchronization, run `task.py start` from
the linked worktree and treat that copy as authoritative.

## Ordered Checklist

- [x] A1 Add `tauri-plugin-opener` to `src-tauri/Cargo.toml`; keep frontend dependencies unchanged.
- [x] A2 Create `src-tauri/src/diagnostics/logging.rs` with an inspectable startup-resolved `LoggingPolicy`. Implement defaults (5 MiB/5 files), hard limits (20 MiB/file, 10 files, 100 MiB total), checked arithmetic, whole-override fallback, explicit log file name, UTC append behavior, and build-specific levels. Map total files `1` to `KeepOne` and `n > 1` to `KeepSome(n - 1)`.
- [x] A3 Create `src-tauri/src/diagnostics/config.rs` with strict versioned 4 KiB slot records, `app_config_dir` resolution, dual-slot highest-revision recovery, inactive-slot write/flush/`sync_all`, checked revision, async save serialization, `spawn_blocking`, config/sink status and managed active policy. Test absent/corrupt/oversized/unsupported/torn/concurrent cases.
- [x] A4 Translate `LoggingPolicy` into Canopy-target-filtered builders and attach best effort via `Builder::split(app_handle)` + `attach_logger`, dropping the returned plugin. Do **not** dynamically register a plugin from setup. Implement and test persistent → console-only → no-op fallback and managed sink status; attach failure continues without replacement. Exercise boxed loggers with temporary `Folder` targets for configured/default rotation.
- [x] A5 Create `src-tauri/src/diagnostics/commands.rs` with get/save logging settings and no-input `open_log_directory`; expose strict DTOs, authoritative limit validation, trusted path resolution, safe result/error mapping, save locks and test seams.
- [x] A6 Register diagnostics bootstrap first, opener with JavaScript link interception disabled, and all three custom commands without changing SQL setup. Replace `run()`'s `.expect(...)` with safe error classification followed by fixed-message fatal semantics.
- [x] B1 Move the existing canonical UUIDv4 predicate into a narrowly owned shared `identifiers.rs` module; use it from provider validation and a new `DiagnosticId` wrapper rather than duplicating validation. Add typed lifecycle/command-failure/generation helpers with no level-specific unsafe path. Unit-test severity, single-line formatting, and sensitive/newline sentinel redaction across error/warn/info/debug/trace and file/stdout/stderr formatting.
- [x] B2 Instrument application readiness, representative conversation/provider mutations, command failures, generation terminal paths, and auto-title outcomes at one owning boundary each; omit request content, paths, source errors, and DTO serialization. Pass `DiagnosticId` for generation and for a provider ID generated within the current create operation only; existing-provider and conversation IPC boundaries pass no identifier.
- [x] B3 Migrate the existing `providers/titles.rs` `log::warn!` call to the typed helper and drop its raw `conversation_id` interpolation, so no raw `log::` macro remains outside `diagnostics`.
- [x] C1 Add `diagnostics-schemas.ts` and `diagnostics-client.ts` for open/get/save commands, policy/limits/config-status/sink-status results and strict integer validation. Export `createDiagnosticsClient` plus `DiagnosticsClient`; add bridge contract tests.
- [x] C2 Thread an optional `DiagnosticsClient` through `ConversationWorkspace` and `SettingsDialog` with internal defaults so existing fixtures still construct, and without coupling it to `ProviderClient`.
- [x] C3 Add `DiagnosticsPanel.tsx` and the “诊断” category with active sink/status, accessible `FieldSet`/responsive `Field`/numeric `Input` controls, `FieldError` validation, computed budget, Save/Restore Defaults, restart notice and Open Log Directory; keep it enabled for archived conversations and isolate pending/error states per operation.
- [x] C4 Add UI tests for navigation, load/save/reset, range/combined-budget validation, restart behavior, sink fallback display, independent pending deduplication, failure isolation, retry and accessibility.
- [x] D1 Run targeted Rust/frontend tests, then full repository quality gates and a debug no-bundle Tauri smoke build. Confirm the smoke build actually reaches a running window, since a bootstrap ordering mistake manifests as a hang rather than an error.
- [x] D2 Audit logging/opener permissions and generated output for sensitive fields, unbounded targets, duplicate failure events, raw `log::` macros outside `diagnostics`, and accidental console logging. Add a static test asserting `capabilities/default.json` contains no `opener:*` or `log:*` permission without freezing unrelated capabilities.
- [x] D3 Update specs to match the implemented state: backend `logging-guidelines.md` and `directory-structure.md`; frontend `directory-structure.md`, `type-safety.md`, and `component-guidelines.md` for diagnostics config IPC, settings controls, fallback status, and validation.

## Validation Commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm tauri build --debug --no-bundle
rg -n "println!|eprintln!|dbg!|console\." src src-tauri/src
rg -n "api_key|authorization|prompt|content|response_body|database_url|app_log_dir" src-tauri/src/diagnostics src-tauri/src/lib.rs
rg -n "opener:allow|log:allow|log:default" src-tauri/capabilities src-tauri/tauri.conf.json
rg -n "log::(trace|debug|info|warn|error)!" src-tauri/src --glob '!src-tauri/src/diagnostics/**'
rg -n "handle\(\)\.plugin|app_handle\(\)\.plugin" src-tauri/src
rg -n "logging-policy-(a|b)\.json|max_file_mib|max_files" src-tauri/src src/lib/tauri src/features/settings
```

Two of these greps are new regression gates. The raw-macro search must return nothing, proving all product logging goes through the diagnostics helpers. The `.plugin(` search must not match anything inside a plugin setup hook, because dynamic plugin registration there deadlocks silently instead of erroring.

For the redaction gate, run the targeted sentinel tests and inspect a temporary log file generated by the controlled logger test. The test must fail if any credential/content/path/provider-body sentinel is present, and the newline sentinel must not increase the line count of the emitted output.

## Risky Files and Rollback Points

| Area | Risk | Rollback point |
|---|---|---|
| `src-tauri/src/lib.rs` | Plugin ordering affects SQL preload coverage and logger initialization. Registering a plugin from inside a setup hook hangs `build()` with no error, so a mistake here looks like a frozen app rather than a failure | Keep diagnostics bootstrap isolated and use `split` + `attach_logger`; restore prior builder chain if the startup smoke build fails to open a window |
| Target filter predicate | A prefix that does not match the real `canopy_lib` target silently discards every event while all tests still pass | Predicate is a pinned constant with its own unit test; widen or remove the filter independently of the sink |
| `src-tauri/src/error.rs` and command modules | Central logging can duplicate errors or accidentally serialize unsafe fields | Use one helper and static inputs plus validated `DiagnosticId`; remove instrumentation independently of logger sink |
| `src-tauri/src/providers/titles.rs` | Migrating the existing warn line changes the only pre-existing log call site | Single-line change; revert independently of the rest of the task |
| `src-tauri/Cargo.toml` / lockfile | New opener dependency changes native build graph | Remove opener registration/dependency; custom command can be removed without data migration |
| `SettingsDialog` / workspace props | New client/category can break many test fixtures | Keep optional injection defaults and update narrow fixtures first |
| Global logger tests | Process-global registration can make parallel tests flaky | Test pure config/formatters; isolate at most one real registration test |
| `app_config_dir` logging policy slots | Interrupted or concurrent writes can lose user settings | Serialize saves and write only the inactive slot; preserve the last valid revision |

## Review Gates Before `task.py start`

- [x] PRD, design, and this implementation plan contain no blocking open question.
- [x] User explicitly approves the latest planning summary in a subsequent message.
- [x] `implement.jsonl` and `check.jsonl` contain real spec/research entries.
- [x] Implementation agent is instructed not to broaden scope into a viewer, export bundle, remote telemetry, panic dump, or user-configurable log levels/retention dimensions beyond the two approved numeric limits.

## Final Checks Before Handoff

- Confirm release registration is unconditional while frontend/webview logging remains disabled, and that the plugin's `log` IPC command is never registered because the returned plugin is dropped.
- Confirm logger failure is non-fatal and SQL/startup failures are logged only when the logger is available.
- Confirm the diagnostics bootstrap is the first registered plugin and that no setup hook registers a plugin dynamically.
- Confirm defaults are 5 MiB/5 files, custom values obey 20 MiB/10 files/100 MiB combined, and the active policy changes only after restart.
- Confirm config corruption/write interruption preserves the last valid slot or falls back to defaults without blocking startup.
- Confirm every dynamic value in a log line is a static string, a number/bool, a validated UUID, or a shape-checked plugin name, so no log line can be forged.
- Confirm no local path crosses IPC and no generic opener capability is granted.
- Confirm all new user-facing copy is Simplified Chinese and all IPC shapes are strict.
- Confirm specs describe actual implemented behavior rather than the pre-task debug-only state.
