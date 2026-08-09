# Research: Strict pre-commit acknowledgement protocol

- Query: What is the smallest concrete two-phase protocol that prevents assistant-node persistence until the frontend explicitly acknowledges the exact generation with a one-time token, while defining timeout, disconnect, cancellation, linearization, errors, channel lifetime, and the Antigravity-owned UI boundary?
- Scope: internal / external / mixed
- Date: 2026-08-09

## Findings

### Recommendation

Add one non-terminal channel event and one command; keep the pending response
only in Rust memory:

```text
event ready_to_commit {
  generation_id: string,
  commit_token: string
}

command commit_generation({
  generation_id: string,
  commit_token: string
}) -> { accepted: boolean }
```

The feature-layer projection should expose the same event as
`{ type: "ready_to_commit", generationId, commitToken }`, and the typed client
should expose
`commitGeneration(generationId, commitToken): Promise<{ accepted: boolean }> `.
Do not auto-acknowledge in `provider-client.ts`: the later Antigravity UI must
call `commitGeneration` only after it has accepted the complete transient
stream into its current generation state. A separate command is the smallest
real backchannel because a Tauri `Channel` callback returns no value.

`commit_token` should be a fresh UUID v4 (already available in the Rust
dependency set), scoped to one generation, held only in the in-memory runtime,
sent only in `ready_to_commit`, consumed atomically on the first accepted
command, and never stored or logged. Validate it as an actual UUID at both the
Rust DTO boundary (`Uuid::parse_str`) and Zod boundary rather than accepting an
arbitrary nonblank ID. A replay, wrong generation/token pair,
expired token, already-committing generation, or terminal generation returns
`{ accepted: false }` and does not disturb any live/newer generation.

No migration or pending database table is needed. Process/app exit while
waiting loses the pending response and therefore writes no assistant.

### Why the current code does not satisfy the strict protocol

- `GenerationLease::begin_commit()` changes `cancellable` to false, but it has
  no frontend acknowledgement input (`src-tauri/src/providers/generation.rs:96-116`).
- A successful provider stream calls `begin_commit()` and immediately calls
  `append_completed_assistant` (`src-tauri/src/providers/generation.rs:199-223`).
- The command currently has only generate/cancel DTOs and events; `completed`
  is the first post-stream confirmation (`src-tauri/src/providers/commands.rs:68-117`).
- The channel worker persists before it constructs and sends `completed`
  (`src-tauri/src/providers/commands.rs:231-258`).
- The TypeScript bridge accepts `started -> delta* -> completed` and exposes no
  acknowledgement method (`src/lib/tauri/provider-client.ts:101-215`,
  `src/lib/tauri/provider-client.ts:260-289`).

The existing conversation append transaction remains correct and reusable: it
rechecks conversation writability and the user parent, inserts once, commits,
and returns authoritative readback (`src-tauri/src/conversations/service.rs:251-293`).
Only its call timing must move behind the accepted acknowledgement.

### Minimal Rust state machine

Keep one registry entry per conversation, but replace the boolean
`cancellable` flag with a closed phase:

```text
Running {
  cancellation_token
}
  -- successful SSE + ready send -->
AwaitingCommit {
  generation_id,
  one_time_commit_token,
  monotonic_deadline,
  acknowledgement_sender
}
  -- exact commit command wins --> Committing
  -- exact cancel or deadline wins --> Cancelling

Committing -- DB result --> Completed | Failed
Cancelling -------------> Cancelled
```

The spawned generation worker remains the sole owner of the channel and
response content. After valid SSE completion it creates a Tokio one-shot,
arms `AwaitingCommit`, successfully sends `ready_to_commit`, and waits for the
one-shot with a fixed backend timeout (recommend 30 seconds). The one-MiB
content and selected model/parent remain only in that worker. The per-
conversation slot remains occupied through `AwaitingCommit` and `Committing`,
so a second generation cannot bypass the pending acknowledgement.

Use a monotonic deadline stored in the entry. The commit command must compare
the deadline while holding the registry mutex; it must not rely only on when a
timer task happens to wake, otherwise a delayed timer could accept a nominally
expired token. Add a direct Tokio `sync`/`time` dependency (and `test-util` for
paused-time tests) rather than wall-clock sleeps.

Arm `AwaitingCommit` and call the `ready_to_commit` send while holding the same
short registry lock. This closes two races:

1. a synchronous/very fast frontend acknowledgement cannot arrive while the
   runtime still says `Running`;
2. cancel cannot linearize before the ready send and then be followed by a
   stale ready event.

The send does not await provider/network/database work and is a bounded IPC
enqueue/eval call. If the ready send fails, transition to cancellation, drop
the one-shot sender, persist nothing, attempt no completed event, and release
the lease.

