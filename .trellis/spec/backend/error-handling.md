# Error Handling

> Stable error contracts across SQLite, Rust, Tauri IPC, and the UI.

---

## Overview

Errors are translated once at each trust boundary:

```text
sqlx / plugin / provider source error
  -> repository or provider error
  -> application/domain error
  -> serializable CommandError
  -> TypeScript bridge validation and normalization
  -> actionable feature UI state
```

Rust retains the source chain for diagnostics. The Tauri boundary returns only
safe, stable data. Components receive normalized frontend errors and must not
parse Rust strings, `sqlx` errors, provider bodies, or unknown invoke payloads.

Application and infrastructure errors stay in their owning modules. Only
`error.rs` maps them onto the serializable `CommandError` envelope.

| Internal type | Owner | Notes |
|---|---|---|
| `DatabaseError` | `infra::database` | Missing/unavailable managed pool only. No product dependency. |
| `PersistenceError` | `conversations` | Tree/row integrity and conversation SQL. |
| `SettingsError` | `settings` | Typed `app_settings` SQL. `CorruptValue` keeps the historical wire mapping `provider_unavailable` / `服务提供商当前不可用。` / retryable (via `ProviderError::Llm(LlmError::Protocol)` at the IPC boundary). |
| `ProviderError` | `providers` | Profile validation, absence, keyring/reconcile, provider storage. |
| `LlmError` | `llm` | Authentication, rate limit, remote availability, network, protocol, cancel. |
| `GenerationError` | `generation` | Runtime state plus transparent composition of conversation/provider/LLM failures; retains `generation\|persistence` terminal stages. |
| `ExportError` | `exports` | Path/content policy and bounded write failures. |
| `CommandError` | `error.rs` | The only IPC error. Codes, Chinese `message` values, retryability, and details stay byte-compatible. |

## Error Types

Application errors use a closed machine-readable taxonomy. The initial command
codes are:

| Code | Meaning | Default retryable |
|---|---|---:|
| `invalid_input` | A command DTO or domain input is invalid | false |
| `not_found` | The requested conversation/node/path does not exist | false |
| `tree_integrity` | Stored root, parent, branch, or path invariants are broken | false |
| `database_unavailable` | The managed database/pool cannot currently be used | true |
| `migration_failure` | Required migrations did not apply | false |
| `provider_authentication` | Provider credentials are missing or rejected | false |
| `rate_limited` | The provider asked the client to wait | true |
| `provider_unavailable` | The provider is temporarily unavailable | true |
| `network_failure` | Transport or connectivity failed | true |
| `cancelled` | The user or application cancelled the operation | false |
| `internal` | An unexpected failure has no safer public classification | false |

Do not add ad hoc strings for new call sites. Extend the central Rust code enum,
its source-error mapper, the TypeScript decoder, fixtures, and contract tests as
one shared-contract change.

Every Tauri command failure serializes the same shape:

```rust
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
```

- `code` is stable control-flow data.
- `message` is a concise, safe summary retained for wire/debug visibility, not
  a source error dump. The UI does not render it: user-facing error copy is
  mapped on the frontend from `code` (`commandErrorMessage` in
  `src/lib/i18n`), so the same error follows the active UI locale.
- `message` stays Simplified Chinese (a stable wire value asserted by Rust
  tests). Localization changes only the frontend dictionary mapping; it never
  changes `code`, `retryable`, `details`, or the serialized field shape.
- `retryable` is decided by the central mapper, not by individual components.
- `details` is optional, structured, non-sensitive context such as an input
  field name, a safe resource identifier, or a provider retry delay. It is not
  an escape hatch for raw source data.

## Rust Handling Patterns

- Repository/provider adapters wrap source errors and preserve their source
  chains. Application services add operation context and enforce domain
  semantics. Only the command boundary converts an application error into
  `CommandError`.
- Centralize mappings so identical failures have identical codes. Constraint
  failures caused by rejected user operations normally map to `invalid_input`;
  evidence that durable tree data violates its invariants maps to
  `tree_integrity`.
