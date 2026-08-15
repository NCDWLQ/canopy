# Provider Guidelines

> Executable contracts for Canopy's provider profile and generation boundary.

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
  -> GenerationTerminalDto
cancel_generation({ generation_id }) -> { accepted }
```

The generation terminal result is a tagged union:

```text
completed { generation_id, node }
cancelled { generation_id }
failed { generation_id, stage: generation|persistence, error }
```

The provider request boundary is deliberately closed:

```rust
build_request(&ValidatedPath, &str) -> Result<ChatCompletionRequest, ProviderError>
ValidatedEndpoint::parse(&str) -> Result<ValidatedEndpoint, ProviderError>
GenerationRuntime::reserve(conversation_id, generation_id) -> GenerationLease
GenerationRuntime::cancel(generation_id) -> Result<bool, ProviderError>
GenerationLease::begin_finalizing() -> Result<bool, ProviderError>
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
  system/user/assistant content byte-for-byte, reject tool nodes, and require
  a terminal user node.
- SSE accepts choice index zero, bounded string deltas, exactly one normal
  `stop` finish, then `[DONE]`. EOF, other finish reasons, data after finish,
  malformed JSON, provider errors, multiple choices, or content above one MiB
  fail without persistence.
- One generation slot exists per conversation. Cancellation is exact by
  generation ID. A successful provider stream enters `Finalizing` under the
  runtime mutex before SQLite persistence; the lease and slot remain held until
  the authoritative assistant row has been read back or persistence fails.
- The runtime has only `Running`, `Finalizing`, and `Cancelling` phases.
  Cancellation changes `Running` to `Cancelling` and cannot interrupt
  `Finalizing`. The finalization transition wins the cancel race and is the
  only point at which the assistant may be persisted.
- The worker owns the Channel from `started` through the transient `delta`
  events. The command returns one terminal result after the worker finishes;
  it does not send a terminal Channel event. Legal channel order is
  `started -> delta*`. A Channel failure before finalization cancels the run
  and persists no assistant. A Channel failure after finalization does not
  roll back persistence.
- `completed.node` is the authoritative readback and is emitted only after
  the assistant transaction succeeds. Generation/provider failures use stage
  `generation`; archive, transaction, or readback failures use stage
  `persistence`; cancellation returns no assistant.

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
| Invalid generation ID syntax or unknown generation | `invalid_input` or `{ accepted: false }`; no other state change |
| Exact cancellation while `Running` | `{ accepted: true }`; terminal `cancelled`; no assistant |
| Cancellation after `Finalizing` starts | `{ accepted: false }`; persistence continues |
| Channel failure before finalization | terminal `cancelled`; no assistant |
| Channel failure after finalization | persistence result remains authoritative |
| Archive/database/readback failure during finalization | terminal `failed` with `stage: persistence` |

### 5. Good / Base / Bad Cases

- **Good**: a real two-sibling path sends only the selected sentinel, streams
  ordered deltas, persists one assistant child after finalization wins, and
  returns that node in `completed`.
- **Base**: an exact loopback HTTP provider with no API key can generate from
  a user root.
- **Bad**: building messages from `ConversationTree.nodes`, following a 302
  with a bearer header, accepting `finish_reason: "length"`, persisting each
  delta, or reporting a Channel send as durable success.

### 6. Tests Required

- Run real migrations and assert provider tables are additive, contain no
  secret columns/values, and leave conversation constraints unchanged.
- Inject the credential store and cover keep/replace/remove/delete, unavailable
  and missing stores, unwritten and written intents, promoted cleanup, delete
  replay, and concurrent service instances.
- Use a loopback HTTP fixture to assert exact request path/body/header,
  arbitrary SSE chunking, status mapping, malformed/truncated/non-normal
  streams, post-finish rejection, one-MiB bound, midstream cancellation,
  redirect refusal, ambient-proxy bypass, and network failure.
- Exercise generation registry linearization, same-conversation exclusion,
  cross-conversation independence, no row before finalization, cancellation
  before and during persistence, Channel failure before and after finalization,
  archive recheck, authoritative assistant readback, persistence failure, and
  slot release on every outcome.
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
lease.begin_finalizing()?;
let node = persistence.append_completed_assistant(assistant_node(content)).await?;
```

Only a validated branch reaches HTTP, deltas remain transient, and the
finalization transition protects the immutable assistant transaction from a
late cancellation.
