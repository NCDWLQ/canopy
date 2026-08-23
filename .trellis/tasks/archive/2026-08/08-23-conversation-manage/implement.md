# Implement — Conversation rename, delete & unarchive

执行清单。每步后可运行对应验证；末尾全量门。所有路径相对仓库根（工作树 `/home/jwh/Code/canopy-manage`）。

## 阶段 A：Rust 后端 + 契约（一次同组变更）

- [ ] A1 `src-tauri/src/conversations/repository.rs`：
  - `delete_conversation(connection, id)` —— 事务内 `DROP TRIGGER IF EXISTS nodes_reject_delete` → `DELETE FROM nodes WHERE conversation_id=?1` → `DELETE FROM conversations WHERE id=?1`（rows_affected==0 → NotFound）→ 按迁移 0002:87-91 原文重建 trigger。
  - `unarchive_conversation(connection, id)` —— 与 archive_conversation（:214-238）逐行对称：`UPDATE conversations SET is_archived = 0 WHERE id = ?1 AND is_archived = 1` + rows_affected==0 重查收口。
- [ ] A2 `src-tauri/src/conversations/service.rs`：`rename_conversation`（事务 + `update_title` + NotFound + 重读返回 Conversation）、`delete_conversation`（事务 + repo 删除）、`unarchive_conversation`（对称 archive :385-394）。
- [ ] A3 `src-tauri/src/conversations/commands.rs`：`RenameConversationRequest` / `DeleteConversationRequest` / `UnarchiveConversationRequest` / `DeleteConversationSuccess` DTO + 三个 `#[tauri::command]` + `CONVERSATION_COMMAND_NAMES` 追加 + 冻结测试更新（len 12）。
- [ ] A4 `src-tauri/src/lib.rs`：`register_commands` 与 `register_conversation_commands` 两处注册 + mock IPC requests 样例（:105-150）。
- [ ] A5 `contract-fixtures/conversation-ipc.json`：command_names（12）、requests（三个）、successes（renamed_conversation / deleted_conversation / unarchived_conversation）。
- [ ] A6 验证：`cargo test`（command_boundary 往返自动生效）。

## 阶段 B：Rust 策略/持久化测试

- [ ] B1 `src-tauri/tests/tree_persistence.rs`：删除清两表；删除后 `DELETE FROM nodes` 仍 ABORT（trigger 完整）；id 不存在 → NotFound；archive↔unarchive 往返翻转 + 幂等；参照 :522-540 手法。
- [ ] B2 验证：`cargo test --test tree_persistence`、`cargo clippy -- -D warnings`、`cargo fmt`（仅本次改动文件，主分支存在既有漂移）。

## 阶段 C：前端封装

- [ ] C1 `src/lib/tauri/schemas.ts`：三个请求 schema + `deleteConversationSuccessSchema`。
- [ ] C2 `src/lib/tauri/client.ts`：`CONVERSATION_COMMANDS` 加三名 + `renameConversation` / `deleteConversation` / `unarchiveConversation` 方法；`index.ts` 导出。
- [ ] C3 `src/lib/tauri/client.test.ts`：命令计数文案（nine→12）+ 新 shape 断言。
- [ ] C4 验证：`pnpm vitest run src/lib/tauri/client.test.ts`。

## 阶段 D：store + 控制器

- [ ] D1 `store/index.ts`：`renameConversation`（双通道更新）；`deleteConversation`（非当前分支 / 当前分支 = 全局重置回 initialState 空态 + run 清理 + history 移除项，剩余非空 ready、为空 empty；不自动加载落点）；`unarchiveConversation`（archive action :1352-1441 的逐分支镜像，无 run 处理）。
- [ ] D2 `useWorkspaceGenerationController.ts`：`deleteConversation` 先 `cancelRunFor`（对齐 archive :379-392）；`unarchiveConversation` 直通 store。
- [ ] D3 `store.test.ts`：rename 双通道；delete 三分支（非当前 / 当前且剩余非空 / 当前且无剩余）+ 空态重置断言（conversationId=null、不自动加载落点）+ run 清理；unarchive 镜像分支（非当前/当前/校验失败通道）。
- [ ] D4 验证：`pnpm vitest run src/features/conversations/store/store.test.ts`。

## 阶段 E：UI + i18n

- [ ] E1 `zh-CN.ts` / `en.ts`：新增 `conversation.workspace.*` 键（含 `unarchive`，清单见 design §5.6），复用 `common.cancel/save/delete`。
- [ ] E2 `ConversationWorkspace.tsx`：行操作改「…」DropdownMenu（未归档：重命名/归档/删除；已归档：重命名/取消归档/删除），移除原归档按钮；归档沿用现有确认框；取消归档菜单直达；`pendingRenameId` / `pendingDeleteId` state。
- [ ] E3 新建 `RenameConversationDialog.tsx`（Dialog+Input，预填全选，即时校验，错误区走 commandErrorMessage）。
- [ ] E4 删除 AlertDialog（复用归档确认结构 + destructive 按钮，含中断提示分支）。
- [ ] E5 `ConversationWorkspace.test.tsx`：菜单项差异（归档 vs 取消归档）、Dialog 校验态、确认交互、落点断言、取消归档直达。
- [ ] E6 验证：`pnpm vitest run src/features/conversations/components/ConversationWorkspace.test.tsx`。

## 阶段 F：全量门（提交前必过）

- [ ] F1 `cargo test`
- [ ] F2 `cargo clippy -- -D warnings`
- [ ] F3 `pnpm check`（含 vitest 全量 + lint + 类型）
- [ ] F4 `pnpm tauri dev` 手动冒烟：改名（重启仍在、排序不变）、删除（当前→回空态新对话不跳转其他会话 / 非当前 / 运行中 / 最后一条）、归档↔取消归档往返（当前会话恢复可编辑、重启后状态保持）、菜单键盘可达、中英切换文案。

## 风险文件与回滚点

- 触发器重建 SQL 漂移 → B1 测试守护；改坏可 revert 阶段 A 单个 commit。
- `ConversationWorkspace.tsx` 体量大（约 700+ 行）且承载归档交互 → 阶段 E 独立 commit，便于回滚。
- store 删除/取消归档分支状态遗漏 → D3 测试对照 archive 测试写法先行。

## 提交切分建议

1. `feat(conversations): add rename/delete/unarchive IPC commands`（阶段 A+B+夹具）
2. `feat(conversations): wire rename/delete/unarchive client + store actions`（阶段 C+D）
3. `feat(conversations): sidebar conversation menu with rename, delete and unarchive`（阶段 E）
