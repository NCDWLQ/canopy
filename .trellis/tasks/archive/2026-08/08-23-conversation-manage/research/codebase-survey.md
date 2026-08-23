# Codebase Survey — 对话重命名与删除（commit 878e189 = main）

调研范围：`/home/jwh/Code/canopy-manage` 工作树。目的：为新增「会话重命名 + 删除」摸清现状与改动面。所有锚点相对仓库根。

## 1. 侧栏会话列表（前端）

- 侧栏**没有独立组件文件**，内嵌于 `src/features/conversations/components/ConversationWorkspace.tsx`：
  - 容器 `<aside id="conversation-tree-sidebar">`：`ConversationWorkspace.tsx:327-335`（`w-64 md:w-80`，可折叠）
  - 顶栏 + 新建按钮（SquarePen）：`ConversationWorkspace.tsx:336-359`
  - 列表渲染：`ConversationWorkspace.tsx:360-434`。每项：`<li>`(:375) → 行容器(:376-383) → 主按钮(:384-415，标题 span :396-401、标题生成中 Spinner :402-409、已归档 Badge :410-414) → **归档按钮**(:416-428，Archive 图标，hover 浮现 `opacity-0 group-hover:opacity-100`，已归档行隐藏该按钮)
- 每行目前**只有一个直接按钮操作，无 dropdown-menu**。纯 Tailwind + shadcn Button/Badge/Spinner/Tooltip。

### 归档完整链路（新增命令的模式参考）

1. 前端：`ConversationWorkspace.tsx:424` `setPendingArchiveId(summary.id)`；state :164；摘要/运行中判断 :314-323；AlertDialog :694-738（取消 :722-724，确认 :725-735 调 `controller.archiveConversation`）
2. 控制器（先取消该会话活跃生成 run）：`src/features/conversations/hooks/useWorkspaceGenerationController.ts:379-392`
3. store action：`src/features/conversations/store/index.ts:1352-1441`（非当前会话 = 仅 history 通道；当前会话 = 全局状态迁移 + `removeRunRecord` :1436）
4. IPC 封装：`src/lib/tauri/client.ts:196-205` → 命令名映射 `CONVERSATION_COMMANDS` :40-50
5. Rust 命令：`src-tauri/src/conversations/commands.rs:645-654`（`#[tauri::command]` + `production_service` :556-566）；service（`validate_id`）:357-367
6. 持久化：`src-tauri/src/conversations/service.rs:385-394`（`pool.begin()` → repo → `commit()`）→ `src-tauri/src/conversations/repository.rs:214-238`（`UPDATE ... SET is_archived=1`，`rows_affected==0` 时重查以 `NotFound` 收口）

## 2. IPC 命令清单

- 会话命令 9 个（`CONVERSATION_COMMAND_NAMES`）：`src-tauri/src/conversations/commands.rs:19-29` — create_conversation / append_node / create_branch / edit_node_as_branch / list_conversations / load_conversation_tree / load_active_path / archive_conversation / set_conversation_provider
- 提供商命令 11 个：`src-tauri/src/providers/commands.rs:22-34`
- **不存在 rename/update_title/delete 会话命令**。`update_title` 只在持久层（repository :197-212 / service :370-383），被自动标题内部调用。
- 命令注册**两处都要同步**：生产 `register_commands` `src-tauri/src/lib.rs:25-48` + test-only `register_conversation_commands` lib.rs:9-23
- 命令名冻结测试：`commands.rs:672-677`（断言 `len == 9`，需更新）
- 错误码 `CommandErrorCode` 11 个：`src-tauri/src/error.rs:8-20`。`PersistenceError`：`src-tauri/src/conversations/error.rs:5-27`；**拒绝 marker 字符串清单**（trigger 报错文本 → invalid_input 映射）：`conversations/error.rs:40-58`，删除相关新 marker 要登记在此
- Mock IPC 注册测试（新命令需加请求样例）：`lib.rs:97-175`；参数校验先于 DB 的测试范例 :218-267

## 3. 契约同步点（新增命令的五处同组变更）

- 共享夹具 `contract-fixtures/conversation-ipc.json`：顶层 `command_names / requests / successes / errors / malformed_successes / malformed_command_successes / malformed_errors`；`errors` 恰好 11 条（每错误码一条）
- Rust 往返测试：`src-tauri/tests/command_boundary.rs:80-178`
- 前端封装 `src/lib/tauri/`：
  - `client.ts` — 命令名常量 :40-50、`createConversationClient` :103-228、通用 `call()` :230-260（zod 请求校验 → invoke → zod 响应校验 → project）、错误归一化 :262-277
  - `schemas.ts` — wire DTO zod 镜像（请求 :75-129，`commandErrorCodeSchema` :131-143，DTO :154-225，`titleSchema` :57-59）
  - `types.ts` — `UiErrorCode`/`UiError` :23-41；`index.ts` 桶导出
  - `title-events.ts` — 标题事件监听通路 :10-46
