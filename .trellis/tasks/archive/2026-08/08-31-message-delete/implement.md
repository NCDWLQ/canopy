# Implement: 全景视图用户节点删除

## Ordered Checklist

1. **Backend: repository + service + command**
   - `src-tauri/src/conversations/repository.rs`：`delete_subtree`（校验 user/非根、递归 CTE 收集、事务内摘除触发器→删除→重建触发器）。
   - `src-tauri/src/conversations/service.rs`：`delete_node_subtree(conversation_id, node_id)`。
   - 注册 Tauri command `delete_conversation_node`，`error.rs` 映射领域错误。
   - 测试：`src-tauri/tests/tree_persistence.rs` 新增——删除子树成功且后代清空、触发器仍在（直接 DELETE 仍失败）、删根/assistant/跨会话节点报错。
2. **Frontend IPC + store**
   - `src/lib/tauri/client.ts`：`CONVERSATION_COMMANDS.delete_conversation_node` 绑定。
   - `src/features/conversations/store/index.ts`：`deleteNodeSubtree(nodeId)`（子树移除、父 childIds 更新、activeNodeId 重定向父节点、generationRuns 清理）。
   - 测试：`store/store.test.ts` 新增对应用例（含 AC4 重定向）。
3. **Panorama UI + 确认框 + i18n**
   - `ConversationPanorama.tsx`：`PanoramaNodeData` 增加 `onDeleteNode`/`isRoot`，user 非根节点操作栏加 Trash 删除按钮。
   - `ConversationWorkspace.tsx`：`pendingDeleteNodeId` + `ConfirmDialog`（destructive）+ `onDeleteNode={canMutate ? ... : null}`。
   - `locales/zh-CN.ts` / `en.ts`：新增 3 个 key。
   - 测试：`ConversationPanorama.test.tsx`（按钮显示条件、点击回调）、`ConversationWorkspace.test.tsx`（确认/取消流程，AC2/AC3）。

## Validation Commands

- `pnpm test`（vitest 全量）
- `pnpm typecheck && pnpm lint`
- `cd src-tauri && cargo test`
- 收尾：`pnpm check`

## Risky Files / Rollback Points

- `src-tauri/src/conversations/repository.rs`：触发器摘除/重建必须配对，参考既有会话删除实现（~295-337）；失败路径回滚后确认触发器存在。
- `src/features/conversations/store/index.ts`：`activeNodeId` 重定向遗漏会导致 TREE_INTEGRITY_ERROR；先写测试再实现。
- 回滚：单 commit revert，无迁移。

## Review Gates

- 步骤 1 完成后跑 `cargo test` 再进前端。
- 全部完成后跑 `pnpm check` + `cargo test`，再进入 trellis-check。
