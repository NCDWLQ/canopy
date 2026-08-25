# Conversation Panorama terminology refactor

## Goal

Rename the existing conversation-tree canvas from “mind map view” to
Conversation Panorama / Panorama across the product and codebase. The user
should see a coherent Panorama concept, while the existing tree visualization
and interactions remain unchanged.

## Background and confirmed facts

- The feature is currently rendered by `MindMapCanvas` and laid out by
  `features/conversations/mindmapLayout.ts`.
- `ConversationWorkspace` owns the local view switch through `isMindMapOpen`;
  there is no URL router or persisted route in this repository. The requested
  “route” therefore means this internal workspace view branch and its state,
  not a new browser URL.
- The feature is exposed by a `Waypoints` header button and localized through
  `conversation.mindmap.*` keys in both supported dictionaries.
- Existing tests and frontend guidelines encode the same naming and must be
  migrated with the implementation.
- The React Flow + d3-hierarchy canvas, tree projection, collapse behavior,
  branch activation, double-click return to the conversation pane, theme
  support, and accessibility behavior are already working behavior to retain.

## Requirements

1. Rename the internal workspace view route/state from mind-map terminology to
   Panorama terminology, including the state variable, conditional branch,
   callbacks, and test descriptions/selectors.
2. Rename the canvas component, implementation file, barrel export, imports,
   props/types, custom node/type identifiers, and all layout-module exports
   from MindMap/mindmap terminology to Panorama terminology. The resulting
   names should use `ConversationPanorama` for the user-facing canvas and
   `panoramaLayout` for the pure layout module.
3. Rename the i18n namespace and messages from `conversation.mindmap.*` to
   `conversation.panorama.*` in `zh-CN` and `en`. Chinese user-facing labels
   must use “对话全景”; English labels must use “Conversation Panorama” or
   “Panorama” where the shorter control label is appropriate.
4. Update comments, frontend specs, and tests so no active product source or
   test code refers to the old mind-map concept. Historical Trellis journals
   and archived task records are not product code and do not require
   rewriting.
5. Preserve the existing interaction contract: opening Panorama hides the
   conversation pane, clicking a node activates its branch, double-clicking a
   node returns to the conversation pane at that node, branch collapse/expand
   remains local to the current root, and unsafe projections still render the
   existing alert.

## Acceptance Criteria

- [ ] `rg` over active `src/` product and test files finds no
      `MindMap`, `mindmap`, `mind-map`, or “思维导图” references.
- [ ] Active source names and imports include `ConversationPanorama` and
      `panoramaLayout`; the workspace view state/branch is Panorama-named.
- [ ] Both locale dictionaries expose the same `conversation.panorama.*`
      key set, with “对话全景” / “Conversation Panorama” labels and no active
      `conversation.mindmap.*` keys.
- [ ] Existing Panorama component and workspace tests cover rendering,
      active-path highlighting, edges, collapse/expand, node selection,
      double-click return, and unsafe-tree handling after the rename.
- [ ] Formatting, lint, TypeScript, unit tests, and production build pass.
- [ ] No browser URL route or persistence migration is introduced, because
      the current feature has no URL router or persisted view route.

## Out of scope

- Changing the React Flow visualization, layout algorithm, colors, controls,
  interaction semantics, or conversation-tree data model.
- Adding a browser URL router, deep-link format, or persisted Panorama view
  preference.
- Rewriting historical `.trellis/tasks/archive/` records or developer journal
  entries.
