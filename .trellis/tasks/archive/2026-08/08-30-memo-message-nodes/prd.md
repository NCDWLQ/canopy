# Memoize message nodes to stop streaming re-renders

## Goal

During streaming generation, only the bubble currently receiving tokens should
re-render. Today every `MessageNode` / `AssistantMarkdown` on the active path
re-renders (and re-parses markdown via Streamdown) on every token delta,
because the components are not memoized and the props passed from
`ConversationWorkspace` are recreated each render.

This is step 3 of the render-performance audit (canvas report 2026-08-30).
Steps 1–2 (narrow Zustand selectors, stable `selectActivePath` output) already
landed on branch `perf/react-render-hot-path` in commit `57c3bc4`; this task
builds on that reference-stability foundation in the **same PR**.

## Context

- Audit findings covered: conversations #3 (unmemoized `MessageNode` /
  `AssistantMarkdown` re-parse markdown every parent render) and #5 (unstable
  callbacks/objects passed into the message list, which would defeat memo).
- Key files:
  - `src/features/conversations/components/MessageNode.tsx`
  - `src/features/conversations/components/AssistantMarkdown.tsx`
  - `src/features/conversations/components/ConversationWorkspace.tsx`
    (`branchSwitcherFor`, `canCreateBranch`, `canEditAsBranch`,
    `onEditAsBranch`, `onExportMessage`, action objects)
  - `src/features/conversations/components/ConversationPane.tsx`
  - `src/features/conversations/components/BranchSwitcher.tsx`

## Requirements

- Wrap `MessageNode` and `AssistantMarkdown` in `React.memo` with props that
  are referentially stable across generation-delta renders.
- Stabilize everything `ConversationWorkspace` / `ConversationPane` pass into
  the message list: `useCallback` for handlers (`canCreateBranch`,
  `canEditAsBranch`, `onEditAsBranch`, `onExportMessage`, branch switcher
  `onPrev`/`onNext`), `useMemo` for per-node control objects (e.g. a
  `Map<nodeId, BranchSwitcherControl>` keyed on the data that actually
  changes).
- No behavior change: branching, editing, exporting, streaming display, and
  branch switcher UI must work exactly as before.
- Follow `.trellis/spec/frontend/` conventions (hook guidelines, state
  management, quality guidelines).

## Acceptance Criteria

- [x] New render-count test: while a generation delta streams into the active
      path, only the receiving `MessageNode` re-renders; sibling message nodes
      render 0 additional times.
- [x] Existing test suite passes (`pnpm test`), plus `pnpm lint` and
      `pnpm typecheck`.
- [ ] Manual smoke: streaming a long assistant reply no longer re-renders
      earlier bubbles (verify via React DevTools profiler or the test above).
- [x] Branch switcher, edit-as-branch, and export still work on historical
      messages (covered by existing MessageNode / ConversationWorkspace tests).

## Out of Scope

- Virtualizing the path message list (audit finding #4) — separate task.
- Panorama `nodes`/`edges` stability (finding #7) — separate task.
- `generationRuns` store split (finding #8) — separate task.
