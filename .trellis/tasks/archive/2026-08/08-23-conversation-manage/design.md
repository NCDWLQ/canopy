# Design — Conversation rename, delete & unarchive

技术设计。锚点与事实依据见 `research/codebase-survey.md`，需求见 `prd.md`。

## 1. 总体边界

三个新 IPC 命令（`rename_conversation` / `delete_conversation` / `unarchive_conversation`）走冻结契约五处同组变更；前端侧栏行操作改造为「…」DropdownMenu；新增重命名 Dialog 与删除 AlertDialog；store 增三个 action；不新增错误码、不加迁移（删除走事务内 trigger 处理）。

## 2. Rust 后端

### 2.1 DTO 与命令（commands.rs）

- `RenameConversationRequest { conversation_id: String, title: String }` — 校验：`validate_id`（同 archive_conversation 命令 :645-654 的模式）+ `validate_title`（:395-404，trim 非空 ≤200）。
- `DeleteConversationRequest { conversation_id: String }` — 校验 `validate_id`。
- `UnarchiveConversationRequest { conversation_id: String }` — 校验 `validate_id`，请求形态与 archive 完全同构。
- `#[tauri::command] rename_conversation(request)` → service → 返回 `Conversation`（DTO 序列化同 archive 的 archived_conversation 形态）。
- `#[tauri::command] delete_conversation(request)` → service → 返回 `DeleteConversationSuccess { conversation_id: String }`（实体已删，仅回显 id；轻量且夹具友好）。
- `#[tauri::command] unarchive_conversation(request)` → service → 返回 `Conversation`（`isArchived: false`）。
- `CONVERSATION_COMMAND_NAMES`（:19-29）追加三个命令名（9→12，按现有排列惯例插入）；冻结测试 :672-677 更新（`len == 12` 及断言元素）。

### 2.2 service.rs

- `rename_conversation(&self, id, title)`：事务内 `update_title`（复用 repository :197-212，返回 bool）→ `false` 时 `NotFound { entity: "conversation" }` → 重读会话返回 `Conversation`（参考 archive :385-394 的事务 + 重读模式）。注意现有 `service.update_title`（:370-383）返回 `()` 且内部已开事务——新方法不复用它，直接走「事务 + repo + 重读」，与 archive 一致。
- `delete_conversation(&self, id)`：`pool.begin()` → `repo::delete_conversation(&mut tx, id)` → `commit()`。
- `unarchive_conversation(&self, id)`：与 `archive_conversation`（:385-394）逐行对称——事务 + `repo::unarchive_conversation` + 返回 Conversation。

### 2.3 repository.rs

**unarchive**（与 archive_conversation :214-238 逐行对称）：

```sql
UPDATE conversations SET is_archived = 0 WHERE id = ?1 AND is_archived = 1
```

rows_affected == 0 → 重查（行存在则原样返回=幂等，不存在 → `NotFound`），语义与 archive 的现有实现完全一致。

**delete 的 trigger 方案**：

```sql
-- 同一事务内依序执行（SQLite DDL 可事务化）
DROP TRIGGER IF EXISTS nodes_reject_delete;
DELETE FROM nodes WHERE conversation_id = ?1;
DELETE FROM conversations WHERE id = ?1;   -- rows_affected == 0 → NotFound（先删 nodes 后删主行，deferred FK 0002:5-8 在 commit 时满足）
CREATE TRIGGER nodes_reject_delete <与迁移 0002:87-91 完全相同的定义>;
```

- 失败早退 → 隐式回滚（含 trigger 的 DROP 一起回滚，保护不被破坏）。
- 重建 trigger 的 SQL 与迁移源重复：接受。防漂移由测试保证（tree_persistence：删除后直接 `DELETE FROM nodes` 仍 ABORT）。
- 备选方案（否决）：迁移改造 FK 为 `ON DELETE CASCADE` 并调整 trigger——SQLite 的 FK 级联删除与行级 trigger 的交互依赖 pragma 行为，且要动不可变 schema，风险大于收益。
- 错误映射：`from_write("delete_conversation_nodes" / "delete_conversation", error)`；若运行期出现 `node_history_cannot_be_deleted` 文本，现有 marker 清单（conversations/error.rs:40-58）已将其映射 `invalid_input`，无需新增。

