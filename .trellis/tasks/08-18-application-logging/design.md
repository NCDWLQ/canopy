# 应用日志记录功能 — Technical Design

## Architecture

```text
Tauri startup
  -> diagnostics bootstrap plugin (registered first)
       -> tauri_plugin_log::Builder::split(app_handle)   [best effort]
            -> LogDir target (debug + release)
            -> Stdout target (debug only)
       -> attach_logger(max_level, logger)               [best effort]
       -> drop the returned TauriPlugin (no webview log command)
  -> SQL plugin preload/migrations
  -> application setup and command registration

Rust domain/command boundaries
  -> typed diagnostic event helper
  -> log facade
  -> bounded files in app_log_dir

SettingsDialog -> DiagnosticsPanel -> DiagnosticsClient
  -> get_logging_settings() / save_logging_settings()
  -> versioned two-slot config in app_config_dir
  -> open_log_directory() Tauri command (no request path)
  -> app.path().app_log_dir()
  -> create_dir_all
  -> tauri-plugin-opener Rust API
  -> system file manager
```

Rust remains the only durable diagnostic producer. The renderer displays the user action and normalized failure state but does not forward browser console messages or source errors into the application log.

## Backend Boundaries

### `src-tauri/src/diagnostics/`

Add a product-owned module rather than growing `lib.rs`:

- `mod.rs`: public module surface.
- `logging.rs`: constants, target filters, level selection, safe formatter, event severity mapping, and the best-effort bootstrap plugin.
- `config.rs`: strict stored schema, hard-limit validation, two-slot recovery, active-policy state and bounded file I/O.
- `commands.rs`: get/save settings and `open_log_directory` commands plus DTOs.

### Logging bootstrap mechanism

The bootstrap is a Canopy-owned `tauri::plugin::Builder` plugin registered **before** `tauri-plugin-sql`, because `PluginStore` initializes plugins in registration order and the SQL plugin performs preload/migration inside its own setup hook.

Inside that setup hook, do **not** call `app.handle().plugin(...)`. `AppManager::initialize_plugins` holds the `std::sync::Mutex<PluginStore>` across every plugin setup hook, and `AppHandle::plugin_boxed` locks the same non-reentrant mutex, so dynamic installation from a setup hook self-deadlocks and `Builder::build()` hangs with no diagnostic output. (The pre-task debug-only registration avoids this only because `Builder::setup` runs after that lock is released — which is exactly why it cannot observe SQL startup.)

Instead the hook attaches the logger directly:

```rust
// inside the bootstrap plugin's setup hook; note there is no `?` on the
// logging steps — the hook must return Ok(()) even when logging is degraded.
if let Ok((_plugin, max_level, logger)) = canopy_log_builder().split(app_handle) {
    let _ = attach(max_level, logger);
}
Ok(())
```

Both fallible steps are swallowed at this single boundary so logging failure cannot abort startup. The returned `TauriPlugin` is deliberately dropped: it only carries the plugin's webview-facing `log` command, which Canopy does not want, so dropping it means that IPC command is never registered at all rather than merely being denied by capability.

Extract a small Canopy-owned `LoggingPolicy` value as the inspectable source of truth for level, targets, file name, rotation size, retained file count and timezone. A startup-only parser resolves the configured rotation/retention values, validates numeric parsing/overflow and enforces compiled hard safety ceilings; missing or invalid configuration returns the complete default policy rather than partially mixing defaults and invalid input. `canopy_log_builder(policy)` translates that policy into the plugin's opaque `Builder`; tests assert the policy directly, then exercise the resulting boxed logger against a temporary `Folder` target for formatting/rotation behavior. Merely returning `Builder` is not a sufficient test seam because the crate keeps its configuration fields private.

The policy contract is fixed:

- default: 5 MiB per active file, 5 total files;
- user range: 1–20 MiB per file and 1–10 total files, with checked `file_mib * total_files <= 100 MiB`;
- total files includes the active file, so `1` maps to `KeepOne` and `n > 1` maps to `KeepSome(n - 1)`; never construct `KeepSome(0)`;
- startup records with zero, overflowed, individually over-limit, or total-budget-over-limit values reject the whole stored override and select defaults; the save command instead returns `invalid_input` and preserves the last confirmed record;
- config values and config paths are never logged; a successfully attached logger may emit only `operation=initialize_logging code=config_fallback reason=invalid` with static fields;
- changes take effect only at the next process start.

