# Model Path Proof

## Goal

Deliver Canopy's first real model-generation boundary: construct an
OpenAI-compatible Chat Completions request from exactly one validated
root-to-active path, stream a response through typed Tauri IPC, and append one
complete assistant node without ever leaking a sibling branch or credential.

This gives the later Conversation Workspace integration a tested provider
client whose durable result remains part of Canopy's immutable tree rather than
an untracked UI-only response.

## Background

- Tree persistence and the typed conversation boundary are complete.
- `ConversationPersistenceService::load_active_path` returns the closed
  `ValidatedPath` type only after root, ownership, adjacency, terminal-node,
  duplicate, and cycle checks pass.
- The backend has no provider module, credential configuration, generation
  command, or streaming transport today. Provider-related public error codes
  and redaction rules already exist in the central `CommandError` contract.
- The separately developed Conversation Workspace owns App/components/hooks/
  store and intentionally treats generation as unavailable until this shared
  contract exists.
- The normalized outline contract is one message per `TreeNodeView`; user and
  assistant messages are distinct parent/child nodes.

## Requirements

### MP-1: Validated-path-only model input

- Provider request construction must accept `ValidatedPath`, not `Vec<Node>`,
  a conversation scan/tree, repository rows, or frontend state.
- Generation must load and validate the requested path before provider I/O.
- Missing or corrupt paths retain their typed fail-closed error and must never
  fall back to a partial path, whole conversation, or sibling branch.
- Supported roles and content map in exact path order without reordering,
  merging, summarizing, or byte-changing transformations.
- Unsupported provider-facing role/content combinations are rejected instead
  of silently rewritten.

### MP-2: Conversation and branch policy

- Archived conversations remain readable through existing commands but reject
  generation before provider I/O.
- Generation starts only from an active `user` node. `system`, `assistant`, and
  `tool` terminal nodes are rejected.
- A user node with existing assistant children remains eligible; a new success
  creates another assistant sibling without modifying earlier answers or their
  descendants.
- The task may append one completed assistant node but must not update, delete,
  reparent, or otherwise rewrite existing nodes or archive state.
- Provider migrations are isolated; existing conversation tables, constraints,
  commands, and per-message `TreeNodeView` semantics remain compatible.

### MP-3: Chat Completions HTTP/SSE boundary

- The MVP targets `POST /v1/chat/completions` with an ordered `messages` array
  and `stream: true`; it does not target legacy `/v1/completions` or Responses.
- Provider HTTP runs only in Rust. A future settings form may send a new API
  key once through the typed save command, but the webview cannot read it back
  or call provider APIs directly.
- Incremental SSE is decoded into a closed event contract; raw SSE/provider JSON
  never crosses IPC.
- Status, transport, timeout, malformed/truncated stream, provider-declared
  error, and cancellation outcomes map to the existing stable error taxonomy.
- Backpressure, content bounds, terminal uniqueness, disconnect, and
  cancellation are deterministic and tested against local HTTP fixtures; tests
  require no paid/live provider account.

### MP-4: Secure persistent provider profile

- The MVP has one active OpenAI-compatible profile containing a base endpoint,
  model identifier, and optional API key.
- Rust stores the API key only in the operating system credential store. It may
  exist transiently in a future password input/save request, but never in
  SQLite, JSON/config files, Zustand/durable frontend state, localStorage,
  IndexedDB, logs, fixtures, or command results.
- Migration-owned SQLite tables persist only non-secret profile data, an opaque
  credential reference, and non-secret cross-store recovery intents.
- Profile commands accept explicit key actions (`keep`, `replace`, `remove`)
  and return only redacted state such as `has_api_key`.
- Native credential access is behind an injected Rust trait; automated tests
  use fakes and never access the developer machine's credential store.
- Save/update/delete is recoverable at every SQLite/native-store boundary.
  Partial failure is surfaced and must never be reported as success.
