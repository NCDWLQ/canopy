# Frontend Hook Guidelines

> Rules for extracting React stateful behavior without hiding domain boundaries.

## Current State

Canopy currently has no custom hooks. `src/App.tsx` is a pure scaffold
component, while `src/main.tsx` owns only root creation and `StrictMode`. Do not
create hooks merely to fill the reserved `@/hooks` alias in `components.json`.

The first custom hooks should appear only when conversation state, Tauri
actions, or reusable desktop behavior provides concrete extraction evidence.

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
- User cancellation returns the UI to an idle/cancelled state without an error
  toast, consistent with the shared error contract.
- Do not use an effect to derive values that can be computed during render by
  a pure selector.

## Testing

- Prefer testing the pure selector/action behind a hook.
- Test a hook directly when its subscription, cancellation, or lifecycle is
  the behavior under test.
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