### Early configuration store

The logger must be configured before SQL plugin preload, so do not use `app_settings`. Store logging policy under `app.path().app_config_dir()` in two small versioned slots, for example `logging-policy-a.json` and `logging-policy-b.json`:

```json
{
  "version": 1,
  "revision": 7,
  "max_file_mib": 5,
  "max_files": 5
}
```

The Rust stored type uses `deny_unknown_fields`, integer fields, an exact supported version and a maximum input size (4 KiB per slot). Reading loads both slots, rejects oversized/invalid/unsupported records, validates hard limits with checked arithmetic, and selects the valid record with the highest revision; a deterministic slot wins a valid tie. No slots means defaults. One invalid slot plus one valid slot recovers the valid record. Two invalid slots use defaults and mark the config status as `invalid_fallback`.

Saving never overwrites the currently authoritative slot. Under a single async save lock, choose the missing/older slot, compute `revision + 1` with checked arithmetic, truncate/write the new JSON record, flush and `sync_all`, then treat it as authoritative. A crash or write error can corrupt only the inactive slot, leaving the previous valid record. File operations run via `spawn_blocking`. Failure returns a safe existing `CommandError` without a path; the UI retains its previous confirmed state.

The bootstrap resolves the stored policy before constructing the logger and manages an immutable `ActiveLoggingState` containing the active policy and resulting managed sink status (`persistent`, `console_fallback`, or `disabled`). Settings commands read the newest config status (`default`, `custom`, `recovered`, or `invalid_fallback`) from the two slots and compare the configured policy with the active policy to derive `restart_required`; saving never hot-swaps the process-global logger.

The installer accepts builder/factory and `attach` test seams. Production first attempts the file policy (plus debug stdout); if `split` fails while creating the persistent sink, it attempts a console-only builder that still applies Canopy target filtering and the same safe event contract. Debug fallback uses stdout at the debug build level; release fallback uses stderr at `Warn` because a release process may still be launched from a terminal even though it cannot depend on one. If fallback `split` also fails, it leaves the facade unconfigured. If `attach_logger` fails, do not attempt to replace the already-registered global logger; continue startup. Every branch returns `Ok(())` from the bootstrap setup hook.

This fallback is initialization-only. After a logger is attached, the `log::Log` interface does not expose per-write failure back to Canopy, so runtime rotation/write errors cannot safely hot-swap the global logger. There is no SQLite, browser-storage, secondary file, or unbounded-memory fallback.

After a successful attach it emits a safe readiness event.

Configuration:

| Concern | Debug | Release |
|---|---|---|
| Minimum Canopy level | `Debug` | `Info` |
| File target | yes | yes |
| Stdout target | yes | no |
| File size | configured, default 5 MiB | configured, default 5 MiB |
| Retention | configured, default 5 total files | configured, default 5 total files |
| File open | append | append |
| Timezone | UTC | UTC |
| Log file name | explicit constant | explicit constant |

Set an explicit `LogDir { file_name }` rather than relying on the package-name default: rotation pruning matches archives by that file-name prefix, so pinning it keeps the retention budget independent of `productName`.

Restrict persisted output to Canopy-owned Rust targets with the same predicate applied both globally (`Builder::filter`) and per target (`Target::filter`). The global filter drops dependency records once instead of re-evaluating them per target, which matters because the debug build raises the global max level to `Debug`.

The predicate must match the real target prefix. `Cargo.toml` declares `[lib] name = "canopy_lib"`, so library records carry targets starting with `canopy_lib::` while the binary is `canopy`; a predicate written against `canopy::` would silently discard every Canopy event with no error. Pin the accepted prefixes in a constant and cover them with a unit test that asserts a `canopy_lib::` target is accepted and a representative dependency target (for example `sqlx::query`) is rejected.

Do not enable the webview target or install `@tauri-apps/plugin-log`; frontend calls must not become durable logs implicitly.

### Level-independent confidentiality

Severity is routing metadata, not a confidentiality boundary. `debug` and `trace` use the same typed event helpers, identifier wrappers, one-line formatter and forbidden-field list as `info`/`warn`/`error`. There is no development-only escape hatch for raw DTOs, secrets, prompts, content, paths, provider bodies, error `Debug`, or source chains. Enabling a more verbose level may expose more safe lifecycle/control-flow events, never richer payloads. The rule applies equally to persistent, stdout and stderr targets.

