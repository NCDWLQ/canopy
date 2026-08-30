# React 渲染热路径性能优化

## Goal

消除流式生成（streaming）期间不必要的 React 重渲染放大链路，使 token
delta 更新时仅流式气泡与必要 UI 重绘，而非整条 active path 上的全部
`MessageNode` / `AssistantMarkdown` 重新解析 markdown。

## Background / Confirmed Facts

- 2026-08-30 全库 React 渲染性能扫描（24 项发现，7 高优先级）已确认根因
  链路：`generationRuns` delta → `ConversationWorkspace` 胖选择器 →
  `selectActivePath` 缓存失效 → 全路径 `MessageNode` 重渲染 → Streamdown
  全量重解析。
- `selectActivePath` 的 WeakMap 以整个 `ConversationTreeState` 为键，任何
  `set()` 都 miss（`store/index.ts:1939-2021`）。
- `ConversationWorkspace` 的 `useShallow` 选择器包含 `generationRuns` 与未使用
  的 `expandedIds`（`ConversationWorkspace.tsx:158-185`）。
- `MessageNode` / `AssistantMarkdown` 未 `memo`（`MessageNode.tsx`,
  `AssistantMarkdown.tsx`）。
- `App.tsx` 顶层订阅 `theme`/`resolvedTheme`，主题变化导致整棵
  `ConversationWorkspace` 重渲染。
- 分支 `perf/react-render-hot-path` 已创建，工作区干净。

## Requirements

### Phase A — 热路径（MVP，本任务范围）

- R1：修复 `selectActivePath` 缓存，使仅 `generationRuns` 等非路径字段
  更新时返回稳定 `path` 引用。
- R2：`ConversationWorkspace` 不再通过胖选择器订阅 `generationRuns`；改用
  窄选择器（`selectCurrentRun`、`selectActiveRunIds`）；移除未使用的
  `expandedIds`。
- R3：将流式相关 UI（transient bubble、composer placeholder、exportDisabled
  等）隔离到独立子组件，使其单独订阅 `selectCurrentRun`，主 workspace 在
  delta 期间不重渲染。
- R4：`MessageNode` 与 `AssistantMarkdown` 使用 `React.memo`；父组件稳定化
  传入的回调与 branch-switcher 控制对象（`useCallback` / `useMemo`）。
- R5：`useWorkspaceGenerationController` 对 `selectActivePath` 使用
  `useShallow`；`pathProjection` 在 generation-only 更新时不触发重渲染。
- R6：`App.tsx` 抽离 `DocumentThemeSync` / `DocumentLocaleSync` 叶子组件，
  使 `App` 不再订阅 theme/locale store。

### Phase B — 后续（本任务 Out of Scope，可开子任务）

- 路径消息列表虚拟化（长对话）。
- 历史侧栏虚拟化。
- 全景图 `nodes`/`edges` 引用稳定性加固。
- provider store `phase: "loading"` 偏好写入优化。

## Acceptance Criteria

- [ ] AC1：`pnpm check` 通过。
- [ ] AC2：现有 conversations 相关测试无回归（`pnpm vitest run src/features/conversations`）。
- [ ] AC3：流式生成期间，`selectActivePath` 在仅 `generationRuns` 变化时
      返回与上次相同的 `path` 数组引用（store 单测覆盖）。
- [ ] AC4：流式生成期间，`ConversationWorkspace` 主组件不因 delta 重渲染
      （`React.Profiler` 回调或 render-counting 测试子组件断言 render
      次数；允许流式子组件重渲染）。
- [ ] AC5：`MessageNode` memo 生效：路径中未变化的消息在父级无关 state
      更新时不重渲染（组件级测试或 spy）。
- [ ] AC6：切换系统/应用主题时，`ConversationWorkspace` 不因 `App` 重渲染
      （`DocumentThemeSync` 隔离后由 effect 同步 document，不经过 App 子树）。

## Out of Scope

- 消息列表 / 历史列表虚拟化（Phase B）。
- 全景图布局 memo 加固（Phase B）。
- provider store loading phase 优化（Phase B）。
- 将 `generationRuns` 拆为独立 Zustand slice（改动面过大，留后续评估）。
- React Compiler 引入。

## Key Decisions

- **缓存策略**：`selectActivePath` WeakMap 键改为 `fullNodes` 引用 +
  结构字段相等比较（`activeNodeId`, `rootNodeId`, `conversationId`），
  与 generation-only 更新解耦。指纹不含 `nodesById`（投影逻辑不读它），
  且已验证 store 无 `fullNodes` 原地修改。（2026-08-30，评审修订）
- **隔离粒度**：流式 UI 抽为 `WorkspaceStreamingLayer`（或等价命名）子组件，
  而非拆整个 workspace 文件。（2026-08-30）
- **memo 前提**：先稳定选择器与 props，再 memo 叶子组件；顺序不可颠倒。
  （2026-08-30）
- **分支**：在 `perf/react-render-hot-path` 上实施，基于 `main`。
