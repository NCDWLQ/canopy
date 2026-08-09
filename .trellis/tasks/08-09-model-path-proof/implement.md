# Model Path Proof — Implementation Plan

## 1. Freeze the provider contract and dependencies

- [ ] Re-read the curated backend/frontend specs and task research before
      editing code.
- [ ] Add the minimum direct Rust dependencies for Rustls HTTP streaming,
      cancellation, SSE decoding, secret redaction, and native keyring access;
      keep versions compatible with the existing Tauri lockfile and Rust
      1.97.1.
- [ ] Define the provider profile requests/results, generation start/cancel
      /commit requests/results, and tagged lifecycle event shapes including
      `ready_to_commit` in a new shared provider fixture without changing the
      existing conversation commands.
- [ ] Record fake malformed events and redacted profile examples; do not place
      an API key or authorization header in the fixture.

Review gate: command names, casing, API-key action semantics, channel terminal
events, and dependency features match `design.md` before storage or HTTP work.

## 2. Add provider profile persistence and secure credentials

- [ ] Add and register `0004_provider_profile.sql` with isolated profile and
      credential-operation intent tables; do not alter conversation DDL.
- [ ] Add provider domain/error types and parameterized repository operations.
- [ ] Implement the injectable `CredentialStore` and production native keyring
      adapter under Rust; wrap blocking native calls appropriately and prevent
      secret `Debug`/serialization.
- [ ] Implement save/load/delete profile services with explicit
      keep/replace/remove semantics and idempotent recovery-intent replay.
- [ ] Validate remote HTTPS and exact-loopback HTTP endpoints, forbid embedded
      credentials/query/fragment, append `chat/completions` structurally, and
      keep credential references private.
- [ ] Add provider profile command DTOs and central safe error mappings.
- [ ] Add real-migration and injected-store tests for normal operations,
      locked/missing stores, compensation, crash boundaries, deletion, and
      proof that no database/DTO/log value contains the sentinel secret.

Review gate: a persisted profile survives service reconstruction, only the fake
credential store contains the API key, and every partial failure is either
reconciled or returned as failure.

## 3. Build the validated Chat Completions adapter

- [ ] Add the provider request builder whose production input is
      `ValidatedPath`; map only supported roles in exact order and require a
      terminal user node.
- [ ] Build one reusable Rust HTTP client with Rustls, redirects disabled, safe
      timeouts, and no logging middleware that can expose bodies or headers.
- [ ] Implement incremental SSE parsing for choice zero, text deltas, normal
      finish, `[DONE]`, provider stream errors, EOF, and the one-MiB accumulated
      content bound.
- [ ] Map status, retry delay, transport, timeout, malformed stream, and
      cancellation failures into the closed provider error taxonomy.
- [ ] Add a deterministic loopback HTTP fixture that captures requests and
      emits arbitrarily chunked SSE; do not call a live provider in tests.
- [ ] Prove the selected branch's ordered sentinel content reaches the outgoing
      request and the sibling sentinel never does.

Review gate: no adapter API accepts a generic node vector, every invalid path
emits no HTTP request, redirects cannot receive authorization, and secrets or
content do not appear in errors/logs.

## 4. Orchestrate generation, cancellation, and assistant persistence

- [ ] Extend the conversation persistence service with a completed-assistant
      append operation that rechecks writable conversation and user-parent
      policy in one transaction and returns authoritative readback.
- [ ] Add the managed generation registry keyed by conversation ID with opaque
      generation IDs, closed Running/AwaitingCommit/Committing/Cancelling
      phases, exact cancellation, and unconditional cleanup.
- [ ] Implement generation preflight: reconcile/load profile and credential,
      load the conversation plus `ValidatedPath`, reject archive/non-user state,
      and reserve the conversation before provider I/O.
- [ ] After successful SSE, create a memory-only one-time UUID v4 token, arm a
      30-second monotonic deadline, send `ready_to_commit`, and persist only
      after the exact acknowledgement wins under the registry mutex.
- [ ] Linearize commit/cancel/expiry under one mutex with the deadline checked
      under lock; ack winner enters Committing, while cancel/expiry winner
      forbids the write and rejects later acknowledgements.
- [ ] Keep the worker as sole Channel/response/terminal owner. Send one safe
      failed/cancelled terminal event when possible; pre-ack disconnect,
      process exit, ready-send failure, or timeout persists nothing. Capture
      that post-ack disconnect cannot undo a committing/committed transaction.
