# 代码调研：会话搜索相关事实（2026-08-23，Explore 代理全量扫描）

所有路径相对仓库根（worktree canopy-search @ 878e189）。本报告是 PRD/design 的事实依据。

## 存储

- sqlx 0.8.6 + tauri-plugin-sql 2.4.0，SQLite（`src-tauri/Cargo.toml:26-29`）。无 rusqlite。
- DB `sqlite:canopy.db`（`database.rs:6`），插件托管 pool 从 `DbInstances` 解析（`database.rs:60-66`）；6 个迁移 `include_str!`（`database.rs:15-46`）。
- 表（`migrations/0002_conversation_tree.sql`）：
  - `conversations`（1-8 行）：`id TEXT PK, title NOT NULL, root_node_id`；`is_archived`（0003）、`provider_id/model/reasoning_effort`（0004/0005 后）。**无自身时间戳**，`updated_at = MAX(nodes.created_at)` 派生。
  - `nodes`（10-28 行）：`id, parent_id, conversation_id, role CHECK('system','user','assistant','tool'), content NOT NULL, model, created_at INTEGER(epoch ms), metadata, is_archived(兼容列，恒 0)`。
  - 索引（30-38 行）：仅树结构索引；**title/content 无索引、无 FTS**。
- 追加式触发器：`nodes_immutable_history`（62-74）、`nodes_reject_delete`（87-91）、`conversations_immutable_identity_and_root`（93-98）；归档守卫（0003:9-39）。
- FTS5：当前无使用；但 bundled libsqlite3-sys 0.30.1 编译开启 `-DSQLITE_ENABLE_FTS5`（其 build.rs:127-129），未来可用；unicode61 分词不适合中文。

## 后端命令模式

- 命令模块 `src-tauri/src/conversations/commands.rs`：
  - `CONVERSATION_COMMAND_NAMES` 冻结 9 名（19-29），测试断言（673-677）。
  - `list_conversations`（623-632 / service 326-340）：请求 `{}`（68-70），响应 `Vec<ConversationSummaryDto>`（144-158：`id,title,root_node_id,is_archived,updated_at,provider_id?,model?,reasoning_effort?`），**无分页**。
  - `load_conversation_tree`（612-621）整树返回；`load_active_path`（634-643）递归路径。
  - 模式：`#[tauri::command]` 从 `State<DbInstances>` 构造 `production_service()`（556-566）→ `ConversationCommandService`；DTO `snake_case + deny_unknown_fields`。
- SQL 仓储 `repository.rs`：`list_conversations`（79-96，`MAX(n.created_at) AS updated_at`，`ORDER BY updated_at DESC, c.id ASC`，含归档）；`load_nodes`（115-128）；路径 CTE `load_validated_path`（130-181）。
- 事务边界 `service.rs`：`list_conversations`（204-209）。标题≤200、内容≤1MiB（`commands.rs:16-17`）。
- 注册 `lib.rs:25-48`（9 conversation + 12 provider）；capabilities 仅 `core:default`（webview 无 SQL 权限）。

## 前端