### Diagnostic event contract

Use explicit helpers whose inputs cannot carry arbitrary product content:

```rust
record_command_failure(operation: &'static str, error: &CommandError, correlation: Option<DiagnosticId>);
record_lifecycle(operation: &'static str, code: &'static str);
record_generation(operation: &'static str, code: &'static str, generation_id: DiagnosticId, duration_ms: Option<u64>);
```

`record_command_failure` classifies by `CommandErrorCode`:

- no event by default: `invalid_input`, `not_found`, `cancelled`;
- `warn`: `database_unavailable`, `provider_authentication`, `rate_limited`, `provider_unavailable`, `network_failure`;
- `error`: `tree_integrity`, `migration_failure`, `internal`.

It formats only the stable code, the retryability flag, and an optional correlation identifier; it never formats `message`, `details`, the source error, or a request object.

### Identifier policy

`DiagnosticId` is the only way an identifier reaches a log line. It is a wrapper constructed through the existing canonical UUIDv4 check in `src-tauri/src/providers/commands.rs` (`is_canonical_uuid_v4`); do not write a second validator. Move the check into a narrowly owned shared `identifiers.rs` module so provider input validation and diagnostics use one implementation without making the provider domain depend on diagnostics.

Consequences per boundary:

- Generation paths may pass a `DiagnosticId`, because `generation_id` is produced by Rust with `Uuid::new_v4()` and retained at the owning boundary.
- Provider paths may pass a `DiagnosticId` only when that exact command has just generated the ID for a new provider. Edit/delete/activate/reveal requests receive `provider_id` from IPC and only apply the non-blank `validate_id`, so they pass `None` even if the stored value usually originated in Rust.
- Conversation command boundaries pass `None`. Their `conversation_id`/`node_id` go through `validate_id`, which only rejects blank strings, so those values are arbitrary frontend input and must not be logged. Since file output is newline-delimited, an unvalidated value containing `\n` would forge an additional log line.
- No dynamic value may carry newlines, carriage returns, or other control characters. Because `DiagnosticId` is UUID-validated, this holds by construction for these three helpers, and they must not gain any other dynamic string parameter. The startup-failure plugin name below is the only additional dynamic string in the whole event surface, and it carries its own restriction.

This tightens the identifier example currently in `.trellis/spec/backend/logging-guidelines.md`, which shows a raw `conversation_id` interpolation. `src-tauri/src/providers/titles.rs` contains exactly that pattern today and must be migrated to `record_lifecycle` without the identifier as part of this task; after the change no raw `log::` macro remains outside `diagnostics`.

Instrument the outermost useful boundary once. Conversation command wrappers and provider command bodies should route failures through the helper; lower repositories and adapters preserve typed errors without logging. Generation terminal outcomes and auto-title's silent fallback record their lifecycle at their owning orchestration boundary.

### Startup failures

The diagnostics bootstrap precedes SQL plugin setup, so a preload/migration failure happens while the logger is already attached. `run()` currently ends in `.expect(...)`, which panics before anything is recorded; restructure it to inspect the error, record one event, then preserve the existing fatal startup semantics.

Never format the Tauri error itself — its message may contain local paths. Match the variant instead:

- `tauri::Error::PluginInitialization(plugin, _message)` -> `operation=run_application code=plugin_initialization plugin=<plugin>`. The plugin name is a crate-owned static identifier, so `sql` failures become identifiable in the log while the message stays out. This is what makes the database preload/migration case diagnosable.
- any other variant -> `operation=run_application code=startup_failed` with no further detail.

The `plugin` field is the only non-static string in the event surface. It originates from the registered plugin's own `name()` rather than from IPC, but log it through the same one-line guarantee as everything else: accept it only if it matches a conservative identifier shape (ASCII alphanumeric plus `-`/`_`) and substitute a fixed `unknown` otherwise. That keeps the "no forged log line" invariant a property of the formatter rather than of an upstream crate's naming discipline.

After recording, preserve fatal startup behavior with a fixed panic/termination message that does not interpolate the Tauri error. If the diagnostics bootstrap itself is what failed, no event can be produced. That limitation is accepted and recorded in the PRD.

