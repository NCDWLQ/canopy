# Model Path Proof — Technical Design

## 1. Scope and Ownership

This task delivers a real OpenAI-compatible Chat Completions path from a
validated conversation branch through Rust HTTP/SSE and a typed Tauri channel.
It also delivers one securely persisted provider profile and the shared
TypeScript bridge contract required by a later UI integration task.

The task may change:

- `src-tauri/**`;
- a new provider IPC fixture under `contract-fixtures/`;
- shared provider projections under `src/features/providers/types/**`;
- `src/lib/tauri/**` and its tests;
- relevant backend/frontend Trellis specs during the finish phase.

It must not change `src/App.tsx`, Conversation Workspace components, hooks, or
Zustand store while the independent `frontend-workspace` worktree is active.

## 2. Architecture and Boundaries

```text
future provider settings UI
  -> typed TypeScript provider client
  -> provider profile Tauri commands
  -> ProviderProfileService
       -> ProviderProfileRepository -> plugin-managed SQLite pool
       -> CredentialStore -> native OS credential store

future Conversation Workspace action
  -> typed TypeScript generation client + Tauri Channel
  -> generate_from_active_path
  -> GenerationService
       -> ConversationPersistenceService -> ValidatedPath
       -> ProviderProfileService -> redacted profile + SecretString
       -> OpenAiCompatibleClient -> HTTPS / loopback HTTP Chat Completions SSE
       -> in-memory AwaitingCommit token + exact commit command
       -> ConversationPersistenceService -> committed assistant Node
  -> typed started/delta/ready_to_commit/completed/failed/cancelled events
```

Ownership remains explicit:

- `conversations` owns tree/path validation and immutable node persistence.
- `providers` owns non-secret configuration, credential access, HTTP request
  construction, SSE decoding, generation orchestration, and generation
  concurrency.
- root `error.rs` owns stable public `CommandError` mapping.
- Tauri commands validate DTOs and connect services; they do not contain SQL or
  provider parsing.
- `src/lib/tauri` is the only raw `invoke` owner and the only frontend decoder
  for provider/generation wire payloads.

## 3. Rust Module Shape

Add only modules that land with implementation:

```text
src-tauri/src/providers/
├── mod.rs
├── domain.rs              # redacted profile, generation IDs/events
├── error.rs               # credential/provider/internal source errors
├── credentials.rs         # CredentialStore trait + native keyring adapter
├── repository.rs          # profile and recovery-intent SQL
├── service.rs             # config reconciliation and generation orchestration
├── openai_compatible.rs   # request construction, HTTP, SSE parsing
└── commands.rs            # provider/generation DTOs and Tauri commands
```

`src-tauri/src/conversations/service.rs` gains a narrowly named method for
persisting a completed assistant response. It validates the conversation again
inside the write transaction, requires a user parent in the same writable
conversation, inserts one assistant node, and returns authoritative readback.
It does not weaken the existing end-user user-node command policies.

## 4. Provider Configuration and Credential Recovery

### 4.1 Persistent representation

Migration `0004_provider_profile.sql` adds isolated provider tables without
changing conversation tables or constraints:

- `provider_profiles`: one fixed MVP profile, validated base URL, model,
  nullable opaque credential reference, and `updated_at`;
- `provider_credential_operations`: non-secret recovery intents for credential
  replacement or profile deletion.

The database never stores an API key, authorization header, encrypted secret,
or secret-derived verifier. `has_api_key` is derived from the active credential
reference and native store lookup; it is not trusted as durable truth.

The native adapter uses application identifier `app.canopy.desktop` as its
credential service namespace. A generated opaque credential reference is the
account name. API keys are wrapped in a secret type that does not expose them
through `Debug` or ordinary serialization.

### 4.2 Save/update protocol

The save DTO uses an explicit API-key action: `keep`, `replace`, or `remove`.
This avoids treating omitted, empty, and null values as the same operation.

- A non-secret update with `keep` is one SQLite transaction.
- `replace` creates a new opaque credential reference and persists a non-secret
  recovery intent before writing the new native secret.
- After the native write succeeds, a SQLite transaction promotes the new
  profile/reference. The old reference is then deleted and the intent removed.
- A crash leaves an intent whose relationship to the active profile identifies
  whether promotion or cleanup remains. Reconciliation runs before every
  provider-profile or generation operation and finishes or safely rolls back
  the idempotent steps.
- A synchronous failure compensates where possible and returns a typed failure;
  it never reports success while durable profile/credential state disagrees.

### 4.3 Delete protocol