- [ ] Register generate/cancel/commit commands and managed runtime in the Tauri
      builder while preserving all existing command registrations.
- [ ] Test concurrent different conversations, duplicate same-conversation
      rejection through awaiting/commit, no row before ack, exact one-shot ack,
      wrong/replay/not-ready/expired tokens, commit-vs-cancel and
      commit-vs-timeout, timeout cleanup, ready send failure, disconnect,
      archive/database failure after ack, terminal-send ambiguity, and
      successful regenerated assistant sibling creation.

Review gate: every accepted operation has one internal terminal state, no
failure persists a partial node, and all registry slots are released.

## 5. Implement the shared TypeScript bridge

- [ ] Add provider/generation frontend projection types outside Antigravity's
      Conversation Workspace ownership.
- [ ] Add strict Zod schemas for every provider request/result and generation
      event, including exact UUID generation/token fields, transient readiness,
      redacted profile state, and authoritative completed node.
- [ ] Reuse one raw invoke transport under `src/lib/tauri`; add a provider client
      that constructs `Channel<unknown>` and validates before callbacks.
- [ ] Normalize malformed command failures and malformed channel events to safe
      `internal` failures; request exact-ID cancellation where possible.
- [ ] Expose `commitGeneration` and the transient `ready_to_commit` projection;
      track `awaiting_commit`, reject deltas after readiness and completion
      before readiness, and never auto-ack or persist a token.
- [ ] Test command shapes, profile projection, event ordering, malformed
      payloads, API-key non-echo, commit wrapper/false result, exact malformed
      cancellation, no auto-ack, and the shared fixture.
- [ ] Audit that no App, Conversation Workspace component/hook/store, raw
      provider request, frontend persistence, or second raw invoke owner was
      added.

Review gate: the bridge is usable by the later UI integration task without
importing provider JSON/SSE details or exposing credentials.

## 6. Full verification and review

- [ ] Run targeted Rust provider/config/generation tests while iterating.
- [ ] Run targeted TypeScript bridge tests while iterating.
- [ ] Run the complete Rust and frontend quality gates below.
- [ ] Run static boundary/redaction scans and inspect every hit manually.
- [ ] Run an independent Trellis check sub-agent with the curated check
      manifest; verify findings against actual trust boundaries and fix all
      confirmed critical/warning issues.
- [ ] Update relevant backend/frontend specs through `trellis-update-spec` with
      the executable provider, credential, streaming, and bridge contracts.
- [ ] Re-run the full gates after the last fix/spec-driven code change.
- [ ] Present the changed-file scope and proposed commit plan to the user before
      committing.

## Validation Commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm check
pnpm tauri info
pnpm tauri build --debug --no-bundle
```

Static inspection gates:

```bash
rg -n "invoke\(" src --glob '!src/lib/tauri/**'
rg -n "@tauri-apps/plugin-sql|sql:allow-(select|execute)" src src-tauri/capabilities
rg -n "println!|dbg!|console\." src src-tauri/src
rg -n "api[_-]?key|authorization|bearer" src src-tauri contract-fixtures
```

The final scan is an inspection gate, not a zero-hit assertion: legitimate
field names and redaction tests are expected, but secret values, logging, DTO
responses, fixtures, and frontend persistence are not.

## Risky Files and Rollback Points

- `src-tauri/Cargo.toml` / `Cargo.lock`: dependency or native-platform build
  regressions. Roll back the dependency set before weakening TLS/keyring rules.
- `0004_provider_profile.sql` / migration catalog: preserve the additive
  migration ordering; after it is applied, use a forward repair migration
  rather than rewriting released history.
- provider credential service: never replace a failing native keyring with a
  plaintext fallback. Recovery intents are the rollback/retry mechanism.
- conversation assistant append: keep it separate from existing user append
  policy and do not loosen immutable-history constraints.
- Tauri command registration/runtime: preserve the seven existing conversation
  commands and builder constructibility tests.
- shared fixtures/bridge: if wire shapes change, update Rust serialization,
  Zod decoding, and tests together; do not update Antigravity-owned UI files.

## Follow-up Integration Gate

After `frontend-workspace` is committed and merged, create a separate Trellis
task for provider settings controls, generation actions, transient streaming
state, and rendered assistant completion. That task consumes the frozen client
from this task and is not part of this implementation approval.
