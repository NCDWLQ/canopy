# Backend Logging Guidelines

> Diagnostic logging for a local-first application without leaking user data.

## Current Logging Boundary

`src-tauri/src/lib.rs` installs `tauri-plugin-log` only for debug builds and
sets the maximum level to `Info`. The application currently emits no product
events. Release logging, retention, and export have not been designed, so code
must not assume that a persistent release log sink exists.

Rust is the diagnostic boundary. Frontend code may present normalized errors,
but it must not duplicate source-error logging or use browser console output as
an application log.

## Event Shape

Use the `log` facade already declared in `src-tauri/Cargo.toml`. Until a
structured logging backend is selected, write stable key-value fields in the
message rather than prose containing serialized objects:

```rust
log::warn!(
    "operation=load_active_path code=tree_integrity conversation_id={conversation_id}"
);
```

Every diagnostic event should contain only the fields needed to correlate the
failure:

- a stable operation name;
- a stable error or lifecycle code when applicable;
- safe opaque identifiers such as `conversation_id` or `node_id`;
- duration/count metadata when it explains performance or retries.

Add source chains only to protected Rust diagnostics and only after the source
type has been checked for sensitive content. The user-facing `CommandError`
remains a separate, redacted payload.

## Levels

| Level | Use |
|---|---|
| `error` | Unexpected failure that prevents a requested operation and requires investigation |
| `warn` | Integrity rejection, degraded/retryable dependency behavior, or suspicious but contained state |
| `info` | Low-volume application lifecycle events such as database readiness or a completed migration |
| `debug` | Development-only control-flow diagnostics without content or credentials |
| `trace` | Not used in normal Canopy code; introduce only with an explicit diagnostic need |

Expected invalid input, not-found results, and user cancellation are not
automatically errors. Log them only when aggregate diagnostics need the event,
and keep their severity below `error`.

## Redaction Rules

Never log:

- API keys, authorization headers, or provider configuration secrets;
- prompts, message content, node metadata, or a complete conversation path;
- raw command/request DTOs or provider response bodies;
- SQLite URLs, local database paths, home-directory paths, or full backtraces
  sent to the frontend;
- unfiltered `Debug` output from errors that may embed any of the above.

Log stable IDs instead of titles/content. Log counts and byte lengths instead
of payloads. Provider failures use the mapped error code and safe status/retry
metadata rather than the raw body.

## Ownership and Error Mapping

- Repository and provider adapters preserve source errors; they do not each
  choose a public error code.
- Services add operation context.
- The central error mapper chooses the stable code and retryability.
- The command boundary logs an operation once when needed and returns the safe
  `CommandError`; lower layers must not create duplicate log lines for the same
  propagated failure.
- Cancellation and handled validation failures must not produce alarming logs.

This is the logging side of the contract in
`.trellis/spec/backend/error-handling.md`; changes to one document must remain
consistent with the other.

## Testing and Review

- Redaction tests should feed sentinel secrets/content through error mapping
  and assert that neither serialized errors nor captured log messages contain
  them.
- Review new log fields at the same trust boundary as IPC fields.
- Search changed Rust and TypeScript code for `println!`, `dbg!`, and
  `console.` before merge. None are accepted as durable logging.
- Keep the debug plugin registration testable through the library builder;
  do not move setup into `main.rs`.
