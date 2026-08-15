# PRD: Composer 半透明磨砂质感与悬浮透出效果

## Goal

为 Canopy 的输入区域（Composer）实现现代 AI 对话界面的悬浮磨砂质感（Frosted Glass / Backdrop Blur），消除硬通栏边框分割感，使得上方对话内容在向下滚动时能够从输入框及底栏下方自然透出，同时保持输入框的无障碍访问与输入体验。

## Confirmed Facts

- 目前 Composer 最外层是硬性通栏 `<form className="border-t bg-background p-4">`，位于 `ConversationWorkspace` 的 flex 纵向布局底部。
- 对话消息列表由 `ConversationPane` 承载，具有独立的 `overflow-y-auto` 滚动容器。如果 Composer 只是位于其下方的兄弟 flex item，消息滚动到达视口底部时会被 `ConversationPane` 的底部边界截断，无法滑到 Composer 下方透出。
- 项目采用 Tailwind CSS v4、shadcn/ui、Geist 字体，支持浅色（Light）与深色（Dark）主题模式。
- `Composer` 的无障碍标签包括 `aria-label="消息输入框"`、`aria-label="发送消息"`，这些在自动化测试中强依赖。

## Requirements

1. **悬浮磨砂容器布局（Floating Frosted Glass Container）**：
   - Composer 底部容器使用绝对定位或浮动层覆盖在对话区域底部，取消实心不透明背景和硬性 `border-t`。
   - 对话消息滚动流（`ConversationPane`）延伸至整个主区域底部，并在内容末尾增加充足的内边距（如 `pb-28` 或 `pb-32`），确保最新消息滚动到底部时不被悬浮输入框遮挡。
   - 滚动历史消息时，内容能够平滑滑入 Composer 所在区域并在磨砂玻璃效果下透出。

2. **半透明磨砂质感视觉（Frosted Glass Visual Design）**：
   - 外层底栏遮罩：使用半透明背景与渐变（如 `bg-background/60 backdrop-blur-md` 或 `bg-gradient-to-t from-background/90 via-background/60 to-transparent backdrop-blur-sm`），提供柔和过渡。
   - 内层输入框卡片：采用半透明卡片背景 `bg-card/85`（或 `bg-background/80`）+ `backdrop-blur-md` + 精致边框 `border border-border/70` + 微阴影 `shadow-sm`。
   - 在浅色与深色模式下均保持高对比度与良好可读性。

3. **焦点与交互质感（Focus & Interactive States）**：
   - 聚焦时具有柔和高亮过渡环（`focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 transition-all`）。
   - 发送按钮与输入框各交互状态（disabled、active）保持清晰。
   - 中文输入法（IME）在输入框内回车选词时不发生误提交。

4. **无障碍与测试兼容性（Accessibility & Backward Compatibility）**：
   - 维持所有既有语义属性（`role="textbox"`、`name="消息输入框"`、`name="发送消息"`）。
   - 空白对话首屏（Blank Conversation）与已有对话视图下表现一致且稳定。

## Acceptance Criteria

- [x] 底部 Composer 容器无硬通栏实体 `border-t`，呈现半透明磨砂（`backdrop-blur`）质感。
- [x] 在消息列表中上下滚动时，消息文字与气泡能从 Composer 及底部遮罩下方滑过并产生磨砂透出效果。
- [x] 当滚动到最底部时，最后一条消息完全可见，不被 Composer 遮盖截断。
- [x] 在亮色与暗色模式下，文本输入框内的文字与 placeholder 清晰可见，磨砂毛玻璃质感自然。
- [x] 中文输入法选词回车不触发意外提交；回车正常提交；Shift+Enter 正常换行。
- [x] 所有自动化测试（`pnpm test`）、类型检查（`pnpm typecheck`）、代码检查（`pnpm lint`）与构建（`pnpm build`）全部通过。

## Out of Scope

- 引入复杂的拖拽调整大小、多模型切换下拉框或文件上传等附加功能。
- 修改底层 Rust Tauri 消息传输协议或 Zustand Store 数据结构。