### 2.4 lib.rs

- `register_commands`（:25-48）与 test-only `register_conversation_commands`（:9-23）两处都注册（三个命令）。
- mock IPC 测试 requests 数组（:105-150）加三个新命令样例。

## 3. 契约夹具（contract-fixtures/conversation-ipc.json）

- `command_names`：9 → 12。
- `requests`：`rename_conversation` / `delete_conversation` / `unarchive_conversation` 各一条合法样例。
- `successes`：`renamed_conversation`（= Conversation 形态）、`deleted_conversation`（`{ conversation_id }`）、`unarchived_conversation`（= Conversation 形态，isArchived=false）。
- `errors`：不新增（11 个错误码已全覆盖，无需逐命令重复）。
- `malformed_*`：视现有夹具粒度，仅当同形态 DTO 已有 malformed 用例时才补。

## 4. 前端封装（src/lib/tauri/）

- `schemas.ts`：`renameConversationRequestSchema = z.object({ conversationId: z.string(), title: titleSchema })`（camelCase 投影同现有请求，见 :75-129 的 serde rename_all 惯例）；`deleteConversationRequestSchema` / `unarchiveConversationRequestSchema` 同构 archive 请求（:100-101）；`deleteConversationSuccessSchema = z.object({ conversationId: z.string() })`。
- `client.ts`：`CONVERSATION_COMMANDS`（:40-50）加三名；`renameConversation(input): Promise<ConversationView>`（conversationDtoSchema → mapConversation）；`deleteConversation(input): Promise<{ conversationId: string }>`；`unarchiveConversation(input): Promise<ConversationView>`（返回形态同 archiveConversation）。
- `index.ts` 导出新类型。

## 5. 前端状态与 UI

### 5.1 store action（store/index.ts）

- `renameConversation(client, id, title)`：调命令成功后，双通道更新（当前会话 title + history 摘要 title），逻辑对齐 `applyTitleUpdate`（:605-625）但不走事件，直接 set。
- `deleteConversation(client, id)`：对齐 archive action（:1352-1441）的分支结构：
  - 非当前会话：仅从 `history.summaries` 移除。
  - 当前会话（D5：直接回空状态，不选落点）：调命令成功后全局会话状态重置为 `initialState` 形态（`conversationId: null`、`title: null`、`status: "idle"`、nodes/expanded/runs 清空，参考 initialState store/index.ts:237-257）+ `removeRunRecord`；`history.summaries` 移除该项——剩余非空 → `status: "ready"`，为空 → `status: "empty"`（:119 形态）。不调用 `loadSelectedConversation`，无 epoch 竞态。
- `unarchiveConversation(client, targetId)`：与 `archiveConversation`（:1352-1441）逐分支镜像：
  - 守卫：非当前且摘要已未归档 → return；当前且 `!state.isArchived` → return。
  - 非当前：调命令 → 校验返回（id 匹配且 `!isArchived`，否则 history 通道 TREE_INTEGRITY_ERROR）→ 更新摘要 `isArchived: false`；错误走 history 通道。
  - 当前：`status:"loading"` → 调命令 → 校验（id / rootNodeId / `!isArchived`）→ `isArchived: false` + 摘要同步 + `status:"ready"`；不涉及 run（归档时已 `removeRunRecord`）。

### 5.2 控制器（useWorkspaceGenerationController.ts）

- `deleteConversation` 入口与 archive（:379-392）同构：先 `cancelRunFor(conversationId)` 再调 store action。
- `unarchiveConversation` 直接调 store action，无 run 处理。rename 不涉及 run。

### 5.3 侧栏行 UI（ConversationWorkspace.tsx）

