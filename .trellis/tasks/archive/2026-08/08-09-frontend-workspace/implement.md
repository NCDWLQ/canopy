# Implementation Plan

## Phase 1: Foundation and State
1. **Types and Client**:
   - Define exact view models (`ConversationView`, `TreeNodeView`, `PathMessageView`, `UiError`) in `src/features/conversations/types`.
   - Implement the typed Tauri IPC client wrapper in `src/lib/tauri`.
2. **Zustand Store**:
   - Build the `ConversationTreeState` store in `src/features/conversations/store/`.
   - Implement pure selectors for tree expansion, active node, and active path resolution.
   - Implement actions for load, select, branch, append, edit, and archive.

## Phase 2: UI Components
1. **Layout**: Create the basic flex/grid layout in `ConversationWorkspace`.
2. **OutlineTree**: Implement the tree view using proper accessibility patterns (Radix/custom) and connect it to store selectors.
3. **ConversationPane**: Implement the message list that strictly renders the provided path array.
4. **MessageNode**: Build the message display with role styling and action buttons, properly handling disabled states for archived conversations.
5. **Composer**: Build the input form, integrating with append actions.

## Phase 3: Integration and Tests
1. **Testing Setup**:
   - Write tests for store selectors using mocked injected clients.
   - Write tests for component rendering, particularly asserting that sibling nodes do not leak into the active path.
   - Verify fail-safe error handling and archive mutation prevention.
2. **Styling and Polish**:
   - Apply semantic Tailwind tokens. Ensure focus management and accessibility.
   - Clean up imports and remove unused code.
3. **Trellis Checks**: Run `pnpm check`, type-checks, and ensure full compliance with quality guidelines.