### Open-directory command

Register `tauri-plugin-opener` with automatic JavaScript link interception disabled. Expose only the custom command:

```text
open_log_directory({}) -> { opened: true }
```

The command resolves `app.path().app_log_dir()`, ensures the directory exists, then calls `app.opener().open_path(...)`. It accepts no path, does not return the path, and maps create/open failures to the existing safe `internal` command contract plus a contextual UI message. The capability file remains without `opener:allow-open-path`, so the webview cannot call the plugin's generic path command.

### Settings commands

Expose two additional typed commands:

```text
get_logging_settings({}) -> {
  configured, active, limits, config_status, sink_status, restart_required
}

save_logging_settings({ max_file_mib, max_files }) -> same result shape
```

`limits` returns the authoritative defaults and hard ceilings so the UI does not duplicate magic numbers for presentation, but frontend schemas still enforce the closed integer/range shape before rendering. The backend is authoritative for the 100 MiB combined-budget check. Saving defaults is the reset operation, so no third mutation command is needed.

## Frontend Boundaries

Add `src/lib/tauri/diagnostics-client.ts` with schemas in `src/lib/tauri/diagnostics-schemas.ts`, mirroring the existing `provider-client.ts` / `provider-schemas.ts` split, plus colocated tests. The client owns open/get/save command names, strict request/result schemas, settings projections, invocation through `InvokeTransport`, and shared error normalization.

Follow the established bridge convention: export a `createDiagnosticsClient(transport = defaultTransport)` factory plus `export type DiagnosticsClient = ReturnType<typeof createDiagnosticsClient>`, matching `createProviderClient`. Export both from `src/lib/tauri/index.ts`.

`ConversationWorkspace` creates a default client and accepts an optional injected one for tests. Pass it to `SettingsDialog`; do not extend `ProviderClient` with unrelated diagnostics behavior. Keep the new props optional with internal defaults so existing `ConversationWorkspace` and `SettingsDialog` test fixtures continue to construct without a diagnostics client.

`SettingsDialog` adds a `diagnostics` category with a Lucide diagnostic/folder icon. `DiagnosticsPanel` lives at `src/features/settings/components/DiagnosticsPanel.tsx` alongside `ConversationSettingsPanel`, follows the existing settings breadcrumb/layout, and uses installed shadcn primitives:

- explanatory copy stating that logs contain operational diagnostics but should still be reviewed before sharing;
- a status summary for the active sink and whether saved settings require restart;
- responsive `Field`/`FieldContent` rows with labelled numeric `Input` controls (`min`, `max`, `step=1`, numeric input mode) for MiB/file and total files, including range and total-budget descriptions;
- local integer/range/100 MiB validation plus the same authoritative backend validation;
- invalid fields set both `data-invalid` on `Field` and `aria-invalid` on `Input`, with a nearby `FieldError`; settings are grouped in `FieldSet`/`FieldGroup` for keyboard and screen-reader structure;
- Save and Restore Defaults buttons with independent pending state; successful changed settings show a persistent “重启后生效” notice;
- an outline `Button` with `FolderOpen` and `data-icon="inline-start"`;
- `Spinner` while invoking, with the button disabled;
- Sonner success feedback;
- persistent destructive `Alert` for failure, so retry remains available and accessible.

The panel is independent of conversation `readOnly`; viewing an archived conversation must not disable diagnostics.

## Data and Error Flow

```text
click button
  -> DiagnosticsPanel sets pending and clears prior error
  -> DiagnosticsClient validates empty request
  -> Tauri open_log_directory
       -> resolve trusted app_log_dir
       -> ensure directory
       -> OS file manager
  -> strict success decode
       -> success toast + pending false
  -> rejected/malformed result
       -> normalized UiError
       -> destructive Alert + pending false
```

Settings load/save is a parallel flow: load installs the last confirmed view; local validation prevents invalid invoke; save replaces the confirmed view only after a strict success decode. A load/save failure leaves the open-directory action usable and never clears the last confirmed settings.

No new `CommandErrorCode` is required. The action supplies contextual Chinese presentation while control flow continues to use the existing `internal`/retryable contract.

## Compatibility and Migration

