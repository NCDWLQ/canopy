# Implement: React 渲染热路径性能优化

**Branch**: `perf/react-render-hot-path`

## Checklist（按序执行）

1. [ ] **Store：`selectActivePath` 缓存修复**（`store/index.ts`）
   - 改 WeakMap 键为 `fullNodes` + 结构指纹（`activeNodeId` /
     `rootNodeId` / `conversationId`，不含 `nodesById`）。
   - 注意：内部分支切换预览（`store/index.ts:1238,1254,1287`）以临时
     state 调用本选择器，与正常订阅共用缓存槽，交替 `activeNodeId`
     会 miss 重算——可接受，勿为此加复杂逻辑。
   - `store/store.test.ts`：generation-only 更新后 `selectActivePath` 返回
     相同 `path` 引用；路径/节点变更后仍正确重建。

2. [ ] **Controller：`useShallow(selectActivePath)`**
   （`hooks/useWorkspaceGenerationController.ts`）
   - 导入 `useShallow`；替换裸 `selectActivePath` 订阅。

3. [ ] **Workspace：瘦选择器 + 移除 `expandedIds`**
   （`ConversationWorkspace.tsx`）
   - 从主 `useShallow` 移除 `generationRuns`、`expandedIds`。
   - 独立订阅 `selectCurrentRun`、`selectActiveRunIds`。

4. [ ] **Workspace：稳定化回调与 branch-switcher map**
   （`ConversationWorkspace.tsx`）
   - `branchSwitcherFor` → `useMemo` 返回 `ReadonlyMap`。
   - `canCreateBranch` / `canEditAsBranch` / export & edit handlers →
     `useCallback`。

5. [ ] **Workspace：抽离流式 UI 子组件**
   （`ConversationWorkspace.tsx` 或新文件 `WorkspaceStreamingLayer.tsx`）
   - 子组件订阅 `selectCurrentRun` + shallow path（仅判断 transient 可见性）。
   - 主 workspace 不再直接依赖 `currentRun` 做 render 计算。

6. [ ] **Memo 叶子组件**
   - `MessageNode.tsx`：`React.memo` 包裹。
   - `AssistantMarkdown.tsx`：`React.memo` 包裹。

7. [ ] **App 主题/locale 隔离**（`App.tsx`）
   - `DocumentThemeSync` + `DocumentLocaleSync` 叶子组件。
   - `App` 移除 theme/locale hook 订阅。

8. [ ] **测试**
   - 扩展 `store.test.ts`、`ConversationWorkspace.test.tsx`、
     `MessageNode.test.tsx`（或新建 `App.test.tsx`）覆盖 AC3–AC6。
   - AC4 的 render 计数用 `React.Profiler` 回调或注入 render-counting
     测试子组件实现，不要尝试直接 spy 函数组件。
   - 全量 `pnpm vitest run src/features/conversations`。

9. [ ] **质量门**：`pnpm check`。

## Validation Commands

```bash
pnpm vitest run src/features/conversations/store/store.test.ts
pnpm vitest run src/features/conversations/components/ConversationWorkspace.test.tsx
pnpm vitest run src/features/conversations/components/MessageNode.test.tsx
pnpm vitest run src/features/conversations
pnpm check
```

## Risky Files / Rollback Points

| 文件 | 风险 | 回滚点 |
|------|------|--------|
| `store/index.ts` | 缓存错误可导致 stale path | checklist 1 完成后先跑 store 测试 |
| `ConversationWorkspace.tsx` | 流式 UI 抽离可能破坏 composer 占位符 | checklist 5 后手动验证流式生成 |
| `MessageNode.tsx` | memo 可能抑制合法更新 | 确认 message.content 变化仍重渲染 |

## Review Gates

- Checklist 1–2 完成：store + controller 层可独立验证。
- Checklist 5 完成：手动测试流式生成 + 分支切换。
- Checklist 9 通过：进入 Phase 3（spec 更新 + commit）。
