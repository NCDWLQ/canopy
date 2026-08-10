# Provider Generation Workspace Integration — Implementation Plan

## 1. Confirm boundaries and add shadcn primitives

- [ ] Re-read the curated frontend/backend specs and integration research.
- [ ] Run repository-pinned shadcn info/docs/search, dry-run, and per-file diff
      for Dialog, Field, Input, Alert, Badge, Spinner, AlertDialog, and the
      selected chat primitives.
- [ ] Add only reviewed primitives; preserve the customized Button and replace
      registry icon placeholders with Lucide using `data-icon` conventions.
- [ ] Confirm the dependency diff introduces no duplicate UI/runtime stack.

Review gate: no product behavior changes yet, generated source matches the
Radix Nova/Tailwind 4 project, and Button remains byte-for-byte intentional.

## 2. Add the redacted provider profile store

- [ ] Add the non-persisted closed profile state and injected-client
      load/save/delete actions under `features/providers/store`.
- [ ] Normalize missing profile to `unconfigured`; preserve the last safe
      redacted projection on other failures while generation fails closed.
- [ ] Ensure action inputs are not retained and no API-key/token-shaped value
      can enter any store field.
- [ ] Add store tests for load, missing, save, delete, failure preservation,
      concurrent/stale result handling, and secret absence.

Review gate: profile state contains only the bridge's redacted projection and
safe errors; local conversation behavior is independent of provider status.

## 3. Add the generation state machine and authoritative merge

- [ ] Extend the conversation store with a closed transient generation union,
      UI run identity, exact event reducers, synchronous invalidation, and
      narrow selectors.
- [ ] Keep deltas outside durable normalized node records and active-path
      output.
- [ ] Implement strict completed-node validation and atomic authoritative merge
      without weakening existing user-node mutation policy.
- [ ] Add authoritative whole-tree replacement for ambiguous reconciliation,
      preserving safe selection and avoiding ambiguous child guesses.
- [ ] Add store tests for every legal transition, stale/duplicate event,
      sibling exclusion, no pre-ack node, exact merge, malformed completion,
      failure preservation, and archive guards.

Review gate: only exact `completed.node` or a reloaded tree changes durable
records; transient content and commit tokens are absent from durable selectors.

## 4. Implement the workspace generation controller

- [ ] Add the injected-client controller hook that computes capability and
      owns start, callback dispatch, automatic commit, exact cancellation,
      navigation/archive/replacement coordination, and unmount cleanup.
- [ ] On ready, validate the current UI run/path/parent/content, change to
      committing, and pass the callback-local token directly to commit.
- [ ] Record pre-start cancel intent and send exact cancellation as soon as
      `started` or the command result reveals the generation ID.
- [ ] Keep exact Channel terminal delivery active after commit transport
      ambiguity; otherwise perform bounded SQLite reload/reconciliation.
- [ ] Test commit/cancel/navigation/timeout/terminal races with injected clients
      and controlled promises; assert no automatic commit for stale state.

Review gate: one UI run can acknowledge at most once; pre-ack invalidation wins
locally before navigation, while post-ack ambiguity never fabricates success.

## 5. Build provider settings UI

- [ ] Add the compact Provider header action and accessible Dialog with
      endpoint/model/key fields, redacted summary, typed error/status feedback,
      and key presence badge.
- [ ] Implement exact keep/replace/remove mapping. Clear the key field on close
      and after every save attempt; never echo it in errors or confirmation.
- [ ] Add AlertDialog profile deletion and missing/keyring/provider error
      states.
- [ ] Make provider mutations read-only for archived conversations and while a
      generation is active, while keeping configuration available in the empty
      workspace.
- [ ] Add behavioral tests for create/update/remove/delete, focus management,
      keyboard operation, mutation guards, and DOM/store secret absence.

Review gate: the dialog exposes only redacted durable state and matches the
frozen singleton-profile semantics.

## 6. Integrate streaming, cancel, and conversation presentation

- [ ] Replace the disabled placeholder with capability-aware Generate/Cancel
      controls and clear unavailable reasons.
- [ ] Render exactly one transient assistant response outside the durable path
      and outline; distinguish streaming, committing, failed, cancelled, and
      reconciliation states accessibly.
- [ ] Wire selection, create/load replacement, archive, and unmount through the
      controller cancellation boundary. Disable conflicting mutations during
      committing/reconciliation.
- [ ] Integrate reviewed MessageScroller/Message/Bubble primitives without
      changing root-to-active semantics or visualizing siblings in the path.
- [ ] Preserve semantic tree keyboard behavior, visible focus, desktop layout,
      accessible icon names, and reduced-motion behavior.
- [ ] Expand workspace tests for capability matrix, transient rendering,
      Generate/Cancel, sibling sentinel exclusion, archive readability, and
      authoritative completion.

Review gate: the visible response and tree agree with SQLite authority at every
durable boundary; no synthetic assistant appears for a new conversation.

## 7. Integration verification

- [ ] Run focused provider store, conversation store/controller, component,
      and bridge tests while iterating.
- [ ] Run the deterministic local loopback SSE integration through the strict
      ready/commit/completed path.
- [ ] Run all validation commands and inspect the final dependency/source diff.
- [ ] Run static raw-invoke, SQL capability, browser persistence, unsafe type,
      log, API-key, authorization, and commit-token scans; manually review each
      expected hit.
- [ ] Validate both Trellis JSONL manifests and run an independent Trellis
      check sub-agent; fix every confirmed issue and rerun affected/full gates.
- [ ] Use `trellis-update-spec` for durable provider UI/generation lifecycle
      contracts learned during implementation.
- [ ] Present final changed-file scope and commit plan for user confirmation;
      commit only after confirmation, then run `trellis-finish-work`.

## Validation commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test -- --run
pnpm build
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm tauri info
pnpm tauri build --debug --no-bundle
python3 ./.trellis/scripts/task.py validate 08-09-generation-workspace-integration
git diff --check
```

Static inspection gates:

```bash
rg -n "invoke\(" src --glob '!src/lib/tauri/**'
rg -n "localStorage|sessionStorage|IndexedDB|persist\(" src
rg -n "@tauri-apps/plugin-sql|sql:allow-(select|execute)" src src-tauri/capabilities
rg -n "api[_-]?key|authorization|bearer|commit[_-]?token" src src-tauri contract-fixtures
rg -n "console\.|println!|dbg!|as unknown as|@ts-ignore|@ts-expect-error" src src-tauri/src
```

Secret/token and log scans are inspection gates rather than zero-hit
assertions. Legitimate request field names and redaction tests are expected;
values in store snapshots, DOM output, logs, errors, or durable storage are not.

## Risky files and rollback points

- `package.json` / `pnpm-lock.yaml` and generated UI primitives: inspect each
  registry diff and roll back additions rather than overwriting local Button or
  accepting a duplicate UI stack.
- conversation store: preserve fail-closed structural validation and existing
  user mutation semantics. Roll back generation reducers independently if they
  contaminate durable records.
- controller hook: stale callback and commit ambiguity are correctness
  boundaries. Prefer a visible retry/reload state over guessing success.
- provider dialog: never move API-key input into global state to simplify form
  handling.
- frozen bridge/backend: stop and record a dependency if an exact behavior is
  unavailable; do not widen raw invoke access or change the strict commit
  protocol inside this frontend integration task.
