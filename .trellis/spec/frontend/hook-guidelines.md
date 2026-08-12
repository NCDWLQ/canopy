# Frontend Hook Guidelines

> Rules for extracting React stateful behavior without hiding domain boundaries.

## Current State

`useWorkspaceGenerationController` is the first feature hook. It coordinates
the typed provider Channel with conversation selection, mutation locking,
exact cancellation, automatic acknowledgement, and SQLite reconciliation.
Keep this lifecycle under `features/conversations/hooks`; do not move it into a
generic root hook or duplicate it in components.

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
- `src/hooks` is only for behavior shared across features, such as a proven
  reusable desktop-media hook.
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
- The visible active path must come from the single validated
  application/store projection and must preserve root-to-active ordering.

Conceptual shape:

```ts
const activeNodeId = useConversationStore(selectActiveNodeId)
const activePath = useConversationStore(selectActivePath)
```

The selectors above must be imported from the owning store module rather than
redeclared inline in several components.

## Effects and Tauri Calls

- Hooks never call raw `invoke`; they call a typed action or `lib/tauri` bridge
  function that validates unknown results.
- Include every effect dependency. Do not suppress the configured
  `react-hooks` lint rules.
- Effects that start asynchronous work must handle stale completion and
  cancellation explicitly.
- Channel callbacks and the command promise may resolve in either order. Gate
  both with the current UI run identity; a late command result for the exact
  current/completed generation is not a cancellation condition.
- After acknowledgement may have been accepted, cancellation is not rollback.
  Keep the store in silent `committing` for the complete 1,500 millisecond
  terminal-delivery grace period, then enter visible reconciliation and reload
  SQLite authority. A thrown commit call schedules that same delayed path; it
  does not enter `reconciling` immediately.
- Cleanup clears timers and triggers exactly one immediate reconciliation for
  already-ambiguous committing/reconciling work; a cleared grace timer must not
  fire later.
- User cancellation is permitted only before acknowledgement and returns a
  cancelled state retaining partial content without an error toast. The Channel
  may still deliver an exact backend `cancelled` after ready; accept that
  terminal separately without exposing a post-ack user-cancel action.
- Manual reconciliation retry first atomically clears its user-action flag,
  then starts the reload. Ignore retries while automatic work is running.
- Do not use an effect to derive values that can be computed during render by
  a pure selector.

## Testing

- Prefer testing the pure selector/action behind a hook.
- Test a hook directly when its subscription, cancellation, or lifecycle is
  the behavior under test.
- Use fake timers for the exact 1,500 millisecond boundary and always restore
  real timers in cleanup. Cover exact terminal delivery before the threshold,
  during an in-flight reload, and after unmount cleanup.
- Use deterministic typed bridge fakes; do not mock raw SQL or reach through
  the Tauri boundary.
- Every active-path test includes two sibling branches and asserts that the
  inactive sibling is absent.

## Common Mistakes

- Wrapping every bridge call in an ad hoc `useEffect` data-fetching hook.
- Returning a broad Zustand store object and causing unrelated rerenders.
- Hiding product mutations inside a generic hook under `src/hooks`.
- Parsing unknown IPC errors inside a hook instead of the typed bridge.
- Copying store state into local state and allowing the two trees to diverge.
- Disabling hook lint rules to force an effect lifecycle.
- Entering visible reconciliation inside a commit `catch`, which exposes an
  ambiguous internal state before the terminal-delivery grace period expires.