### Commit/cancel/timeout linearization

All three decisions mutate the exact registry entry under the same mutex:

- `commit_generation`: only an unexpired `AwaitingCommit` entry with both the
  exact `generation_id` and token can transition to `Committing`. It takes the
  one-shot sender and token before waking the worker. This is the one-time
  consumption/linearization point; return `accepted: true` only for it.
- `cancel_generation`: `Running` or `AwaitingCommit` transitions to
  `Cancelling`, cancels the provider token, and drops the acknowledgement
  sender. It returns true. `Committing` returns false.
- acknowledgement timeout: under the same lock, an unexpired
  `AwaitingCommit` transition is no longer allowed once the monotonic deadline
  is reached; the timeout path transitions it to `Cancelling`, drops the
  sender/token, and wakes cleanup. If commit already changed the phase to
  `Committing`, timeout loses and must not cancel persistence.

Therefore exactly one result is possible at the boundary:

| Race | Winner | Loser result | Assistant write |
|---|---|---|---|
| commit vs cancel | `AwaitingCommit -> Committing` | cancel `accepted: false` | permitted |
| cancel vs commit | `AwaitingCommit -> Cancelling` | commit `accepted: false` | forbidden |
| commit vs deadline | transition under mutex before deadline | timeout is ignored | permitted |
| deadline vs commit | expiry transition under mutex | commit `accepted: false` | forbidden |
| replay vs any state | token already consumed/absent | commit `accepted: false` | no second write |

After the worker receives the accepted acknowledgement, it alone calls
`append_completed_assistant`. The existing transaction revalidates archive and
parent role at commit time. It then attempts exactly one `completed` or
`failed` terminal event and drops the lease on every path.

### Timeout, disconnect, and Channel lifecycle

- Before provider completion, existing delta send failure maps to cancellation
  and writes nothing (`src-tauri/src/providers/openai_compatible.rs:104-183`,
  `src-tauri/src/providers/commands.rs:231-240`).
- After provider completion but before acknowledgement, a failed
  `ready_to_commit` send cancels immediately. If the webview disappears after
  the send reports success, Tauri exposes no positive receiver acknowledgement
  or JavaScript `Channel.unregister()` method in the installed 2.11 API. The
  frontend must explicitly call cancel on unmount/navigation when possible;
  the 30-second backend acknowledgement timeout is the mandatory fallback.
- A timeout is an application cancellation, not a provider/network failure:
  emit `cancelled`, persist nothing, and do not add a new public error code.
  A caller that invokes commit after timeout receives `{ accepted: false }`.
- Keep the Rust `Channel` in the spawned worker until a terminal send attempt.
  In installed Tauri 2.11.5, channel clones share an `Arc`; dropping the last
  Rust clone emits an end marker to JavaScript, while JavaScript orders messages
  by an incrementing index (`tauri-2.11.5/src/ipc/channel.rs:49-85`,
  `tauri-2.11.5/src/ipc/channel.rs:132-193`,
  `node_modules/@tauri-apps/api/core.js:74-119`). Do not move the channel into
  the registry or send terminal events from cancel/commit commands; the single
  worker owner preserves event order and at-most-one terminal attempt.
- `Channel::send` returning success only proves that Rust serialized and asked
  the webview to evaluate/deliver the callback
  (`tauri-2.11.5/src/ipc/channel.rs:142-184`,
  `tauri-2.11.5/src/ipc/channel.rs:291-297`). It is not proof that the
  JavaScript callback processed the value. The explicit commit command is the
  only positive proof that the frontend processed `ready_to_commit`.

### Event order and TypeScript behavior

The strict closed sequence becomes:

```text
started -> delta* -> ready_to_commit -> completed
started -> delta* -> ready_to_commit -> failed | cancelled
started -> delta* -> failed | cancelled
```

No delta is valid after `ready_to_commit`; no `completed` is valid without a
preceding `ready_to_commit`. The bridge continues to validate every value from
`unknown`, tracks a new `awaiting_commit` phase, and exposes the token only in
the transient event projection. Malformed/out-of-order ready events, identity
mismatch, deltas after ready, or a completed event before ready produce one
local `internal` failure and exact-ID cancellation, exactly like the current
fail-closed path (`src/lib/tauri/provider-client.ts:117-171`). The bridge must
not auto-commit, write the token to browser storage/Zustand, or touch App/UI.

The UI integration contract for the later Antigravity task is:

1. render/accumulate deltas as transient state;
2. on a valid `ready_to_commit`, verify that this is still the current exact
   generation and that its transient response was accepted locally;