- 移除原归档 hover 按钮（:416-428），替换为「…」ghost 图标按钮（MoreHorizontal，`group-hover:opacity-100` 同款浮现 + Tooltip/aria-label）。
- DropdownMenu（范例 ProviderSettingsList.tsx:121-165）：
  - 未归档行：重命名 / 归档 / Separator / 删除（`text-destructive` 样式）。
  - 已归档行：重命名 / 取消归档 / Separator / 删除。
- 归档保持现有确认框链路（`pendingArchiveId` → controller.archiveConversation）；取消归档菜单直达 `controller.unarchiveConversation`，无确认框。
- 点击行外或操作后关闭菜单；菜单 Trigger `asChild` 包按钮。

### 5.4 重命名 Dialog（新组件，如 `RenameConversationDialog.tsx`）

- Dialog + Input + Label（范例 ProviderSettingsEditor.tsx / SettingsDialog.tsx）：预填当前标题，打开时全选；即时校验（trim 非空、≤200 字符，非法禁用保存 + 行内提示）；保存 → `store.renameConversation`；命令错误进 Dialog 内错误区，按 `commandErrorMessage(code)` 展示（错误展示契约见 i18n spec）。
- 状态：`pendingRenameId` + 打开时快照标题。

### 5.5 删除 AlertDialog

- 复用归档确认结构（:694-738）+ Provider 删除的 destructive 按钮（ProviderSettingsList.tsx:202-239）：`pendingDeleteId` state；正文含不可恢复警示；目标会话 run 进行中时附中断提示（对齐 archiveConfirmInterrupts 文案模式）。

### 5.6 i18n（zh-CN.ts 为类型源，en.ts 键集同步）

新增键（命名沿 `conversation.workspace.*` 惯例）：
`conversationMenu`（aria）、`rename`、`unarchive`「取消归档」、`deleteAction`（或复用 `common.delete`）、`renameDialogTitle`、`renameDialogLabel`、`renameDialogTitleTooLong`、`renameDialogTitleBlank`、`deleteConfirmTitle`、`deleteConfirmBody`、`deleteConfirmInterrupts`、`deleteConfirmAction`（复用 `common.delete`）。`common.cancel/save/delete` 已存在，直接复用。

## 6. 测试矩阵

### Rust
- 命令名冻结测试（9→12）。
- command_boundary.rs：夹具往返自动覆盖三个新命令。
- tree_persistence.rs：删除后两表无残留行；删除后直接 `DELETE FROM nodes` 仍 ABORT（trigger 完整性）；NotFound；删除事务原子性（参照 :522-540 的 trigger 测试手法）；unarchive 与 archive 的往返翻转（归档→取消归档→isArchived=false 且幂等：对未归档行再调用原样返回）。
- lib.rs mock：三个新命令请求样例可被注册调用。

### 前端
- client.test.ts：命令数计数（"nine"→按新数 12）+ 三个新 shape 断言 + 错误归一化沿用 :207。
- store.test.ts：rename 双通道；delete 的三分支（非当前 / 当前且剩余非空 → 空态会话 + history ready / 当前且无剩余 → 空态会话 + history empty）+ run 清理 + 确认不自动加载落点；unarchive 的镜像分支（非当前仅摘要、当前清除只读态、TREE_INTEGRITY 校验失败走对应错误通道）。
- ConversationWorkspace.test.tsx：菜单项渲染（未归档/已归档差异——归档项 vs 取消归档项）、rename Dialog 打开与校验态、delete 确认交互、删除后落点断言、取消归档直达无确认框（对齐现有归档测试 :655-687 手法）。

## 7. 兼容与回滚

- 无迁移、无错误码变更、无 capabilities 变更 → 老数据兼容天然成立。
- 回滚 = revert 单分支；前端旧版 + 新版后端（或反之）不会出现：命令为新增，旧前端不调用。
- 风险点：trigger 重建 SQL 与迁移漂移（测试守护）；删除当前会话的状态迁移遗漏 run 记录（store 测试守护）。