- Missing, locked, or unavailable native credential storage fails closed; no
  plaintext fallback is permitted.

### MP-5: Endpoint security

- Remote base endpoints require HTTPS. Plain HTTP is allowed only for exact
  `localhost`, `127.0.0.1`, or `::1` hosts for local compatible servers.
- Endpoints are absolute and contain no username, password, query, or fragment.
  The fixed `chat/completions` route is appended structurally without caller-
  selected methods, paths, or headers.
- Redirect following is disabled so authorization cannot move to another
  origin.
- API keys are optional for loopback providers and are attached only after the
  endpoint passes validation.

### MP-6: Completed-response persistence

- SSE deltas are transient until the provider finishes successfully.
- After successful SSE, Rust emits one non-terminal `ready_to_commit` event
  containing the exact generation ID and a fresh one-time UUID v4 commit
  token. The complete accumulated response and token remain memory-only.
- The frontend must explicitly acknowledge that exact pair through
  `commit_generation`. No assistant row may exist before acknowledgement is
  accepted, and the shared TypeScript bridge must not acknowledge
  automatically.
- An accepted acknowledgement is the authorization and linearization point
  for appending the complete response once as an immutable assistant child
  whose model records the selected profile model.
- `completed` is sent only after the assistant transaction commits and includes
  the authoritative stored node DTO.
- Provider failure, malformed/truncated stream, cancellation, channel
  disconnect or process exit before acknowledgement, acknowledgement timeout,
  ready-event send failure, or database failure persists no partial assistant
  node. A disconnect after acknowledgement acceptance cannot roll back a
  committing or committed transaction; the frontend reconciles ambiguity from
  authoritative SQLite state.
- If persistence fails after deltas were shown, the operation ends as a typed
  failure and transient output is not represented as durable history.

### MP-7: Generation identity, concurrency, and cancellation

- Rust assigns each accepted operation an opaque `generation_id` used in every
  lifecycle event and cancellation request.
- At most one generation is active per conversation; different conversations
  may generate concurrently.
- A duplicate request for one conversation is rejected before provider I/O and
  does not disturb its active generation.
- The runtime has closed `Running`, `AwaitingCommit`, `Committing`, and
  `Cancelling` phases. The per-conversation slot remains held through
  acknowledgement waiting and commit.
- After `ready_to_commit`, the worker waits at most 30 seconds for the exact
  acknowledgement. Commit, cancellation, and expiry decisions linearize under
  one mutex, including a monotonic deadline check under that lock.
- Cancellation targets an exact generation ID. Unknown/already-terminal IDs
  and a committing generation return `accepted: false` and cannot cancel a
  newer operation.
- A commit token is generation-scoped, one-time, memory-only, never logged or
  persisted, and accepted only while that exact generation is unexpired and
  awaiting commit. Wrong, replayed, expired, not-ready, or committing pairs
  return `accepted: false` without affecting another operation.
- Each accepted operation reaches exactly one internal completed, failed, or
  cancelled state and attempts at most one terminal channel event. Disconnect
  before acknowledgement cancels provider work, persists nothing, and always
  releases registry state. The Rust worker remains the sole terminal sender.

### MP-8: Stable shared IPC contract

- Freeze profile save/load/delete, generation start/cancel/commit, and typed
  `started`/`delta`/`ready_to_commit`/`completed`/`failed`/`cancelled` event
  shapes in a shared fixture.
- Legal event order is `started -> delta* -> ready_to_commit -> terminal`, or
  `started -> delta* -> failed|cancelled`. No delta may follow readiness and no
  completion may precede it.
- The TypeScript bridge validates all command results/errors and every channel
  event from `unknown`; malformed values fail closed to a safe `internal`
  projection with best-effort exact cancellation. It exposes the transient
  readiness projection and `commitGeneration` method but never auto-acks or
  stores commit tokens.
