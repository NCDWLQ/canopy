# Provider Guidelines

> Executable contracts for Canopy's OpenAI-compatible generation boundary.

## Scenario: Secure Profile and Validated-Path Generation

### 1. Scope / Trigger

Use this contract when changing provider profile storage, native credentials,
endpoint validation, Chat Completions request/SSE handling, generation
cancellation, or completed-assistant persistence. The owning backend files are
`src-tauri/src/providers/`, `0004_provider_profile.sql`, and the narrow
assistant/path operations in `conversations::service`.

### 2. Signatures

The public command surface is:

```text
save_provider_profile({ base_endpoint, model, api_key }) -> ProviderProfileDto
load_provider_profile({}) -> ProviderProfileDto
delete_provider_profile({}) -> { deleted }
generate_from_active_path({ conversation_id, active_node_id }, on_event)
  -> { generation_id }
cancel_generation({ generation_id }) -> { accepted }
commit_generation({ generation_id, commit_token }) -> { accepted }
```

The provider request boundary is deliberately closed:

```rust
build_request(&ValidatedPath, &str) -> Result<ChatCompletionRequest, ProviderError>
ValidatedEndpoint::parse(&str) -> Result<ValidatedEndpoint, ProviderError>
GenerationRuntime::reserve(conversation_id, generation_id) -> GenerationLease
GenerationRuntime::commit(generation_id, commit_token) -> Result<bool, ProviderError>
GenerationLease::await_commit(send_ready) -> Result<bool, ProviderError>
```

Migration 4 owns the singleton `provider_profiles` table and the append/delete
recovery rows in `provider_credential_operations`. Neither table contains an
API key, authorization header, encrypted secret, or secret-derived verifier.

### 3. Contracts

- API-key actions are explicit: `keep`, `replace { value }`, or `remove`.
  Profile results expose only `has_api_key`; credential references remain Rust
  internal.
- Native credentials use service namespace `app.canopy.desktop` behind
  `CredentialStore`. Production keyring calls run on the blocking runtime;
  tests inject a fake and never touch the developer's keychain.
- Replace/remove/delete record a non-secret SQLite intent before crossing into
  the native store. Reconciliation runs under the process-wide profile lock
  before every profile/generation read or mutation.
- Remote endpoints require HTTPS. HTTP is accepted only for exact
  `localhost`, `127.0.0.1`, or `[::1]` authorities. Credentials, query, and
  fragment are forbidden. `chat/completions` is appended with URL path
  segments, and the reusable Rustls client follows no redirects or ambient
  system proxy settings. Provider credentials must never transit an
  unconfigured environment proxy, especially for loopback HTTP endpoints.
- Provider requests accept only `ValidatedPath`, preserve ordered
  system/user/assistant content byte-for-byte, reject tool nodes, and require a
  terminal user node.
- SSE accepts choice index zero, bounded string deltas, exactly one normal
  `stop` finish, then `[DONE]`. EOF, other finish reasons, data after finish,
  malformed JSON, provider errors, multiple choices, or content above one MiB
  fail without persistence.
- One generation slot exists per conversation. Cancellation is exact by
  generation ID. After successful SSE the worker creates a fresh UUID v4
  capability token, stores it only in the in-memory `AwaitingCommit` phase,
  sends `ready_to_commit`, and waits at most 30 seconds. Token-bearing runtime,
  request, and event types must not expose `Debug`, and tokens must never enter
  SQLite, logs, frontend persistence, or component props beyond the transient
  acknowledgement flow.
- `commit_generation` accepts only an exact, unexpired generation/token pair
  once. Commit, cancel, and timeout transitions are linearized under the same
  registry mutex: an acknowledgement winner moves to `Committing` and makes
  later cancellation return `accepted: false`; cancellation or expiry wins by
  preventing persistence and making commit return `accepted: false`. Wrong,
  replayed, stale, or not-ready pairs do not disturb another operation.
- The worker owns the Channel from `started` through the single terminal send.
  Legal order is `started -> delta* -> ready_to_commit -> completed|failed|
  cancelled`, or a pre-ready `failed|cancelled`. A ready send failure, channel
  failure before acknowledgement, pre-acknowledgement cancellation or timeout,
  or process exit before acknowledgement persists no assistant.
