# Frontend Hook Guidelines

> Rules for extracting React stateful behavior without hiding domain boundaries.

## Current State

`useWorkspaceGenerationController` coordinates the typed provider Channel,
conversation selection, per-conversation mutation locking, exact cancellation,
terminal result handling (foreground inline, background via toast), and
one-shot authoritative reloads. Keep this lifecycle under
`features/conversations/hooks`; do not move it into a generic root hook or
duplicate it in components.

## When to Create a Hook

Create a hook when at least one of these is true:

- stateful React behavior is reused by more than one component;
- a component has a cohesive effect/subscription lifecycle worth testing in
  isolation;
- a narrow Zustand selector needs a stable component-facing API;
- a feature action coordinates UI lifecycle around a typed bridge call.

Keep one-off event handlers and pure transformations as ordinary functions.
Pure tree projections belong in selectors, not hooks, so they can be tested
without React.

## Location and Naming

- Feature hooks live with their feature, for example
  `src/features/conversations/hooks/useActiveConversation.ts`.
- `src/hooks` is only for behavior shared across features.
- Hook names and filenames start with `use` and describe the returned concept,
  not the implementation mechanism.
- Export an explicit result type when the hook crosses a feature boundary or
  returns a state machine.

## Zustand Hooks

- Components subscribe through narrow selectors rather than receiving the
  whole store.
- Keep selectors pure and exported from the store module; a hook may compose
  them but must not duplicate traversal logic.
- Do not construct a second conversation tree inside component-local state.
- The visible active path must come from the single validated store projection
  and preserve root-to-active ordering.

```ts
const activeNodeId = useConversationStore(selectActiveNodeId)
const activePath = useConversationStore(selectActivePath)
```

## Effects and Tauri Calls

- Hooks never call raw `invoke`; they call typed bridge functions that validate
  unknown results.
- Include every effect dependency. Do not suppress configured hook lint rules.
- Effects that start asynchronous work must handle stale completion and exact
  cancellation explicitly.
- Channel callbacks and the long-lived command promise may resolve in either
  order. Gate both with the current `runId`; a late terminal result for the
  exact current run is valid, not a cancellation condition.
- The hook accepts only `started`/`delta` Channel events and a separate
  `completed`/`cancelled`/`failed` terminal result. It never invents a durable
  assistant from deltas.
- User cancellation is permitted only in `starting` or `streaming`, for the
  currently loaded conversation. Runs are never cancelled by controller
  unmount or by switching conversations — they stream in the background and
  outlive the hook instance (the run registry lives in the store).
- A malformed callback or terminal result fails closed. If a known exact ID is
  available, cancel it; never cancel an ID taken from an unvalidated payload.
  A guard mismatch means protocol corruption, not "the user navigated away" —
  event guards validate against the run record in the store registry, never
  against the currently visible tree.
- An invoke rejection after `started` is ambiguous. Reload authoritative
  conversation state at most once for that run, and preserve a safe existing
  projection if reload cannot prove one exact assistant.
- Do not use an effect to derive values that can be computed during render by a
  pure selector.
- Global Tauri `listen` belongs in one workspace/app hook (for example
  `useConversationTitleUpdates`). Decode in `src/lib/tauri` first. Do not
  subscribe per conversation row.


## Testing

- Prefer testing the pure selector/action behind a hook.
- Test a hook directly when its subscription, cancellation, or lifecycle is
  the behavior under test.
- Use deterministic typed bridge fakes; do not mock raw SQL or reach through
  the Tauri boundary.
- Cover result-before-callback, malformed event, exact cancellation, stale
  run, terminal-stage handling, and one-shot reload behavior. For background
  runs, cover switch-away-keeps-streaming, toast on background terminal, and
  cancel-on-archive of a background target.
- Every active-path test includes two sibling branches and asserts that the
  inactive sibling is absent.

## Common Mistakes

- Wrapping every bridge call in an ad-hoc `useEffect` data-fetching hook.
- Returning a broad Zustand store object and causing unrelated rerenders.
- Hiding product mutations inside a generic hook under `src/hooks`.
- Parsing unknown IPC errors inside a hook instead of the typed bridge.
- Copying store state into local state and allowing the two trees to diverge.
- Disabling hook lint rules to force an effect lifecycle.
- Treating a transport rejection as proof of either success or failure before
  the controller has performed its one-shot durable reload.
- Calling `listen` per conversation row instead of one workspace/app hook
  that decodes in `src/lib/tauri` first.
