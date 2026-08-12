# Assistant Markdown 渲染支持

## Goal

让 assistant 的持久化与流式输出以安全、清晰、适合技术内容阅读的 Markdown 呈现，同时保持用户消息、消息协议和会话树行为不变。

## Background

- 持久化 assistant 消息目前在 `src/features/conversations/components/MessageNode.tsx:140-143` 以纯文本渲染。
- 流式、提交、恢复与终止状态中的 assistant 内容目前在 `src/features/conversations/components/ConversationPane.tsx:52-108` 走另一条纯文本渲染路径。
- 消息内容已经是字符串；Markdown 是展示层能力，不需要修改 IPC、Rust、SQLite 或 Zustand 数据协议。
- 项目使用 React 19、Vite、Tailwind CSS 4 和 shadcn/radix-nova，当前没有 Markdown、HTML sanitizer 或代码高亮依赖。
- 技术选型记录在 `research/tech-selection.md`。最终选择 `streamdown` + `@streamdown/code`，因为核心场景包含 token 级流式输出与未闭合 Markdown。

## Requirements

1. 仅 `assistant` 角色在非编辑展示态启用 Markdown；`user`、`system`、`tool` 继续使用现有纯文本展示。
2. 支持 CommonMark 与 GFM 的标题、段落、强调、删除线、链接、引用、列表、任务列表、表格、分隔线、行内代码和 fenced code block；遵循标准 Markdown soft-break 语义，不额外把每个单换行转换成 `<br>`。
3. fenced code block 使用 Shiki 按语言高亮并提供复制按钮；复制在流式期间禁用，代码下载和表格导出控件关闭。
4. 远程图片、数学公式、Mermaid、原始 HTML 和自定义 HTML 标签不属于 MVP；图片语法不得发起网络请求。
5. assistant 原始字符串仍是唯一数据源，不能持久化渲染后的 HTML，也不能修改 provider/IPC 内容。
6. 持久化与 transient assistant 消息复用一个 feature-local `AssistantMarkdown` 组件；完整内容使用静态模式，正在增长的内容使用流式模式。
7. 流式模式必须容忍未闭合的强调、链接、行内代码和代码围栏，且内容增长时不能抛错或暂时隐藏整条回复。
8. 模型输出视为不可信输入：不执行原始 HTML，不使用 `dangerouslySetInnerHTML`，仅允许 `http`、`https`、`mailto` 链接协议，并阻止 `javascript`、`data`、`file`、`tauri` 等协议。
9. 外链必须具备安全的窗口关系属性；无效或不允许的 URL 保留可读链接文本，但不能形成可导航目标。
10. Markdown 排版与代码控件使用现有语义色、圆角和焦点令牌，适配当前明暗主题；所有新增可见控件和无障碍名称使用简体中文。
11. 本任务不重构现有 `MessageBubble`、滚动容器或会话树结构。

## Acceptance Criteria

- [ ] 持久化 assistant 消息正确渲染约定的 CommonMark/GFM 语法，包括表格、任务列表、行内代码与 fenced code block。
- [ ] fenced code block 有语言高亮和“复制”能力，无下载能力；正在流式生成时复制不可用。
- [ ] transient assistant 内容随 token 增长实时渲染，未闭合强调、链接和代码围栏不会导致异常、整条内容消失或明显不可读。
- [ ] 同一份完整 Markdown 在 transient 结束态与持久化 assistant 展示态具有一致的语义结构。
- [ ] 普通 assistant 纯文本仍然可读，并遵循 CommonMark/GFM 的段落与 soft-break 规则。
- [ ] `user`、`system`、`tool` 消息继续显示原始文本，Markdown 标记不会被解释为富文本。
- [ ] 原始 HTML 不生成可执行 DOM；图片不加载；不安全协议不产生可导航链接；安全外链包含防 opener 劫持属性。
- [ ] Markdown 标题、列表、表格、引用、链接和代码控件可通过语义/无障碍查询识别，而非依赖 Tailwind 类名。
- [ ] 已有 streaming、committing、reconciling、failure、cancellation 与 transient-to-durable 行为测试继续通过，且同一回复不会重复显示。
- [ ] `pnpm check` 通过。

## Out of Scope

- 修改消息 DTO、IPC contract、Rust provider、SQLite schema、Zustand shape 或会话树规则。
- Markdown 编辑器、预览编辑器或所见即所得能力。
- 远程/内嵌图片、数学公式、Mermaid、MDX、原始 HTML、自定义标签或模型工具组件。
- 代码下载、表格复制/导出、整条 assistant 回复复制或引用系统。
- 全量迁移现有消息壳到新的 shadcn chat primitives，或重做滚动/自动跟随逻辑。

## Technical Notes

- 依赖：精确固定 `streamdown@2.4.0`，并使用 `@streamdown/code`。`streamdown@2.5.0` 直接引入了本任务未选择的 Mermaid 依赖，因此不得让 semver 范围自动升级到该版本。
- Tailwind 4 在 `src/index.css` 中扫描两个依赖的发布文件；不启用 Streamdown 的逐 token 动画 CSS，避免引入与当前 reduced-motion 行为无关的动效。
- 实现必须显式覆盖 Streamdown 的默认 rehype 配置，移除 raw HTML 解析，并收紧 URL/图片行为；不能依赖其默认 permissive hardening。