3. call `commitGeneration(generationId, commitToken)` once;
4. treat `{ accepted: false }` as not committed and wait for/handle terminal
   cancellation, or reconcile on an ambiguous transport result;
5. add durable UI history only from authoritative `completed.node` or a fresh
   conversation-tree reload.

This respects the current ownership boundary: the task owns Rust, fixture,
provider projections, and `src/lib/tauri`, while App/components/hooks/Zustand
remain untouched (`.trellis/tasks/08-09-model-path-proof/prd.md:129-141`).

### Error mapping

| Condition | Command/event behavior |
|---|---|
| Blank/invalid generation ID or token | command rejects `invalid_input`; no state change |
| Unknown generation, wrong token, replay, not-ready, expired, terminal, or committing | `commit_generation` succeeds with `{ accepted: false }`; do not cancel another operation |
| Ready send failure | internal outcome `Cancelled`; no write; best-effort `cancelled` only if channel still usable |
| User cancel or acknowledgement timeout before commit wins | one `cancelled` terminal attempt; no write |
| Provider failure before ready | existing typed `failed`; no token and no write |
| Archive/parent/database failure after accepted acknowledgement | existing `invalid_input` / `not_found` / `database_unavailable` / safe `internal` mapping in `failed`; no partial write |
| Registry/one-shot invariant failure | add/use an internal provider-runtime error mapped to safe non-retryable `internal`, never `provider_unavailable` |
| Completed send failure after database commit | no rollback; lease cleanup; frontend must reconcile from SQLite |

The `accepted` boolean is a linearization result, not proof of database commit.
Only `completed.node` or a later load proves durable success. This matches the
central rule that errors are stable DTOs and malformed IPC becomes `internal`
(`.trellis/spec/backend/error-handling.md:61-94`,
`.trellis/spec/backend/error-handling.md:113-119`).

### Exact files to change

Production/runtime contract:

- `src-tauri/src/providers/generation.rs` — replace `cancellable`/
  `begin_commit` with the phased registry; add exact acknowledgement,
  one-shot wait, monotonic timeout, one-time token consumption, and terminal
  cleanup.
- `src-tauri/src/providers/commands.rs` — add commit request/result DTOs,
  `commit_generation`, `ready_to_commit`, command name, and ready-event closure;
  retain one worker as sole channel sender.
- `src-tauri/src/providers/error.rs` and `src-tauri/src/error.rs` — add the
  narrow internal runtime-invariant mapping if the state machine can fail
  independently of provider availability; do not add a timeout code.
