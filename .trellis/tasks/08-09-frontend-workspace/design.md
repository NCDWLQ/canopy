# Technical Design

## Architecture
- **Boundary**: All data fetching and mutation must route through typed client wrappers in `src/lib/tauri` and `src/features/conversations/types`.
- **State Management**:
  - A normalized Zustand store manages the conversation tree projection (`ConversationTreeState`).
  - Immutable update patterns for state changes.
  - Fail-safe state preservation: retain the last valid state if an operation fails.
- **Data Flow**:
  - Load tree via Tauri -> parse and validate (Zod) -> update Zustand store.
  - User action -> typed client method -> backend -> success -> update store with authoritative result.

## Components Structure
Under `src/features/conversations/components/`:
- `ConversationWorkspace`: The main layout orchestrator.
- `OutlineTree`: Renders the left sidebar tree outline, purely driven by `nodesById` and `rootNodeId`.
- `ConversationPane`: Renders the active path messages, strictly accepting only the pre-validated `path` array.
- `MessageNode`: Individual message component with role-based styling and action buttons (branch, edit, append).
- `Composer`: Text input for appending new messages.

## Data Contracts (IPC Bridge)
All IPC communication utilizes:
- `createConversation`, `appendNode`, `createBranch`, `editNodeAsBranch`, `loadConversationTree`, `loadActivePath`, `archiveConversation`.
- Responses are strictly typed and parsed. Errors map to `UiErrorCode`s (e.g., `invalid_input`, `tree_integrity`).