- A completed assistant is inserted only after acknowledgement acceptance,
  with the selected model and active user as parent. Conversation writability
  and parent role are rechecked in the insert transaction. `completed` contains
  the authoritative readback and is sent only after commit. Acknowledgement is
  the authorization/linearization point: a later disconnect cannot atomically
  roll back a committing or committed SQLite transaction, and callers must
  reconcile durable state by reload if terminal delivery is lost.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Remote HTTP, deceptive loopback, credentials/query/fragment | `invalid_input`; no HTTP |
| Missing profile | `not_found` |
| Missing/rejected key | `provider_authentication` |
| Locked/unavailable native store | retryable `provider_unavailable`; no plaintext fallback |
| 401/403 | `provider_authentication` |
| 429 | retryable `rate_limited`, with validated milliseconds when present |
| 5xx | retryable `provider_unavailable` |
| Connect/DNS/TLS/read timeout or early peer disconnect | retryable `network_failure` |
| Invalid path, archive, or non-user terminal | existing typed path/input error; no HTTP |
| Malformed/truncated/non-normal SSE | safe `provider_unavailable`; no assistant |
| Invalid generation ID or commit token syntax | `invalid_input`; no state change |
| Wrong/replayed/stale/not-ready commit pair | `{ accepted: false }`; no generation state change |
| Expired commit pair | `{ accepted: false }`; the exact awaiting generation may linearize its mandatory timeout to `Cancelling` |
| Exact cancellation or 30-second timeout before acknowledgement | `cancelled`; no assistant |
| Exact acknowledgement wins commit/cancel race | commit `{ accepted: true }`; later cancel `{ accepted: false }` |
| Archive/database failure after acknowledgement | typed `failed`; no partial assistant |

### 5. Good / Base / Bad Cases

- **Good**: a real migrated two-sibling path sends only the selected sentinel,
  streams ordered deltas, emits one transient ready token, commits one
  assistant sibling only after the exact acknowledgement, and returns that
  node in `completed`.
- **Base**: an exact loopback HTTP provider with no API key can generate from a
  user root.
- **Bad**: building messages from `ConversationTree.nodes`, following a 302
  with a bearer header, accepting `finish_reason: "length"`, or reporting a
  keyring/SQLite partial operation as success. Persisting immediately after
  `[DONE]`, logging a commit token, or treating Channel send success as frontend
  acknowledgement is also forbidden.

### 6. Tests Required

- Run real migrations and assert provider tables are additive, contain no
  secret columns/values, and leave conversation constraints unchanged.
- Inject the credential store and cover keep/replace/remove/delete, unavailable
  and missing stores, unwritten and written intents, promoted cleanup, delete
  replay, and concurrent service instances. Assert failed `keep` does not
  mutate non-secret profile fields.
- Use a loopback HTTP fixture to assert exact request path/body/header,
  arbitrary SSE chunking, status mapping, malformed/truncated/non-normal
  streams, post-finish rejection, one-MiB bound, midstream cancellation,
  redirect refusal, ambient-proxy bypass, and network failure.
- Exercise generation registry linearization, same-conversation exclusion,
  cross-conversation independence, no row before acknowledgement, exact
  one-time UUID v4 acknowledgement, wrong/replay/stale/not-ready pairs,
  commit-versus-cancel and commit-versus-deadline winners, timeout cleanup,
  ready send failure, archive recheck, authoritative assistant readback,
  terminal-send failure after commit, and slot release on every outcome.
- Scan source, fixtures, serialized errors, and logs for credential/prompt/body
  leakage; fixture keys are sentinels only and never live credentials.

### 7. Wrong vs Correct

#### Wrong

```rust
let messages = tree.nodes;
let response = reqwest::get(caller_url).await?;
persist_each_delta(response).await?;
```

This leaks siblings, permits caller-controlled transport, and creates partial
durable history.

#### Correct

```rust
let (_, path) = persistence.load_generation_context(conversation_id, active_id).await?;
let request = build_request(&path, &profile.model)?;
let content = client.stream(&endpoint, &path, &profile.model, secret, token, on_delta).await?;
if lease.await_commit(send_ready).await? {
    persistence.append_completed_assistant(assistant_node(content)).await?;
}
```

Only a validated branch reaches HTTP, deltas remain transient, and
cancellation/timeout compete with an explicit one-time acknowledgement before
the immutable assistant transaction begins.