- 前端 View 类型：`src/features/conversations/types/index.ts`（`ConversationView` :15、`ConversationSummaryView` :25）
- 错误码 i18n 映射：`src/lib/i18n/command-errors.ts:10-22`

## 4. 标题机制（rename 的地基）

- 表结构 `src-tauri/migrations/0002_conversation_tree.sql:1-8`：`title TEXT NOT NULL`，DB 无长度约束；identity/root 不可变 trigger :93-98（**title 可 UPDATE**，无 immutable trigger）
- 应用层校验：`commands.rs:395-404` `validate_title`（trim、非空、≤200，`MAX_TITLE_CHARS` :16）；前端镜像 `schemas.ts:57-59`
- 自动标题（OpenAI 兼容/Anthropic 均可，模型可经 `set_title_model_binding` 配置）：
  - 触发：`src-tauri/src/providers/commands.rs:596-603`（生成 `GenerationOutcome::Completed` 后 `spawn_auto_title`）
  - 实现：`src-tauri/src/providers/titles.rs:38-109`（读 auto_generate_title 设置 → `load_auto_title_context` → 流式生成 → `clean_title` :140-145 → `persistence.update_title` :97-100 → emit `conversation://title-updated`，常量 :14，payload :16-20）
  - 条件：`service.rs:338-368` — 需存在首个 user 节点且**恰好一个** assistant 节点，否则跳过
  - Prompt：`src-tauri/src/providers/title_prompt.rs:5-42`
- **没有手动改标题入口**（grep rename/重命名 无结果）
- 标题事件前端通路：`title-events.ts:10-46` → `useConversationTitleUpdates.ts:5-23` → store `applyTitleUpdate` `store/index.ts:605-625`（同步当前 title + history summary——rename 成功后可复用）

## 5. 删除语义（关键阻碍）

- 外键：`nodes.conversation_id REFERENCES conversations(id)`（`0002:25`）**无 ON DELETE CASCADE**；`conversations → nodes` 复合 DEFERRABLE INITIALLY DEFERRED FK（`0002:5-8`）。provider_id `ON DELETE SET NULL`（`0005:55`）
- **硬阻碍**：trigger `nodes_reject_delete`（`0002:87-91`）对任何 `DELETE ON nodes` 直接 ABORT `'node_history_cannot_be_deleted'`；直接删 conversation 行会被子节点 FK 拦截 → 删除会话必须在一个事务内处理 trigger（SQLite DDL 可事务化；运行时 DROP TRIGGER 先例：`src-tauri/tests/tree_persistence.rs:522-525`），或新增迁移改造 trigger/加级联
- 现有删除路径仅 provider：`providers/repository.rs:114-118` + 事务化 service `providers/service.rs:367-376`。会话/消息**没有任何删除路径**
- 事务惯例：service 方法 `pool.begin()` → `&mut transaction` 传 repository 静态方法 → `commit()`，早退隐式回滚（范例 service.rs:30-58、:370-383、:385-394）；写错误走 `PersistenceError::from_write`（`conversations/error.rs:37-70`）
- 前端删除需处理的关联状态：活跃/终态 run 记录（参考 `store/index.ts:1388、1436` + controller `cancelRunFor` :379-392）；删除当前会话后落点参考 history 初始化 `store/index.ts:655`（选最新未归档）
- 迁移注册处：`src-tauri/src/database.rs:15-46` `MIGRATION_CATALOG`

## 6. UI 组件库

`src/components/ui/` 现有：alert-dialog, alert, badge, breadcrumb, button, checkbox, collapsible, dialog, dropdown-menu, field, input-group, input, label, marker, popover, select, separator, spinner, switch, textarea, toaster(+test), toggle-group, toggle, tooltip。

- 确认交互统一模式 = **AlertDialog + pendingId state**（无 window.confirm）：
  - 归档确认：`ConversationWorkspace.tsx:164` + :694-738
  - Provider 删除确认（最贴近会话删除）：`src/features/providers/components/ProviderSettingsList.tsx:202-239`
- DropdownMenu 范例：`ProviderSettingsList.tsx:121-165`（Trigger asChild + ghost icon Button + Content align="end" + Item/Separator）——若会话项改 "…" 菜单（重命名/归档/删除）这是唯一参考
- Dialog 表单范例（rename 对话框参考）：`src/features/settings/components/SettingsDialog.tsx`、`src/features/providers/components/ProviderSettingsEditor.tsx`（含 Input 用法）
- Toast：`src/components/ui/toaster.tsx`

## 7. i18n 词典