- No SQLite migration. Logging policy uses a dedicated early-readable config record because it must exist before SQL preload.
- The `log` facade stays the transport, but the one existing product call site in `providers/titles.rs` is migrated to the typed helper rather than left as a raw macro; it would otherwise become a release-persisted log-injection point.
- Add the Rust `tauri-plugin-opener` dependency only; no JavaScript opener/log package is needed.
- Windows, macOS, and Linux use Tauri's platform log directory and opener implementation.
- Existing command success payloads remain unchanged; the diagnostics IPC surface is additive and consists of open/get/save only.

## Development worktree

The worktree and branch already exist:

```text
/home/jwh/Code/canopy-application-logging
feat/application-logging (base: main)
```

Do not rerun `git worktree add` or copy a second task directory during
implementation. Before `task.py start`, synchronize the reviewed planning
artifacts once; after start, edit and commit only in the linked worktree.

## Testing Strategy

- Pure Rust unit tests for default/configured/invalid/overflowing `LoggingPolicy`, hard-ceiling and total-budget validation, build-mode selection, event classification, stable formatting, and sentinel redaction at every level.
- Config-store tests cover absent slots, valid highest revision, deterministic ties, one-slot corruption, both-slot corruption, unsupported/unknown/oversized data, interrupted inactive-slot writes, revision overflow, and concurrent save serialization.
- A boxed-logger test uses a temporary `Folder` target and a small test-only rotation threshold to verify the policy translation produces bounded files without attaching the process-global logger.
- A target-filter test asserting the predicate accepts `canopy_lib::…` and rejects a representative dependency target, so a wrong prefix cannot silently disable all logging.
- Bootstrap degradation tests force primary file `split` failure, console fallback `split` failure, and attach failure; assert the ordered attempts and that setup always returns `Ok(())` without selecting a secondary file/DB/memory sink.
- Startup-failure classification tests mapping `Error::PluginInitialization("sql", ..)` to `code=plugin_initialization plugin=sql` and any other variant to `code=startup_failed`, asserting the underlying message never appears and that a plugin name with an unexpected shape falls back to `unknown`.
- Redaction sentinels include a value containing `\n`/`\r`; run them through enabled error/warn/info/debug/trace events and file/stdout/stderr target formatters, asserting that the sentinel is absent and output remains a single line.
- Avoid registering the global logger repeatedly in parallel tests. Isolate one integration-style plugin/file test if feasible; otherwise verify builder configuration through extracted pure configuration and perform one debug no-bundle smoke check.
- Rust command tests inject a directory opener/path abstraction to verify success, directory-create failure, opener failure, no caller path, and safe error mapping without launching a GUI.
- TypeScript client tests cover open/get/save request shapes, strict settings/status/limits decoding, integer bounds, and malformed/rejected payload normalization.
- `DiagnosticsPanel` and `SettingsDialog` tests cover navigation, archived/read-only availability, settings load, dynamic total budget, local validation, save/reset, restart notice, sink status, independent pending deduplication, failure isolation, retry, and accessibility roles/names.
- A static test asserts `src-tauri/capabilities/default.json` grants no `opener:*` or `log:*` permission. It must not require the entire permission array to remain exactly `["core:default"]`, because unrelated future capabilities are outside this feature's contract.
- Static audits search for `println!`, `eprintln!`, `dbg!`, `console.`, raw `log::` macros outside `diagnostics`, secret-bearing fields, and generic opener permissions.

## Operational and Rollback Considerations

- Rollback unregisters diagnostics bootstrap/opener and all three commands, then removes the diagnostics module/client/panel/category and opener dependency. The two config-slot files may be left inert for rollback safety or removed by a later explicit cleanup; no database migration is involved.
- The configured file budget is always bounded. `RotationStrategy::KeepSome(n)` excludes the active file from `n`, so a policy with `max_files = N > 1` maps to `KeepSome(N - 1)`; the default `N = 5` yields four archives plus the active file. `N = 1` uses `KeepOne`. The plugin's own 40,000-byte default is never used.
- A logging bootstrap failure is intentionally silent from the UI because the UI may not exist yet; core startup remains authoritative.
- Plugin registration order is load-bearing. Anything inserted before the diagnostics bootstrap loses log coverage for its own startup phase, and any future attempt to register a plugin from within a setup hook will hang instead of erroring.
