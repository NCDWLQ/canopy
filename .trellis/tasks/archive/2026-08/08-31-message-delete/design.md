# Design: 全景视图用户节点删除

## Architecture & Boundaries

遵循既有分层：Tauri command → `conversations` domain service → repository（SQLite）→ IPC → zustand store → React 组件。不引入新模块；删除逻辑归属 `conversations` 域。

## Backend (src-tauri)

1. **Repository**（`src-tauri/src/conversations/repository.rs`）
   - 新增 `delete_subtree(node_id)`：
     - 查询目标节点（id, conversation_id, parent_id, role）；不存在 → 错误。
     - 校验 `role == "user"` 且 `parent_id IS NOT NULL`（非根），否则返回领域错误。
     - 用递归 CTE 收集子树全部 id。
     - 事务内复用会话级删除的模式（~295-337）：`DROP TRIGGER nodes_reject_delete` → `DELETE FROM nodes WHERE id IN (...)` → 重建触发器 → commit。任何一步失败回滚并确保触发器重建。
2. **Service**（`service.rs`）：`delete_node_subtree(conversation_id, node_id)`，校验节点属于该会话后委托 repository。
3. **Command**：新增 `delete_conversation_node`（命名对齐现有 `CONVERSATION_COMMANDS` 风格），错误经 `CommandError` 映射（`error.rs`）。
4. **触发器保护保留**：`nodes_reject_delete` 不删除、不修改；仅在新命令事务内临时摘除。现有断言直接 DELETE 失败的集成测试保持通过。

## Frontend

1. **IPC client**（`src/lib/tauri/client.ts`）：`CONVERSATION_COMMANDS` 增加 `delete_conversation_node` 绑定，参数 `{ conversationId, nodeId }`，严格类型（type-safety 规范）。
2. **Store**（`src/features/conversations/store/index.ts`）：新增 `deleteNodeSubtree(nodeId)`：
   - 调用 IPC 成功后，收集子树 id（从 `nodesById` 的 `childIds` 递归）。
   - 从 `nodesById` / `fullNodes` 删除子树条目；从父节点 `childIds` 移除该节点。
   - 若 `activeNodeId` ∈ 子树：`activeNodeId = 父节点 id`（D3）。
   - 清理 `generationRuns` 中 `parentNodeId` ∈ 子树的记录（参照会话删除的 `removeRunRecord` 模式）。
   - 乐观策略：先 IPC 后改本地状态（与会话删除一致），失败时 toast/错误态不变更本地树。
3. **Panorama UI**（`ConversationPanorama.tsx`）
   - `PanoramaNodeData` 增加 `onDeleteNode?: (nodeId) => void` 与 `isRoot`/`canDelete` 标记；布局映射处（~361-371）注入。
   - 操作栏显示条件扩展：`canDelete = role === "user" && !isRoot && onDeleteNode != null`；删除按钮（Trash 图标，`size="icon-xs"`，ghost，同分支按钮风格）渲染在同一 hover 操作栏中。
   - Workspace 传入 `onDeleteNode={canMutate ? handler : null}`（R6 门控与分支按钮一致）。
4. **确认框**（`ConversationWorkspace.tsx`）：`pendingDeleteNodeId` state + `ConfirmDialog`（destructive），确认后调用 `store.deleteNodeSubtree`。文案含"删除该消息及其全部后代分支，不可恢复"。
5. **i18n**：新增 `conversation.panorama.deleteNode`（"删除该分支" / "Delete branch"）、`conversation.panorama.deleteNodeConfirmTitle`、`conversation.panorama.deleteNodeConfirmDescription`（zh-CN + en）。

## Data Flow

用户点击删除 → ConfirmDialog → store.deleteNodeSubtree → IPC delete_conversation_node → service 校验 → repository 事务删除子树 → 返回 → store 移除子树 + 重定向 activeNodeId → React Flow 重新布局渲染。

## Trade-offs

- 物理删除不可恢复（用户已确认 D2）；换取实现简单、无查询过滤负担。
- 生成中禁止删除（R6）而非取消生成：避免 finalize 写入已删父节点的竞态。
- 先 IPC 后改本地：删除失败时 UI 不出现幽灵状态；代价是成功后有一次本地重算（数据量小，可接受）。

## Rollback

- 功能集中于新命令 + store action + UI 按钮；回滚 = revert 单个 commit。无 schema 迁移（触发器语句复用现有定义），无数据迁移。
