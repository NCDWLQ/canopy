# Design: React 渲染热路径性能优化

## Problem: Render Amplification Chain

```
appendGenerationDelta
  → generationRuns[convId] 新引用
  → ConversationWorkspace useShallow({ …, generationRuns })
  → 整棵 workspace 重渲染
  → selectActivePath WeakMap miss（state 对象新引用）
  → path 新数组 → ConversationPane map 全量
  → 每个 MessageNode → AssistantMarkdown → Streamdown 重解析
```

目标：在 generation-only 更新时截断链路于步骤 2–3。

## Architecture & Boundaries

### 1. Store 层 — `selectActivePath` 缓存

**文件**：`src/features/conversations/store/index.ts`

将 `activePathProjectionCache` 从 `WeakMap<ConversationTreeState, …>` 改为
`WeakMap<fullNodes, PathCacheEntry>`，entry 保存结构指纹：

```ts
type PathCacheEntry = {
  activeNodeId: string | null
  rootNodeId: string | null
  conversationId: string | null
  projection: ActivePathProjection
}
```

命中条件：`fullNodes` 引用相同且三个指纹字段均 `===`。generation-only
`set()` 复用 `fullNodes` 引用 → 缓存命中 → 稳定 `projection.path`。

指纹不含 `nodesById`：投影逻辑只读 `fullNodes` / `activeNodeId` /
`rootNodeId` / `conversationId`（评审 2026-08-30 确认），加入 `nodesById`
只会造成不必要的 miss。

**已验证前提**：store 内不存在对 `fullNodes` 的原地修改——
`store/index.ts:638` 的 `fullNodes[node.id] = node` 写入的是
`copyRecord` 副本，不可变更新纪律成立，按引用缓存安全。

**已知限制**：store 内部分支切换预览以 `{ ...state, activeNodeId }` 临时
构造 state 调用 `selectActivePath`（`store/index.ts:1238,1254,1287`），
与正常订阅共用同一 `fullNodes` 缓存槽；`activeNodeId` 交替变化时会
miss 重算。行为正确，且路径通常很短，可接受；若后续 profiling 发现
热点再考虑小容量 LRU。

**不变量**：路径投影逻辑与输出形状不变；仅缓存键策略改变。

### 2. Workspace 层 — 选择器拆分 + 流式隔离

**文件**：`src/features/conversations/components/ConversationWorkspace.tsx`

| 变更 | 说明 |
|------|------|
| 瘦主选择器 | 移除 `generationRuns`、`expandedIds` |
| 窄订阅 | `selectCurrentRun`、`selectActiveRunIds` 独立 `useConversationStore` 调用 |
| 流式子组件 | 新建 `WorkspaceStreamingOverlay`（命名可调整）：订阅 `selectCurrentRun` + `selectActivePath`（shallow），负责 `transientGeneration`、`transientBubbleVisible`、`exportDisabled`、composer `placeholder` 中与 run 相关的部分 |
| 稳定 props | `branchSwitcherFor` → `useMemo` 产出 `Map<nodeId, BranchSwitcherControl>`；`canCreateBranch` / `canEditAsBranch` → `useCallback`；`onEditAsBranch` / `onExportMessage` → `useCallback` |

主 workspace 在 streaming delta 时仅当树/路径/选择变化才重渲染。

### 3. Controller 层

**文件**：`src/features/conversations/hooks/useWorkspaceGenerationController.ts`

- `pathProjection`：`useConversationStore(useShallow(selectActivePath))`
- `currentRun`：已是 `selectCurrentRun`（保持）
- generation-only 更新不再使 controller 因 path 引用抖动而重渲染

注：缓存修复（第 1 节）落地后 projection 引用本身已稳定，`useShallow`
属于防御性双保险而非必需，保留以防未来缓存策略回退时回归。

### 4. 叶子组件 memo

**文件**：
- `src/features/conversations/components/MessageNode.tsx`
- `src/features/conversations/components/AssistantMarkdown.tsx`

```ts
export const MessageNode = React.memo(function MessageNode(props) { … })
export const AssistantMarkdown = React.memo(function AssistantMarkdown(props) { … })
```

`MessageNode` 自定义 `arePropsEqual`（可选）：比较 `message.id`、`message.content`、
`message.thinking`、`canBranch`、`canEdit`、`exportDisabled`、`highlightQuery`、
`branchSwitcher` 的 index/count/disabled 标志；函数 props 在父级稳定后可用
引用相等。

### 5. App 主题隔离

**文件**：`src/App.tsx`（或 `src/components/DocumentThemeSync.tsx`）

```tsx
function DocumentThemeSync() {
  const { theme, resolvedTheme } = useTheme()
  // effects only — return null
}
function DocumentLocaleSync() {
  const { locale } = useTranslation()
  // effect: document.documentElement.lang
}
export default function App() {
  return (
    <TooltipProvider>
      <DocumentLocaleSync />
      <DocumentThemeSync />
      <main>…</main>
    </TooltipProvider>
  )
}
```

`App` 不再调用 `useTheme` / `useTranslation`，子树不因主题/locale 切换而
整树重渲染。

## Data Flow (After)

```
appendGenerationDelta
  → generationRuns 更新
  → WorkspaceStreamingOverlay 重渲染（仅流式 UI）
  → selectActivePath 缓存命中 → path 引用不变
  → ConversationPane / MessageNode 跳过重渲染（memo）
```

## Trade-offs

- **不拆 generationRuns store**：MVP 用选择器隔离 + 缓存修复，改动面可控；
  全 slice 拆分留 Phase B 评估。
- **流式子组件仍每 delta 重渲染**：可接受——仅一个 Streamdown 实例（transient
  bubble），而非 N 个历史气泡。
- **memo 自定义比较**：默认浅比较 + 稳定 props 通常足够；仅在测试发现
  函数引用泄漏时加 `arePropsEqual`。

## Compatibility & Rollback

- 无后端 / 数据 / IPC 变更。
- 行为不变：流式气泡、分支切换、主题同步、composer 占位符语义保持。
- 回滚 = revert 分支 commits。

## Test Strategy

| 区域 | 测试 |
|------|------|
| `selectActivePath` | store.test.ts：simulate generation-only `set`，断言 path 引用稳定 |
| Workspace 隔离 | ConversationWorkspace.test.tsx：mock store delta，用 `React.Profiler` 回调（或注入 render-counting 测试子组件）断言主组件 render 次数不增、流式子组件 render 次数增加 |
| memo | MessageNode.test.tsx：rerender with stable message，assert Streamdown/mock 未二次调用 |
| App 主题 | App.test.tsx（若存在）或新建：theme store 更新不触发 workspace spy |
