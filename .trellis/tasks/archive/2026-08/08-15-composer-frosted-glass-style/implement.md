# Implementation Plan: Composer 半透明磨砂质感与悬浮透出效果

## Ordered Checklist

- [x] **Step 1: 调整 `ConversationPane.tsx` 底部内边距**
  - 为消息滚动列表底部增加充足内边距（`pb-28 md:pb-32`），确保最后一条消息滚动到视口底端时完全处于悬浮 Composer 之上，不被遮挡。
- [x] **Step 2: 改造 `Composer.tsx` 为半透明磨砂质感与 IME 安全**
  - 外层 `<form>` 采用悬浮渐变遮罩 `bg-gradient-to-t from-background/90 via-background/60 to-transparent backdrop-blur-md`。
  - 内层输入框卡片采用半透明磨砂卡片 `bg-card/75 dark:bg-card/70 backdrop-blur-lg border border-border/80 shadow-sm`。
  - 聚焦与按钮状态过渡美化。
  - 增加中文输入法 `isComposing` 拦截。
- [x] **Step 3: 调整 `ConversationWorkspace.tsx` 布局层级**
  - 将 `ConversationPane` 与 `Composer` 组织在 `relative flex-1 min-h-0` 的主视口容器中。
  - 让 `Composer` 悬浮在主视口底部 (`absolute inset-x-0 bottom-0 pointer-events-none [&_form]:pointer-events-auto`)，使 `ConversationPane` 延伸至底部并在 Composer 下方透出滚动。
- [x] **Step 4: 运行自动化测试与全量质量门禁**
  - 运行 `pnpm test`
  - 运行 `pnpm check` (format, lint, typecheck, tests, build)
- [x] **Step 5: 验证交互与视觉效果**
  - 验证亮色/暗色模式下的半透明磨砂质感。
  - 验证滚动到底部时消息是否完全可见、滚动中是否自然从输入框下方透出。