- `src-tauri/src/lib.rs` — register `commit_generation` alongside generate and
  cancel.
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` — add direct Tokio
  `sync`/`time` features and test-time paused-clock support if the implementation
  uses Tokio one-shot/timeout directly.
- `contract-fixtures/provider-ipc.json` — add the command, request/result,
  `ready_to_commit` before completed, a fake token, and malformed/wrong-order
  ready examples.
- `src/features/providers/types/index.ts` — add the transient ready projection
  and commit result type. It remains outside Antigravity's conversation UI.
- `src/lib/tauri/provider-schemas.ts` — strict commit request/result and ready
  event schemas.
- `src/lib/tauri/provider-client.ts` — expose `commitGeneration`, add the
  `awaiting_commit` transition, validate exact generation/token, and preserve
  fail-closed cancellation.

Tests:

- `src-tauri/src/providers/generation.rs` unit tests — no row before ack;
  exact pair accepted once; wrong/replayed pair false; same-conversation slot
  retained; cancel-vs-commit and timeout-vs-commit winner semantics; paused-time
  cleanup; ready-send failure; DB/archive failure after ack; slot released on
  every outcome; committed node survives terminal-send failure.
- `src-tauri/tests/provider_contract.rs` — Rust round-trip of the added command,
  result, ready event, and malformed examples.
- `src/lib/tauri/provider-client.test.ts` — exact command wrapper; no automatic
  acknowledgement; ready projection; legal/illegal event order; malformed
  ready exact cancellation; replay/false response; completed can arrive after
  acknowledgement even before its invoke promise resolves; ambiguous commit
  response maps to `internal` and requires reload/reconciliation guidance.
- `src-tauri/tests/generation_persistence.rs` — keep the existing transaction
  policy tests; add only a public-boundary assertion if needed that archive
  recheck after an accepted ack still leaves no new node.

No change is needed in `src/App.tsx`, components, hooks, conversation store,
provider HTTP/SSE parsing, migration SQL, or the provider profile/credential
service.

### Files found

- `.trellis/tasks/08-09-model-path-proof/prd.md` — current persistence,
  disconnect, IPC, and Antigravity ownership requirements.
- `.trellis/tasks/08-09-model-path-proof/design.md` — current immediate-commit
  runtime and channel design.
- `.trellis/tasks/08-09-model-path-proof/implement.md` — current implementation
  and verification plan.
- `.trellis/tasks/08-09-model-path-proof/research/provider-streaming-and-credentials.md`
  — dependency versions and prior Tauri Channel/cancellation research.
- `.trellis/spec/backend/provider-guidelines.md` — current `begin_commit`
  linearization and completion contract.
- `.trellis/spec/backend/error-handling.md` — stable error taxonomy and trust
  boundary.
- `.trellis/spec/frontend/type-safety.md` — current five-command/event-order
  bridge contract.
- `.trellis/spec/frontend/state-management.md` — durable SQLite versus transient
  UI state ownership.
- `src-tauri/src/providers/generation.rs` — current registry, lease, immediate
  persistence, and runtime tests.
- `src-tauri/src/providers/commands.rs` — Rust DTOs, commands, Channel worker,
  and terminal event construction.
- `src-tauri/src/conversations/service.rs` — authoritative assistant append
  transaction and archive/parent rechecks.
- `src-tauri/src/providers/openai_compatible.rs` — provider streaming,
  cancellation, delta callback, and bounded accumulated content.
- `src-tauri/src/providers/error.rs` and `src-tauri/src/error.rs` — provider and
  public command error mappings.
- `src-tauri/src/lib.rs` — Tauri command registration and managed runtime.
- `contract-fixtures/provider-ipc.json` — shared provider commands/results/events.
- `src/features/providers/types/index.ts` — public frontend provider projections.
- `src/lib/tauri/provider-schemas.ts` — Zod wire validation.
- `src/lib/tauri/provider-client.ts` — raw invoke owner and lifecycle validator.
- `src-tauri/tests/provider_contract.rs`,
  `src-tauri/tests/generation_persistence.rs`, and
  `src/lib/tauri/provider-client.test.ts` — affected contract/persistence/bridge
  tests.

### External references

- Tauri 2 calling Rust / Channels (channels are the recommended ordered
  streaming mechanism): https://v2.tauri.app/develop/calling-rust/
- Tauri 2.11.5 `Channel` API: https://docs.rs/tauri/2.11.5/tauri/ipc/struct.Channel.html
- Tauri 2.11.5 channel source (send, ordering index, last-clone drop/end marker):
  https://docs.rs/tauri/2.11.5/src/tauri/ipc/channel.rs.html
- Installed JavaScript implementation inspected at
  `node_modules/@tauri-apps/api/core.js:74-119`; it orders indexed messages and
  unregisters the callback on the Rust end marker, but exposes no public
  Channel unregistration/receiver-ack API.

### Related specs

- `.trellis/spec/backend/provider-guidelines.md:15-72`
- `.trellis/spec/backend/error-handling.md:47-119`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/frontend/type-safety.md:172-244`
- `.trellis/spec/frontend/state-management.md:15-27`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Caveats / Not Found

- The current PRD/design/specs say provider success commits immediately and
  define disconnect as persisting nothing
  (`prd.md:103-127`, `design.md:216-224`,
  `backend/provider-guidelines.md:65-72`). The selected strict protocol changes
  that contract: a successful provider stream is only *ready*, and persistence
  is allowed only after acknowledgement. Those artifacts/specs must be revised
  by the owning main/update-spec flow before this is considered spec-compliant;
  this research role did not edit them.
- After `commit_generation` returns/linearizes `accepted: true`, it is
  impossible to guarantee all three of: durable commit, no persistence after a
  later webview disconnect/cancel, and guaranteed delivery of `completed`.
  SQLite commit and webview IPC are not one atomic transaction. The chosen
  rule must be: acknowledgement acceptance authorizes persistence; later cancel
  returns false; completed delivery is best effort; reload from SQLite resolves
  ambiguity.
- If the webview sends a valid commit command and crashes before receiving its
  response, the backend may persist even though the frontend cannot know
  whether acceptance occurred. At-most-once token consumption prevents a
  duplicate insert but makes blind retry return false; reconciliation must load
  authoritative conversation state.
- Tauri Channel send success is not receiver processing acknowledgement, and
  the installed JS Channel has no public explicit close/unregister method.
  Therefore pre-ack disconnect detection cannot be immediate in all cases;
  explicit cancel plus the backend deadline is required.
- A process crash after acknowledgement and during the SQLite transaction can
  yield either no node or one complete node according to SQLite atomicity. It
  cannot yield a partial node, but the frontend must reload to learn which
  outcome occurred.
- Per research-role isolation, `implement.jsonl` and `check.jsonl` were not
  opened. Findings use the task PRD/design/implement documents, relevant specs,
  source, tests, installed dependency source, and official Tauri documentation.
