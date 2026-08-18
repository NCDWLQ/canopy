# Backend Logging Guidelines

> Diagnostic logging for a local-first application without leaking user data.

## Current Logging Boundary

Rust is the only durable diagnostic producer. A Canopy-owned diagnostics
bootstrap plugin is registered first in `src-tauri/src/lib.rs`, before
`tauri-plugin-sql`. It attaches `tauri-plugin-log` through
`Builder::split(app_handle)` plus `attach_logger`, then drops the returned
plugin so the webview `log` IPC command is never registered.

Debug and release builds both write Canopy-owned events to a bounded file in
the platform log directory. Debug builds also keep stdout. Release builds do
not depend on a console. The process-global logger is attached once at
startup; configuration changes take effect on the next launch.

Frontend code may present normalized errors, but it must not duplicate
source-error logging or use browser console output as an application log.
Do not install `@tauri-apps/plugin-log`.

## Bootstrap, Fallback, and Policy

Fallback order is fixed and initialization-only:

1. persistent file sink;
2. console-only sink (debug stdout at Debug, release stderr at Warn);
3. no-op.

If `attach_logger` fails because a global logger already exists, keep that
logger and do not retry. Every bootstrap setup path returns `Ok(())`.
Managed sink status is `persistent`, `console_fallback`, or `disabled`.

`LoggingPolicy` defaults are 5 MiB per file and 5 total files. Hard limits are
20 MiB/file, 10 files, and 100 MiB combined. `try_from_limits` rejects `0`.
When translating an already-constructed policy to the plugin, `max_files` of
`0` or `1` maps to `KeepOne` (`KeepSome(0)` is invalid in the plugin); `n > 1`
maps to `KeepSome(n - 1)`. Policy is stored as two versioned 4 KiB JSON slots
under `app_config_dir` (`logging-policy-a.json` / `logging-policy-b.json`) and
is read before SQL preload. Missing slots decode as defaults. A config-dir
resolver failure is a command error, not a silent “defaults loaded” success.

## Event Shape

Product code must use the typed helpers in `src-tauri/src/diagnostics/logging.rs`.
Raw `log::` macros are allowed only inside `diagnostics`.

```rust
record_command_failure("load_active_path", &error, None);
record_lifecycle("create_conversation", "completed", None);
record_generation("generate_from_active_path", "completed", generation_id, Some(duration_ms));
```

Every event is a single line of stable fields: `operation=<name> code=<name>`
plus optional `retryable`, `id`/`generation_id`, `duration_ms`, `plugin`, or
`reason`. Dynamic values may only be a static string, a number/bool, a
`DiagnosticId` (canonical UUIDv4), or a sanitized plugin name. Newlines,
carriage returns, and unvalidated frontend identifiers must never enter a log
line. Conversation command IDs are not logged.

## Levels

| Level | Use |
|---|---|
| `error` | Unexpected failure that prevents a requested operation and requires investigation (`tree_integrity`, `migration_failure`, `internal`, plugin/startup failure, persistence failure) |
| `warn` | Integrity-adjacent degraded/retryable dependency behavior (`database_unavailable`, provider/network/rate-limit), auto-title skip, invalid config fallback, generation failure |
| `info` | Low-volume lifecycle events such as logger/application readiness and completed mutations |
| `debug` | Development-only control-flow diagnostics without content or credentials (debug build minimum) |
| `trace` | Not used in normal Canopy code; introduce only with an explicit diagnostic need |

Expected invalid input, not-found results, and user cancellation produce no
command-failure event. Severity is routing metadata, not a confidentiality
boundary: `debug`/`trace` use the same helpers and forbidden-field list.

## Redaction Rules

Never log, at any level or sink:

- API keys, authorization headers, or provider configuration secrets;
- prompts, message content, titles, node metadata, or a complete conversation path;
- raw command/request DTOs or provider response bodies;
- SQLite URLs, local database/log paths, home-directory paths, or full backtraces
  sent to the frontend;
- `CommandError.message` / `details`, unfiltered `Debug` output, or source chains.

Log `DiagnosticId` values instead of titles/content. Log counts, durations, and
retryability instead of payloads. Command-failure logs accept only the stable
code plus boolean/numeric metadata and an optional validated ID.

## Ownership and Error Mapping

- Repository and provider adapters preserve source errors; they do not each
  choose a public error code or emit logs.
- Services add operation context.
- The central error mapper chooses the stable code and retryability.
- The command boundary logs an operation once when needed and returns the safe
  `CommandError`; lower layers must not create duplicate log lines for the same
  propagated failure.
- Cancellation and handled validation failures must not produce alarming logs.
- Startup `tauri::Error::PluginInitialization` records `plugin=<name>` without
  the underlying message. Other startup failures record `startup_failed`.

This is the logging side of the contract in
`.trellis/spec/backend/error-handling.md`; changes to one document must remain
consistent with the other.

## Testing and Review

- Redaction tests should feed sentinel secrets/content through error mapping
  and assert that neither serialized errors nor captured log messages contain
  them, and that a newline sentinel does not add a log line.
- Review new log fields at the same trust boundary as IPC fields.
- Search changed Rust and TypeScript code for `println!`, `dbg!`, `console.`,
  and raw `log::` macros outside `diagnostics` before merge.
- Keep bootstrap constructible through the library builder; do not move setup
  into `main.rs` and do not call `handle().plugin` from a plugin setup hook.