Deletion first records a non-secret delete intent, then removes the native
credential, and finally removes the profile and intent transactionally. A
crash at any boundary is recoverable by replaying the idempotent intent. Missing
credentials and repeated delete requests are safe.

Native credential access is behind an injected `CredentialStore` trait. Unit
and integration tests use an in-memory fake; tests never touch the developer's
real keychain. If the native store is missing, locked, or unavailable, Canopy
fails closed and never falls back to plaintext storage.

## 5. Endpoint Validation and HTTP Client

The saved base endpoint is parsed once in Rust and must satisfy all rules:

- remote origins use `https`;
- `http` is accepted only for exact `localhost`, `127.0.0.1`, or `::1` hosts;
- username, password, query, and fragment are absent;
- the path is a base path such as `/v1`; fixed `chat/completions` segments are
  appended structurally rather than by string concatenation;
- redirect following is disabled, preventing authorization forwarding;
- no caller controls arbitrary paths, headers, or HTTP methods.

The production client uses Rustls-backed HTTPS, bounded connect/idle timeouts,
and an explicit user agent. It has no whole-stream timeout because generation
can be long-running; cancellation and per-read idle timeouts bound it instead.
Authorization is attached only after endpoint validation. A loopback provider
may omit an API key.

## 6. Validated Request Construction

The request builder's production signature accepts `&ValidatedPath`, a model,
and no generic node vector. It emits the minimal compatibility request:

```json
{
  "model": "configured-model",
  "messages": [{ "role": "user", "content": "..." }],
  "stream": true
}
```

It preserves path order and content bytes. `system`, `user`, and `assistant`
roles map directly. `tool` is rejected because the current Node contract has no
Chat Completions `tool_call_id`; silently fabricating one would corrupt context.
The final path node must be `user`. Existing assistant children do not make the
user ineligible, so regeneration creates another assistant sibling.

Generation preflight loads the conversation and `ValidatedPath` through one
persistence transaction, rejects archived conversations and non-user active
nodes, loads/reconciles the provider profile and secret, then acquires the
per-conversation generation slot. No provider I/O occurs before preflight
succeeds.

## 7. SSE Decoding and Provider Errors

The adapter consumes the response byte stream incrementally through an
SSE-aware decoder; it does not split arbitrary network chunks on newlines.
Only choice index zero is accepted. Text deltas are forwarded in order and
accumulated under the existing one-MiB content limit. A valid stream must reach
one normal finish and `[DONE]`; EOF, malformed JSON, multiple choices,
provider-declared stream errors, or blank/oversized final content fails without
persistence.

HTTP and transport mapping is centralized:

| Failure | Public result |
|---|---|
| 401 / 403 | `provider_authentication`, non-retryable |
| 429 | `rate_limited`, retryable, validated retry delay when available |
| 5xx | `provider_unavailable`, retryable |
| connect, DNS, TLS, or idle timeout | `network_failure`, retryable |
| explicit cancellation | `cancelled`, non-retryable |
| invalid/malformed success stream | safe `provider_unavailable` or `internal` per verified class |

Raw bodies, prompts, API keys, URLs containing sensitive data, and source
`Debug` output never cross IPC or logs. Diagnostics use operation name, safe
IDs, status class, duration, and byte/count metadata only.

## 8. Generation Runtime and Persistence

A managed `GenerationRuntime` holds a concurrent registry keyed by
conversation ID. Different conversations may run concurrently; a duplicate
request for one conversation is rejected without affecting the existing entry.
Each entry has one closed phase: `Running`, `AwaitingCommit`, `Committing`, or
`Cancelling`. The slot stays occupied through acknowledgement waiting and
persistence.

`generate_from_active_path` completes preflight, reserves the slot, creates the
channel lifecycle, spawns owned async work, and returns a start DTO promptly.
Events are a closed tagged union:

- `started`: generation/conversation/active-node IDs and model;
- `delta`: ordered text fragment;
- `ready_to_commit`: exact generation ID plus a fresh generation-scoped,
  one-time UUID v4 commit token;
- `completed`: authoritative stored assistant `NodeDto`;
- `failed`: safe `CommandError`;
- `cancelled`: cancellation acknowledgement.

Preflight failures reject the command and emit no lifecycle. The Rust worker
owns the Channel and full response and remains the sole terminal sender.
Legal order is `started -> delta* -> ready_to_commit -> completed|failed|
cancelled`, or a pre-ready `failed|cancelled`; no delta follows readiness and
completion never precedes it.

