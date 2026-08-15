# Technical Design: 右侧对话区域消息气泡与极简输出风格改造

## Architecture & Component Responsibilities

### 1. `MessageBubble.tsx`
- **Current implementation**:
  - Encapsulates every message inside `<article className="my-2 rounded-lg border p-4 bg-muted/bg-card">`.
  - Renders a header `<div className="mb-2 flex items-center justify-between">` containing the role label ("用户"/"助手") and action buttons.
  - Takes `actions` and `footer` as props.
- **Redesigned implementation**:
  - Split visual layout according to `role`:
    - `role === "user"`:
      - Outer container: `flex flex-col items-end my-3 group`
      - Article bubble: `aria-label="用户消息"`, `max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-foreground text-sm shadow-none`
      - Actions & Footer: placed in an action container below the bubble (aligned right `justify-end`), with subtle appearance on hover/focus (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`).
    - `role === "assistant"`:
      - Outer container: `flex flex-col items-start w-full my-4 group`
      - Article block: `aria-label="助手消息"`, `w-full bg-transparent border-0 p-0 shadow-none text-foreground`
      - Markdown content rendered directly on the background.
      - Actions & Footer: placed directly below markdown content in a horizontal bar (`flex items-center gap-1 mt-2 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`).
    - `role === "system" | "tool"` (if used):
      - Clean subtle centered pill / notification style.
  - Remove the top role label text completely from the DOM while preserving `aria-label={`${roleLabel}消息`}` on `<article>`.

### 2. `MessageNode.tsx`
- Ensure the edit / branching form seamlessly embeds inside the new bubble and clean layout:
  - When editing a user message: inline textarea with proper styling within the container.
  - When branching/editing an assistant message: clean textarea below.
  - Action buttons (Edit2, GitBranch) styled as subtle ghost buttons with appropriate size and icons.

### 3. `ConversationPane.tsx`
- `TransientGenerationMessage`:
  - Styled with the new assistant role layout: seamless direct background rendering.
  - "正在思考" / "正在恢复这条回复…" / "回复失败" / "回复已停止" and status buttons (重试恢复 / 重新生成) displayed naturally inline or under the content.
- Message list spacing in `<div className="mx-auto w-full max-w-4xl flex-1 pb-4" role="log">`:
  - Clean vertical rhythm with `space-y-4` or balanced margins.

## Tradeoffs & Accessibility
- Accessibility: Preserving `role="article"` and `aria-label="用户消息" / aria-label="助手消息"` ensures that screen readers and automated tests (`ConversationWorkspace.test.tsx`) continue to identify messages by their accessible names.
- Focus disclosure: Actions use `group-focus-within:opacity-100` so keyboard users can navigate to buttons via Tab key.