- `src/lib/i18n/locales/zh-CN.ts`（**类型级 source of truth**，导出 Dictionary 类型）与 `en.ts`（键集必须完全同步，zh-CN.ts 头注 :1-8）
- 扁平点号键 `<feature>.<component>.<name>`；`src/lib/i18n/index.ts`（Dictionary :4,13、StaticMessageKey :25-26、`t()` :37+）
- sidebar 现有键（zh-CN.ts:36-67 一带）：`conversation.workspace.sidebar`/`newConversation`/`history`/`historyList`/`archivedBadge`/`archive`/`archivedReadonlyBadge`/`archiveConfirmTitle/Body/Interrupts/Action`
- **已存在可复用**：`common.delete`「删除」（zh-CN.ts:18）、`common.cancel/save`（:13-16）
- 错误文案：`command-errors.ts:10-22` + zh-CN.ts:21-33 `errors.*`

## 8. 测试模式

- Rust 三层：
  1. 契约往返 `src-tauri/tests/command_boundary.rs:80-178`（夹具更新自动覆盖新命令；`:180+` 假 IdentityTimeSource；`:233+` 真实 SQLite 事务性策略测试）
  2. Mock IPC 注册/错误形态 `src-tauri/src/lib.rs:97-175`（新命令要在 :105-150 加样例）
  3. DB 级 `src-tauri/tests/tree_persistence.rs`（helper `tests/support/mod.rs:238-242`；archive 测试 :452-467；trigger 破坏测试 :503-540）
- 内联单测 `commands.rs:667-712`（冻结名测试 :672-677）
- 前端 vitest（`pnpm check` = 全量门）：
  - `src/lib/tauri/client.test.ts`（首测 :41 "maps all nine request shapes"——计数文案要更新；错误码 :207）
  - `store/store.test.ts`（archive :443-482+；mock client :119）
  - `ConversationWorkspace.test.tsx`（归档 UI/只读 :655-687）
- 实现前应读的 spec：`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/backend/error-handling.md`、`.trellis/spec/frontend/i18n-guidelines.md`、`.trellis/spec/frontend/state-management.md`

## 9. 新增 rename/delete 命令的完整改动面

**Rust 后端**
1. `commands.rs` — `RenameConversationRequest`（复用 `validate_title`）/`DeleteConversationRequest` DTO、service 方法、`#[tauri::command]`；`CONVERSATION_COMMAND_NAMES` 加名；更新冻结测试 :672-677
2. `lib.rs` — 生产 :26-47 与 test-only :12-22 两处注册；mock 测试样例 :105-150
3. `service.rs` — `rename_conversation`（可包装 `update_title` :370-383 返回 Conversation）；`delete_conversation`（新事务；活跃 run 语义参考 archived 守卫 :245）
4. `repository.rs` — rename 复用 `update_title` :197-212；delete 在事务内处理 trigger（DROP → 删 nodes → 删 conversation，注意 deferred FK；marker 登记 `conversations/error.rs:46-55`）
5. （可选）`migrations/0007_*.sql` + `database.rs:15-46` — 若走迁移放行删除
6. `command_boundary.rs` / `tree_persistence.rs` — NotFound、trigger/FK、事务原子性测试

**契约**
7. `contract-fixtures/conversation-ipc.json` — command_names / requests / successes（+ malformed_*）——双端往返测试自动生效

**前端封装**
8. `schemas.ts` — 请求/响应 zod（rename 仿 `archiveConversationRequestSchema` :100-101；title 用 `titleSchema`）
9. `client.ts` — `CONVERSATION_COMMANDS` 加名 + 方法（rename 返回 conversationDto→mapConversation；delete 建议轻量确认结构）
10. `index.ts` 导出新类型；（`types/index.ts` 视需要）

**前端状态与 UI**
11. `store/index.ts` — `renameConversation`（参考 `applyTitleUpdate` :605-625 双通道）/`deleteConversation`（参考 archive :1352-1441 current/non-current 分支 + run 清理 + 落点 :655）
12. `useWorkspaceGenerationController.ts` — delete 前取消活跃 run（参考 :379-392）
13. `ConversationWorkspace.tsx` — 侧栏行操作（hover 按钮或 DropdownMenu）；rename 用 Dialog+Input；delete 用 AlertDialog（`pendingArchiveId` 模式）
14. `zh-CN.ts` + `en.ts` — 新键（rename/delete 相关；`common.delete` 已存在）

**前端测试**
15. `client.test.ts`（"nine" 计数 + 新 shape）、`store.test.ts`、`ConversationWorkspace.test.tsx`

## 10. 与待定事项的关联（记忆中的 pending）

- 侧栏 shadcn 迁移（官方 Sidebar 组件）pending —— 本任务的行操作改造应避免与其冲突
- 消息工具栏统一 pending —— 与本任务侧栏行按钮是不同区域，但 hover 图标风格应保持一致
