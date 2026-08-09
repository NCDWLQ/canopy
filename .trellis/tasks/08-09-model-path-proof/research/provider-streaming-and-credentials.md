# Provider Streaming and Credential Research

## Decision Summary

- Target Chat Completions `POST /v1/chat/completions` with `stream: true` for
  the first broad OpenAI-compatible adapter. Keep the adapter boundary separate
  so a future Responses API implementation does not change conversation
  persistence.
- Use direct Rust `reqwest` with Rustls, JSON, and stream features. Disable
  redirects explicitly and consume `bytes_stream()` through
  `eventsource-stream`; do not implement SSE by splitting network chunks.
- Use `tokio_util::sync::CancellationToken` for exact generation cancellation
  and an owned per-conversation registry entry.
- Use Tauri 2 `tauri::ipc::Channel<T>` for typed backend-to-webview deltas.
  Tauri documents Channel as the recommended mechanism for streamed HTTP
  responses and its JavaScript Channel preserves message order.
- Use Rust `keyring` default `v1` platform stores behind an injected trait.
  Its current default features select Apple Keychain, Windows native credential
  storage, and zbus Secret Service on Unix. Run calls off the async executor's
  core threads and never add a plaintext fallback.
- Persist non-secret provider configuration and non-secret recovery intents in
  SQLite. Use new credential references plus idempotent intent replay for
  replace/delete so a crash between SQLite and the OS store can be reconciled.

## Local Compatibility Evidence

- `src-tauri/Cargo.toml` uses Rust 1.97.1 and Tauri 2.11.3.
- `src-tauri/Cargo.lock` already resolves `reqwest 0.13.4`, `tokio 1.53.1`,
  `tokio-util 0.7.19`, `futures-util`, and `url` transitively. They are not
  direct crate dependencies yet; add only required features and verify one
  resolved version with `cargo tree`.
- `@tauri-apps/api` is 2.11.x. Its installed `Channel` implementation queues by
  monotonically increasing index and unregisters the callback when Rust closes
  the channel.
- The current provider error codes already cover authentication, rate limiting,
  provider availability, network failure, cancellation, and safe internal
  fallback in `src-tauri/src/error.rs` and the TypeScript decoder.
- `ConversationPersistenceService::load_active_path` already returns the closed
  `ValidatedPath` type. Provider request construction should depend on that
  type, not reproduce path validation.

## HTTP and SSE Notes

`reqwest 0.13.4` exposes separate `json`, `stream`, and `rustls` features. Its
default redirect behavior follows up to ten hops, so the Canopy client must set
`reqwest::redirect::Policy::none()` before attaching bearer credentials.

`eventsource-stream 0.2.3` adapts a byte stream into parsed SSE events and is
compatible with `reqwest::Response::bytes_stream()`. It handles boundaries
across arbitrary byte chunks, which is required for deterministic tests that
split `data:` records mid-line. It does not own retries/reconnection, which is
desirable: automatic replay could duplicate model requests and assistant
nodes.

The adapter should require one choice (`index == 0`), accumulate only string
`delta.content`, require a normal finish plus `[DONE]`, and treat EOF without
`[DONE]` as failure. Bound total content to the existing one-MiB node limit.
Status mapping should occur before body parsing; never include raw error bodies
in public errors or logs.

## Cancellation and Channel Notes

`CancellationToken::cancelled()` is cancellation-safe and can participate in
`tokio::select!` beside the next SSE event. Store one token with each
conversation/generation registry entry. Exact-ID lookup prevents a stale cancel
request from cancelling a later generation in the same conversation.

Tauri Channel is ordered but delivery cannot be guaranteed after the webview
disconnects. The invariant must therefore be: one internal terminal transition
and at most one terminal send attempt. A failed channel send cancels the HTTP
work, prevents assistant persistence, and releases registry state.

The TypeScript bridge should construct `Channel<unknown>`, validate every
payload before forwarding it, and normalize malformed events to a safe local
internal failure. Do not expose raw SSE or provider JSON to components.

## Native Credential Store Notes

`keyring 4.1.5` declares Rust 1.88 minimum, so it is compatible with the
project's Rust 1.97.1 toolchain. Its default `v1` feature includes native Apple,
Windows, and Unix Secret Service backends. Linux runtime availability still
depends on an accessible Secret Service session; missing/locked service must
produce a typed failure rather than a file fallback.

Use `app.canopy.desktop` as the service namespace and a generated opaque
credential reference as the account. Keep the secret in a redacting wrapper
and avoid deriving `Debug`/`Serialize` on save requests that contain it.
Production calls may block or interact with platform services, so invoke them
through a dedicated blocking boundary. Unit/integration tests use a fake
credential store and never call the native backend.

SQLite and a native credential store cannot share an atomic transaction. A
fixed key overwritten in place cannot distinguish old from new after a crash.
Generate a new credential reference for replacement, record a non-secret intent
first, write the new key, promote the profile reference, then clean the old
reference. The durable intent plus active reference makes every crash boundary
replayable. Deletion follows the same intent-first pattern.

## Primary References

- OpenAI text generation and current Responses recommendation:
  https://developers.openai.com/api/docs/guides/text
- OpenAI streaming event reference:
  https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta
- Tauri commands and Channels:
  https://v2.tauri.app/develop/calling-rust/
- Tauri `Channel` Rust API:
  https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html
- Reqwest redirect policy and features:
  https://docs.rs/reqwest/latest/reqwest/redirect/
  https://docs.rs/crate/reqwest/latest/features
- `eventsource-stream` byte-stream adapter:
  https://docs.rs/eventsource-stream/latest/eventsource_stream/
- Tokio cancellation token:
  https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html
- Keyring native-store behavior and features:
  https://docs.rs/keyring/latest/keyring/
  https://docs.rs/crate/keyring/latest/features
- Tauri Stronghold alternative considered:
  https://v2.tauri.app/plugin/stronghold/

## Risks to Verify During Implementation

- Confirm the selected `reqwest` feature set resolves one TLS/HTTP stack and
  does not re-enable native TLS accidentally.
- Compile all targets available in CI; keyring's Linux Secret Service backend
  may introduce runtime or system-package assumptions even when compilation
  succeeds.
- Verify Tauri command tests can exercise Channel serialization; keep core
  generation service tests independent of Tauri if mock IPC cannot represent a
  live JavaScript channel.
- Verify recovery intent replay under injected failures at every boundary and
  ensure no test accesses the developer's native keyring.
- Verify the real Chat Completions compatibility fixtures separately from
  OpenAI Responses docs; the chosen MVP protocol is intentionally broader than
  OpenAI's current preferred direct API.
