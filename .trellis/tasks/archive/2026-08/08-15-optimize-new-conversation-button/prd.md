# PRD: Optimize New Conversation Button Layout & Sidebar Hierarchy

## Goal

Improve accessibility and visual hierarchy of the "New Conversation" action across both expanded and collapsed sidebar states by:
1. Providing a quick "New Conversation" entry button in the main header when the sidebar is collapsed (Suggestion 1).
2. Refactoring the sidebar header into a dedicated toolbar (Branding + New Conversation action) and establishing symmetrical section headers for "历史记录" (History) and "会话树" (OutlineTree) (Suggestion 2 Option B).

## Background & Problem Statement

- **Collapsed State Inaccessibility**: Currently, the "新建会话" button only exists in the sidebar header. When the sidebar is collapsed (`isSidebarOpen = false`), the user cannot create a new conversation without first expanding the sidebar.
- **Weak Visual Hierarchy**: In the sidebar, the "新建会话" button is currently embedded as a secondary ghost button inside the "历史记录" header. This reduces its perceived importance as the primary global action and creates structural asymmetry with the "会话树" section below.

## Requirements

- **R1: Main Header Collapsed Entry**: When `isSidebarOpen === false`, render a "新建会话" icon button in the main `<header>` next to the sidebar expand toggle (`PanelLeftOpen`).
- **R2: Sidebar Header Toolbarization**: Refactor the top `h-12` header of `<aside>` into a dedicated toolbar featuring app branding ("Canopy") and the "新建会话" action button.
- **R3: Symmetric Section Headers**: Place a dedicated section header for "历史记录" above the history list, matching the visual style and typography of the "会话树" section header.
- **R4: Consistent State & Accessibility**: Both "新建会话" buttons must:
  - Trigger `store.enterConversationCreation`.
  - Be disabled when `store.status === "loading"` or `isGenerationActive(store.generation)`.
  - Provide accessible `aria-label="新建会话"` and descriptive tooltips.

## Acceptance Criteria

- [x] **AC1 (Collapsed Header Button)**: When the sidebar is collapsed, the main header displays a visible "新建会话" button next to the sidebar expand toggle. Clicking it initiates conversation creation.
- [x] **AC2 (Expanded Header Cleanliness)**: When the sidebar is expanded, the main header does not render the extra "新建会话" button to avoid UI redundancy.
- [x] **AC3 (Sidebar Toolbar)**: The sidebar header displays "Canopy" and a prominent "新建会话" button.
- [x] **AC4 (Section Hierarchy)**: "历史记录" and "会话树" have distinct and consistent section title headers.
- [x] **AC5 (Disabled States)**: Both new conversation buttons are disabled when a session is loading or active generation is running.
- [x] **AC6 (Automated Tests)**: All existing and new automated tests in `ConversationWorkspace.test.tsx` and `App.test.tsx` pass without regressions.

## Out of Scope

- Global keyboard shortcuts (e.g. `Cmd+N`) — to be tracked in a future enhancement.
- Persistence schema changes or backend IPC changes.