- Classify SQLite `BUSY` and `LOCKED` result codes, including their extended
  forms, as retryable `database_unavailable`. Match numeric result codes rather
  than parsing localized or version-dependent database error text.
- The root-to-active repository fails closed. Missing active nodes map to
  `not_found`; a wrong root, broken adjacency, cross-conversation link, or
  cycle maps to `tree_integrity`. Neither case may trigger
  a full-history provider request.
- Archived conversations remain readable. A mutation targeting one maps to
  `invalid_input`; node-level archive has no public command.
- Provider status/transport errors map to authentication, rate limiting,
  availability, network, or cancellation codes before reaching commands.
  Unknown provider payloads map to `internal` or `provider_unavailable` based on
  the verified failure class, never by exposing the payload.
- Tauri commands return `Result<SuccessDto, CommandError>`. Do not return
  `String`, `anyhow::Error`, or a serialized library error across IPC.
- Do not catch an error only to log and return success. If a fallback is part of
  product behavior, represent it explicitly in the success DTO and test it.

## Logging and Redaction Boundary

Log source chains in Rust with an operation name, stable error code, and safe
correlation identifiers. Logs and command errors must never contain:

- API keys, authorization headers, or provider credentials;
- full prompts, message content, or complete conversation paths;
- raw provider response bodies;
- local database paths or connection strings;
- unfiltered `Debug` output of request/command payloads.

Redact before logging; serialization redaction alone is insufficient. The
serialized `message` and `details` must be safe even if shown verbatim. Expected
validation/not-found conditions need useful context but not an error-level
source dump. Unexpected errors retain diagnostic detail only in protected Rust
logs and expose the generic `internal` response.

## TypeScript and UI Boundary

The single TypeScript invoke bridge accepts the rejected value as `unknown`,
validates the complete `CommandError` shape and known code, and converts it to
the shared frontend error type. A malformed or unknown payload becomes a safe,
non-retryable `internal` error. Components do not call raw `invoke`, cast an
error payload, or redefine the code union.

Presentation rules:

- `invalid_input`, `not_found`, authentication, and other expected action
  failures render next to the action that failed with a relevant recovery step.
- Retryable network, rate-limit, database, or provider availability failures
  expose a retry action. If `details` contains a validated retry delay, the UI
  may use it without parsing the message.
- `tree_integrity`, `migration_failure`, and `internal` show a recovery notice
  that preserves existing UI state and does not suggest destructive repair.
- `cancelled` clears loading/streaming state and does not display an error toast.
- UI text may add presentation context, but branching behavior depends on
  `code` and `retryable`, never message matching.
- The UI does not expose a raw machine error code as user copy. Keep the code in
  normalized state for control flow and diagnostics, and render the localized
  dictionary text mapped from that `code` (`commandErrorMessage`) with a
  contextual localized heading; never render the backend `message` string.

Example contract-preserving localization:

```rust
CommandError {
    code: CommandErrorCode::DatabaseUnavailable,
    message: "对话数据库当前不可用。".to_owned(),
    retryable: true,
    details: None,
}
```

Rust mapping/serialization tests and any shared fixture that models real Rust
output must assert the Chinese `message` wire value together with the unchanged
machine fields. Frontend tests assert the dictionary text mapped from `code`,
not the wire `message`. Arbitrary fixture messages may remain non-Chinese only
when the test is explicitly proving opaque message preservation rather than
product copy.

## Common Mistakes

- Returning `error.to_string()` from a Tauri command.
- Letting every command invent a code, message, or retry policy.
- Including prompts, provider bodies, database paths, or credentials in
  `details` or logs.
- Treating every SQLite error as retryable database unavailability.
- Parsing error messages in React or casting an invoke rejection directly.
- Showing a cancellation toast or clearing durable/visible conversation state
  after a recoverable failure.
- Continuing with whole-conversation context after a path or integrity error.
