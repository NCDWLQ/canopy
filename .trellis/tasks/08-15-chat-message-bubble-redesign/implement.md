# Implementation Plan: 右侧对话区域消息气泡与极简输出风格改造

## Execution Steps

### Step 1: Update `MessageBubble.tsx`
- Remove the visual header `<div className="text-sm font-semibold capitalize text-muted-foreground">{roleLabel}</div>`.
- Differentiate layout structure by `role`:
  - `user`: right-aligned container (`ml-auto max-w-[85%]`), rounded bubble with `bg-muted` and `px-4 py-3`, no outer borders/cards.
  - `assistant`: left-aligned full-width container (`w-full`), transparent background (`bg-transparent border-0 p-0 shadow-none`), direct rendering.
- Place `actions` and `footer` into a contextual bottom action area with `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`.
- Maintain `aria-label={`${roleLabel}消息`}` on `<article>`.

### Step 2: Update `MessageNode.tsx` & `ConversationPane.tsx`
- Verify textarea and edit/branch submit/cancel forms within user bubble and assistant layouts.
- Fine-tune `TransientGenerationMessage` status line, loader, and retry buttons for assistant direct-background layout.
- Ensure proper spacing and layout in `ConversationPane`.

### Step 3: Validation & Quality Checks
- Run `pnpm typecheck` to ensure type safety.
- Run `pnpm lint` to ensure ESLint / Prettier compliance.
- Run `pnpm test` to verify unit and integration tests (including `ConversationWorkspace.test.tsx`, `AssistantMarkdown.test.tsx`, etc.).
- Fix any regression in tests or styling.

### Step 4: Spec Update & Completion
- Review spec updates if applicable.
- Confirm ready for commit and wrap-up.
