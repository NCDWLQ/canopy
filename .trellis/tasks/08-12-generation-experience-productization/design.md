# Technical Design

## Boundaries

This is a frontend-only change across the conversation generation store,
workspace controller, and message presentation. The typed provider bridge,
Channel DTOs, Rust generation runtime, commit protocol, SQLite schema, and
conversation commands remain unchanged.

Ownership remains:

- the conversation Zustand store owns the closed transient lifecycle and exact
  authoritative merge;
- `useWorkspaceGenerationController` owns timer/callback orchestration,
  automatic acknowledgement, and SQLite reconciliation;
- conversation components own user-facing copy and visual projection;
- SQLite and exact `completed.node` remain the only authorities for durable
  conversation history.

## Generation terminal state model

Extend terminal transient state just enough to preserve presentation and
derive recovery behavior without persisting anything:

- `failed` carries a `failureKind: "generation" | "persistence"`, the safe
  `UiError`, and content only for persistence failure. `failGeneration`
  derives the kind from the prior state: failures from
  `committing`/`reconciling` are persistence failures; failures from
  `starting`/`streaming` are generation failures. Message text is never parsed.
- persistence failure retains the exact completed stream content; generation
  failure does not retain partial output and presents only the generic
  “回复失败” outcome rather than storage terminology.
- `cancelled` retains the current streamed content (or an empty string when
  cancelled before the first delta) so the same bubble can display
  “回复已停止”.
- `reconciling` adds an explicit recovery-action state such as
  `needsUserAction`. It is false during the first automatic reload and becomes
  true only when the reload fails or returns without one provable completion.
  A manual retry clears it while the next reload is in flight.

No terminal variant contains a commit token or a durable node identity that did
not come from the backend.

## Delayed reconciliation flow

Use the existing injectable `reconciliationDelayMs` (default 1,500 ms) as the
single terminal-delivery grace constant.

1. Exact `ready_to_commit` validates the run and changes it to `committing`.
2. The callback passes the token directly to `commitGeneration` once.
3. Whether acknowledgement returns accepted or the call throws an ambiguous
   transport error, schedule reconciliation while leaving the visible/store
   phase `committing` during the grace interval. A timer closure may retain the
   safe ambiguity error; it must not retain the token.
4. An exact `completed` or explicit post-ready `failed` event clears the timer
   and terminalizes normally.
5. If the timer expires first, transition to `reconciling` with
   `needsUserAction: false`, preserve content, and immediately begin one
   authoritative `loadConversationTree`.
6. A single exact new assistant completes normally. No match or a load error
   preserves `reconciling` and content, sets `needsUserAction: true`, and
   enables “重试恢复”. Multiple matches are never guessed.

This keeps internal reconciliation prompt but not instantly visible: the first
visible recovery state can only occur after the existing grace interval.

## Ordinary assistant message projection

Extract or introduce one feature-local, identity-free message bubble shell used
by both durable `MessageNode` and transient generation presentation. It owns
the shared assistant article structure, role heading, content region, and
optional footer/action region; it knows nothing about nodes, Zustand, or IPC.

The generation projection stays appended after the durable active path and is
never added to the outline:

| Phase | Bubble projection |
|---|---|
| `starting` | assistant bubble with “正在思考” |
| `streaming` | same bubble with accumulated content and no engineering status |
| `committing` | same complete content, no status or badge |
| `reconciling` | same content plus “正在恢复这条回复…”; no button during automatic reload |
| generation `failed` | same assistant slot, “回复失败”, “重新生成” |
| persistence `failed` | full content plus “这条回复未能保存”, “重新生成” |
| `cancelled` | partial content plus “回复已停止” |
| `completed` | transient projection disappears in the same atomic render in which the exact authoritative node occupies the same list position using the shared shell |

Do not render `Not saved`, transient badges, save/commit copy, warning styling
for ordinary reconciliation, or a distinct transient aria label. Accessible
status text remains polite; buttons have exact visible names and operate through
the controller.

## Recovery actions

- “重新生成” calls the existing controller `generate` intent. Because the
  active parent remains the authoritative user node and terminal generation
  states are inactive, this starts a new run without pretending to resubmit the
  old stream.
- “重试恢复” calls the existing SQLite reconciliation path. It is rendered only
  when `needsUserAction` is true and is disabled/hidden again while that reload
  is running.
- Cancellation has no error toast and no mandatory action.

## Data and security invariants

- Deltas and all retained terminal content remain under `generation`; they do
  not enter `nodesById`, `fullNodes`, path selectors, browser persistence, or
  SQLite.
- Only exact completion or authoritative reload changes the durable projection.
- `commitToken` flows only from the validated event into the callback-local
  commit call. New timers, state variants, view models, props, copy, and tests
  must not add a token field or log it.
- User-visible branching depends on the prior generation phase and explicit
  recovery flags, never on matching backend error-message strings.

## Compatibility and rollback

There is no wire or data migration. The change can be rolled back in three
separable units: terminal-state enrichment, controller recovery timing, and
shared message presentation. Rollback must not touch the backend acknowledgement
or authoritative-merge contract. The main risks are losing an exact terminal
event while delaying reconciliation, leaving a timer alive after terminal
completion/unmount, or showing a recovery button during automatic work; focused
fake-timer and race tests guard each point.