- Existing conversation commands and raw-invoke ownership remain compatible.
- This task owns Rust, the shared fixture/projections, and `src/lib/tauri`; it
  must not modify `src/App.tsx`, Conversation Workspace components, hooks, or
  Zustand store while the frontend worktree is active.
- Provider controls and rendered streaming integration are a separate
  post-merge task consuming this frozen bridge.

### MP-9: Redaction and diagnostics

- API keys, authorization headers, prompts/message content, complete paths,
  raw provider bodies, and database paths never appear in logs or public
  errors.
- Diagnostics use only stable operation/error codes, safe opaque IDs,
  status/retry metadata, durations, and byte/count values.
- Provider and credential source errors retain internal context only after
  checking that their display/debug representations contain no sensitive data.

## Acceptance Criteria

- [ ] A two-sibling fixture produces a provider message sequence equal to the
      selected root-to-active role/content order; the selected sentinel appears
      once and the sibling sentinel never appears.
- [ ] Production request construction cannot accept an arbitrary node vector.
- [ ] Missing-node, wrong-conversation/root, broken-adjacency, and cyclic paths
      emit no provider request and preserve typed fail-closed errors.
- [ ] Archived and non-user-terminal generation emits no provider request.
- [ ] Regenerating from one user creates a new assistant sibling while
      preserving all prior nodes and descendants.
- [ ] A deterministic local HTTP/SSE fixture proves incremental deltas, normal
      completion, malformed/truncated failure, authentication, rate limiting,
      availability/network mapping, cancellation, content bounds, and disabled
      credential-forwarding redirects.
- [ ] Remote HTTPS and exact-loopback HTTP are accepted; remote HTTP, embedded
      credentials, query/fragment values, and deceptive loopback hosts fail.
- [ ] A success persists exactly one complete assistant node and sends
      `ready_to_commit` before persistence, persists only after exact one-time
      acknowledgement, and sends `completed` only after authoritative readback.
- [ ] Before acknowledgement, no assistant row exists; wrong, replayed,
      expired, not-ready, and cross-generation commit tokens return
      `accepted: false` without disturbing live work.
- [ ] Every pre-stream, mid-stream, terminal-parse, cancellation, disconnect,
      ready-send, pre-ack process-exit, acknowledgement-timeout, and
      database-failure path persists no assistant node, reaches one internal
      terminal state, and releases registry state. Post-ack disconnect is
      explicitly reconciled from SQLite rather than treated as rollback.
- [ ] Different conversations stream concurrently; a duplicate request for one
      conversation is rejected through awaiting/commit phases; exact-ID
      cancellation affects only its target; commit-vs-cancel and
      commit-vs-timeout races have one mutex-linearized winner.
- [ ] Provider configuration survives service/application reconstruction while
      database rows, DTOs, fixtures, durable frontend state, errors, and logs
      contain no API key or authorization header.
- [ ] Save/replace/keep/remove/load/delete, locked/missing credential store, and
      every cross-store recovery boundary pass with an injected store.
- [ ] Rust and TypeScript agree on command/event names, field casing, redacted
      profile state, readiness/terminal semantics, exact UUID token validation,
      and malformed-event fail-closed behavior without bridge auto-ack.
- [ ] No App/Conversation component/hook/store change, direct frontend provider
      call, frontend persistence, SQL permission, or second raw invoke owner is
      introduced.
- [ ] Rust formatting, warning-free Clippy, Rust tests, `pnpm check`, Tauri
      info, and debug no-bundle build pass.

## Out of Scope

- Multiple provider families/profiles or provider-specific feature breadth.
- Responses API, tools/tool calls, images, attachments, reasoning controls,
  prompt summarization, token-budget management, and cross-branch references.
- Provider settings UI and App/component/hook/store integration of streaming;
  those follow after the frontend worktree is merged.
- Editing/deleting/reparenting historical nodes, changing archive semantics, or
  redesigning the conversation schema.
- Live paid-provider calls in automated tests or plaintext credential fallback.