- 侧栏内联于 `src/features/conversations/components/ConversationWorkspace.tsx`（`<aside id="conversation-tree-sidebar">` 327-335；History 361-462；列表项=标题+Spinner+归档 Badge+悬停归档按钮，**无时间戳/预览**）。
- Store：Zustand `useConversationStore`（`store/index.ts:549`）；`history` 切片（108-124）；`initializeHistory`（627-686）一次性全量+自动选中首个非归档会话；排序 `sortedSummaries`（263-271）。
- 类型化 IPC 客户端 `src/lib/tauri/client.ts`：`CONVERSATION_COMMANDS`（40-50）、`call()` 泛型 zod 双校验（230-260）、DTO→view 映射（298-449）；schema `src/lib/tauri/schemas.ts`（如 90）。
- 视图类型 `features/conversations/types/index.ts`：`ConversationSummaryView`（24-26）、`TreeNodeView`（28-33）。
- **无任何搜索/过滤 UI、无全局快捷键监听**；键盘处理仅 Composer Enter（`Composer.tsx:62-72`，IME 安全）与 OutlineTree 树导航（`OutlineTree.tsx:124-190`）。
- 消息面板 `ConversationPane.tsx`：`path.map()` 渲染于 `role="log"`（224-274），**无虚拟化**；仅 `bottomRef` 自动滚底（154-174，key=pathScrollKey）；**无单消息滚动锚点/高亮机制**。
- 消息 `MessageNode.tsx` → `MessageBubble`（用户右侧 34-51 / 助手左侧 53-71 / 系统·工具居中 73-88）+ `AssistantMarkdown`。
- 会话切换：`ConversationWorkspace.tsx:392-394` → `selectConversation`（`store/index.ts:700-705`）→ `loadSelectedConversation`（554-587，requestEpoch 防过期 551）→ `loadedTreeState`（339-363，activeNodeId=确定性最新叶子 309-323，expandedIds=祖先链 325-337）。
- `selectActivePath`（1515-1584）：改 activeNodeId 重派生可见路径。
- i18n：`src/lib/i18n/locales/zh-CN.ts`（源，定义 `Dictionary`）+ `en.ts`（`satisfies Dictionary`），各 178 键，扁平点分；`t()`/`useTranslation()`（`i18n/index.ts:47-53`）；错误码→文案 `command-errors.ts:10-22`。

## 规范约束（.trellis/spec/）

- `backend/database-guidelines.md`：React 不执行 SQL；仓储管 SQL、服务管事务、命令只做 DTO 校验/调用/错误映射（30-33,386-414）；迁移前向 only、命名 `0007_xxx.sql`（500-516）；webview 禁 SQL 权限（33-35）。
- `backend/error-handling.md`：闭合 `CommandErrorCode` 枚举（29-41，含 `invalid_input`）；新增码=五处同步共享契约变更（43-45）；UI 只渲染 `commandErrorMessage(code)`。
- `backend/directory-structure.md`：domain/error/repository/service/commands 分层（44-63）；命令无 SQL（66-72）；集成测试在 `src-tauri/tests/`，共享助手 `tests/support/`。
- `frontend/type-safety.md`：Typed IPC Boundary 场景（55-116）——新命令需同步 `commands.rs`、`error.rs`、`contract-fixtures/conversation-ipc.json`、`src/lib/tauri/`、前端 types（58-63）；夹具双端消费无副本（94-96）；命令名冻结（81-85）。
- `frontend/state-management.md`：无 persist/localStorage（74-78）；requestEpoch 单调（79-81）；history 错误进 `history.status/error` 而非全局（129-134）。
- `frontend/component-guidelines.md`：组件不裸调 invoke/SQL（10-12）；feature 目录结构（102-125）。
- `frontend/quality-guidelines.md:16-50`：滚动合成约束（overflow-y-auto+原生滚动条+contain:paint）；加虚拟化前须验证。
- `frontend/i18n-guidelines.md`：词典规则（12-24）；不翻译用户输入内容。
- `guides/index.md:37-44`：新增 RPC payload 触发跨层清单。

## 数据量与测试

- 无分页全量是现状；夹具小（3 会话 `tree_persistence.rs:459-462`）；标题≤200、内容≤1MiB；预览截断 60 字符（`store/index.ts:36-43`）；派生标题 40 scalars（`deriveConversationTitle.ts`）。
- Rust 测试：`tests/support/mod.rs` `migrated_pool()` 内存库回放迁移（238-263）、`run_async`（16-18）；`command_boundary.rs` 用 `SequenceSource` 确定性 ID+共享夹具断言（34-68, 80+）；`lib.rs:97-268` mock IPC 注册+fail-closed。
- 前端测试：Vitest4+RTL+user-event（`vite.config.ts:26-31`）；组件测试经 props 注入 fake client（`ConversationWorkspace.test.tsx:22-31`，33 用例）；store 测试无 React（29 用例）。
