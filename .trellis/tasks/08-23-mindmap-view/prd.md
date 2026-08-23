# PRD: Mind-map Conversation View (MVP)

## Problem

The conversation tree is currently surfaced only as an indented outline
(OutlineTree in the sidebar) and a linear active-path message list. Branch
structure — how regenerations / edit-branches fan out — is hard to grasp at a
glance. A mind-map style canvas makes the tree shape legible.

## Scope (MVP)

- New visualization of the existing conversation tree as a horizontal
  left-to-right node graph (root on the left), rendered with
  `@xyflow/react` (React Flow v12) + `d3-hierarchy` for tidy-tree layout.
- Nodes: role-styled cards (user vs assistant), preview text, active-path
  highlight; edges: bezier, active-path edges highlighted.
- Interactions: click node → `selectNode(id)` (switches active path);
  pan/zoom/fit-view; MiniMap; collapse/expand subtrees with a collapsed
  branch-count badge.
- Entry point: a view toggle in the conversation workspace that opens the
  mind-map view over the message pane, OutlineTree remains the
  a11y/keyboard navigation surface.

## Out of Scope (MVP)

- Editing tree structure from the canvas (drag-to-reparent, inline rename).
- Radial layout, edge labels, per-node thumbnails.
- Persisting collapse state or canvas viewport.
- Backend changes (data already available via `load_conversation_tree` /
  `ConversationTreeView`).

## Acceptance Criteria

1. `pnpm check` (format, lint, typecheck, test, build) passes.
2. Mind-map renders the full tree of the active conversation; collapsed
   subtree state visible via branch-count badge.
3. Clicking a node selects it: active path in the main message pane and the
   highlighted path in the canvas update consistently.
4. Empty / single-node conversations render without errors.
5. No regression to existing OutlineTree / message pane behavior.
