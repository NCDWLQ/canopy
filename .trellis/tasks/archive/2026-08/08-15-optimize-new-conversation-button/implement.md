# Implementation Plan: Optimize New Conversation Button Layout & Sidebar Hierarchy

## Checklist

- [x] **Step 1**: Update `ConversationWorkspace.tsx`
  - Refactor sidebar header into `Canopy` branding + `新建会话` button.
  - Add dedicated `历史记录` subheader with `h-8 text-xs text-muted-foreground uppercase tracking-wide px-3`.
  - Add collapsed-sidebar `新建会话` icon button to main header when `!isSidebarOpen`.
- [x] **Step 2**: Update unit & integration tests
  - Update `ConversationWorkspace.test.tsx` and `App.test.tsx` to verify:
    - Sidebar open state shows "Canopy" and "新建会话".
    - Collapsing sidebar hides sidebar and shows quick "新建会话" icon button in header.
    - Clicking the collapsed header button triggers `enterConversationCreation`.
    - Loading/generation active disables both buttons.
- [x] **Step 3**: Quality & Regression Check
  - Run `pnpm test`
  - Run `pnpm typecheck` / lint / check
