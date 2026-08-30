# Design: 线性视图分支切换器

## Architecture & Boundaries

纯前端特性，三层改动，自底向上：

1. **Store 层**（`src/features/conversations/store/index.ts`）：新增纯函数
   `siblingBranchInfo(nodesById, nodeId)`，返回
   `{ index, count, prevId, nextId } | null`（无父节点或兄弟数 < 2 时
   `null`）。不新增 store action——切换直接复用 `selectBranchAtNode`。
2. **组件层**：
   - 新组件 `BranchSwitcher.tsx`：受控分页器，props 为
     `{ index, count, onPrev, onNext, prevDisabled, nextDisabled }`，渲染
     `‹ i+1/count ›`（ChevronLeft / ChevronRight icon 按钮 + muted 文本）。
   - `MessageBubble.tsx`：新增 `pager?: ReactNode` 插槽，渲染在操作栏同一
     flex 行内、但**在 hover-opacity 包裹之外**（user/system 角色的
     `opacity-0 group-hover:opacity-100` 只作用于原 actions 容器），保证
     常驻可见。
   - `MessageNode.tsx`：新增可选 prop
     `branchSwitcher?: { index: number; count: number; onPrev: () => void; onNext: () => void }`，
     非空且非编辑态时经 `pager` 插槽渲染 `BranchSwitcher`。
   - `ConversationPane.tsx`：新增可选 prop
     `branchSwitcherFor?: (nodeId: string) => BranchSwitcherModel | null`，
     在 path map 中传给每个 `MessageNode`。
   - `ConversationWorkspace.tsx`：实现 `branchSwitcherFor`——用
     `siblingBranchInfo(nodesById, nodeId)` 计算序号与目标兄弟 id，闭包内
     调用 `selectBranchAtNode(prevId/nextId)`。`nodesById` 与
     `selectBranchAtNode` 均已订阅（后者见 :189-191）。

## Data Flow

```
click ›  →  BranchSwitcher.onNext
         →  Workspace 闭包: selectBranchAtNode(nextId)
         →  store: activeNodeId = newestLeafDescendant(nextId),
                  reveal = { nodeId: nextId, query: "" }
         →  selectActivePath 重建 → ConversationPane 重渲染
         →  MessageNode reveal effect 滚动到被切换消息（既有行为）
```

序号计算：`parent = nodesById[nodesById[nodeId].parentId]`，
`index = parent.childIds.indexOf(nodeId)`，`count = parent.childIds.length`。
`childIds` 为创建时间升序（后端 `ORDER BY created_at ASC, id ASC`），
序号稳定且与 OutlineTree 展示顺序一致。

## Contracts

```ts
// store/index.ts
export function siblingBranchInfo(
  nodesById: Readonly<Record<string, TreeNodeView>>,
  nodeId: string,
): { index: number; count: number; prevId?: string; nextId?: string } | null
```

i18n 新键（en.ts + zh-CN.ts，typed dictionary 双侧必填）：

- `conversation.message.branchPrev`（"上一条分支" / "Previous branch"）
- `conversation.message.branchNext`（"下一条分支" / "Next branch"）
- `conversation.message.branchPosition`（"分支 {index}/{count}" /
  "Branch {index}/{count}"，用作分页器 aria-label）

## Trade-offs & Decisions

- **首尾禁用、不循环**：位置感明确，避免 1/2 → 2/2 → 1/2 循环造成的方
  向迷失；实现也最简。
- **流式期间允许切换**：`selectBranchAtNode` 不校验 status，Panorama 单
  击在流式期间同样可用，行为保持一致；不为切换器额外加锁。
- **编辑态隐藏**：编辑 Textarea 期间分页器无意义且易误触，`isEditing`
  时不渲染（与操作栏 `hasActions && !isEditing` 先例一致）。
- **不进操作栏**：见 PRD Key Decisions；`pager` 插槽是对 MessageBubble
  的最小侵入扩展，原 actions 行为不变。

## Compatibility & Rollback

- 无后端 / 数据迁移；`pager`、`branchSwitcher`、`branchSwitcherFor` 均为
  可选 prop，缺省时渲染与现状完全一致。
- 回滚 = revert 单个 commit，无持久状态残留。