After normal SSE completion, the worker creates a fresh UUID v4 token and a
one-shot acknowledgement receiver. Under the registry mutex it transitions
`Running -> AwaitingCommit`, stores only the token, one-shot sender, and a
monotonic deadline 30 seconds ahead, and sends `ready_to_commit`. Send failure
transitions to cancellation, persists nothing, and releases the slot. Process
exit while waiting also loses only memory-only state and writes nothing.

`commit_generation({ generation_id, commit_token })` validates both as UUIDs.
Under the same registry mutex it accepts only the exact, unexpired
`AwaitingCommit` pair, consumes the token/sender once, and transitions to
`Committing` before waking the worker. Wrong, replayed, expired, not-ready, or
committing pairs return `accepted: false` without affecting any generation.
The expiry path checks the monotonic deadline under this mutex before changing
`AwaitingCommit -> Cancelling`; a delayed timer cannot accept an expired token.
`cancel_generation` changes `Running` or `AwaitingCommit` to `Cancelling`, but
returns false for `Committing`. Thus commit/cancel/timeout races have exactly
one linearization winner.

Only after acknowledgement acceptance does the worker call the existing
immutable assistant transaction. The service re-checks writable conversation
and user-parent policy, and `completed` is sent only after authoritative
readback. SQLite persistence and terminal Channel delivery cannot be atomic:
the accepted acknowledgement is authorization to commit, so later disconnect
or cancellation cannot roll back committing/committed work. A failed terminal
send releases the slot and the frontend must reload SQLite to reconcile. An
RAII-style lease releases the exact slot on every exit path.

## 9. Shared IPC and TypeScript Boundary

Use a new provider-specific shared fixture so the existing conversation fixture
remains stable. Freeze these command families:

- save/load/delete provider profile;
- generate from active path;
- cancel generation;
- commit generation with the exact one-time token.

Profile DTOs expose base endpoint, model, `has_api_key`, and timestamps but
never the secret or credential reference. The save request may carry a new API
key in the one-way `replace` action; it is never echoed.

The TypeScript bridge constructs `Channel<unknown>`, validates every event with
Zod, projects it into closed provider/conversation view types, and never passes
unknown payloads to consumers. It tracks an `awaiting_commit` phase, exposes
`ready_to_commit` and `commitGeneration`, validates generation IDs and commit
tokens as exact UUIDs, and never auto-acknowledges. A malformed event, identity
mismatch, illegal order, delta after readiness, or completion before readiness
becomes one safe local `internal` failure and requests exact-ID cancellation
when an ID is available. API keys and commit tokens never enter storage.

No App, component, hook, or Zustand change occurs here. A post-merge task will
connect the frozen client to settings controls and transient rendering.

## 10. Verification Strategy

- Request-builder unit tests prove exact ordered role/content projection and
  sibling-sentinel absence from `ValidatedPath` to JSON.
- Real-migration tests prove provider table shape, recovery-intent behavior,
  conversation-schema preservation, and absence of secret columns/values.
- Injected credential-store tests cover save, replace, keep, remove, delete,
  missing/locked store, compensation, and crash-boundary reconciliation.
- A deterministic loopback HTTP fixture captures the outgoing body/header and
  emits SSE split across arbitrary chunks. It covers deltas, `[DONE]`, EOF,
  malformed events, 401/403, 429 retry delay, 5xx, cancellation, disconnect,
  and content bounds without a paid provider account.
- Persistence tests prove success adds exactly one assistant child and every
  failure path adds none.
- Registry tests prove cross-conversation parallelism, same-conversation
  exclusion through awaiting/commit, no row before acknowledgement, exact
  one-shot commit, wrong/replayed token rejection, commit-vs-cancel and
  commit-vs-timeout winner semantics, ready-send failure, timeout cleanup,
  archive/database failure after acknowledgement, terminal-send ambiguity, and
  slot cleanup.
- Rust/shared-fixture/TypeScript tests prove command/event casing, redaction,
  ready projection/order, exact cancellation on malformed payloads, no
  automatic acknowledgement, and one raw frontend invoke owner.

## 11. Compatibility, Rollback, and Deferred Integration

The migration is additive and leaves conversation tables untouched. Existing
seven conversation commands and projections remain compatible. The new bridge
has no UI consumer until the frontend worktree is merged.

If native credential-store support or HTTP dependencies fail a platform build,
stop rather than introducing plaintext fallback. Code can be reverted while
retaining the additive migration; a later forward migration may remove unused
provider tables. Any native credential entries created during manual testing
must be removed through the provider delete command, not by logging or exposing
their values.

The deferred UI integration task owns provider settings controls, generation
buttons, stream/store wiring, and rendered transient state. It consumes this
task's frozen contract and may not redefine provider events independently.
