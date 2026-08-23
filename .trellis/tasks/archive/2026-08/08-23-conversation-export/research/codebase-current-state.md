# 代码库现状调研（对话导出前置）

> 调研时间：2026-08-23，基线 commit 878e189（main）。路径均相对仓库根。

## 技术栈

Tauri v2（Rust）+ React 19 / TS + zustand + shadcn（radix-ui），Markdown 渲染用 Streamdown 2.4.0 + @streamdown/code。无 i18n 库，自研类型化字典。

## 对话数据模型

- Rust 领域类型 `src-tauri/src/conversations/domain.rs`：
  - `Conversation`（L6–14）：`id, title, root_node_id, is_archived, provider_id, model, reasoning_effort`
  - `Role` 枚举（L66–96）：`system | user | assistant | tool`
  - `Node`（L110–119）：`id, parent_id, conversation_id, role, content: String, model, created_at: i64(epoch ms), metadata: serde_json::Value`
  - 对话是**树**；界面可见聊天 = 激活路径（root→leaf 链）。`ConversationTree`（L134）、`ValidatedPath`（L140–154）。
- IPC DTO：`src-tauri/src/conversations/commands.rs`（`ConversationDto` L131、`NodeDto` L162、`ActivePathDto` L182），全部 snake_case + `deny_unknown_fields`；错误信封 `src-tauri/src/error.rs`。
- TS 侧：wire DTO + zod schema `src/lib/tauri/schemas.ts`（L75–231）；视图模型 `src/lib/tauri/types.ts`（`ConversationNodeView` 含 `thinking?`）与 `src/features/conversations/types/index.ts`。
- thinking 存在 `nodes.metadata` JSON 的 `{"thinking": "..."}`，写入点 `src-tauri/src/providers/generation.rs` L281–283；前端仅对 assistant 节点投影 `thinking`（`src/lib/tauri/client.ts` mapNode L319–340）。
- **没有**图片/附件支持；**没有** token 用量持久化；每节点只有 `created_at`。会话 `updated_at = MAX(n.created_at)`（repository.rs L79–96）。
- 持久化：SQLite via `tauri-plugin-sql`，`sqlite:canopy.db`（`src-tauri/src/database.rs` L6）。schema 在 `src-tauri/migrations/`（0001 建 conversations+nodes、不可变历史触发器；节点内容上限 1 MiB、标题 200 字符 `commands.rs` L16–17）。导出是纯读操作，节点不可变。

## 现有复制/导出能力与插件

- 单条消息复制：`navigator.clipboard.writeText`（web API 非插件），`src/features/conversations/components/MessageNode.tsx` L101–112（按钮 L238–261，i18n key `conversation.message.copy/copied`）。
- 代码块复制 + 表格复制（CSV/MD/TSV）：Streamdown 内建，`AssistantMarkdown.tsx` L53–57（`code: {copy: true, download: false}`）、`TableCopyDropdown` L110–126。
- **没有**整对话导出、没有任何文件保存对话框（前后端 grep 均无）。
- Cargo.toml 插件仅：`tauri-plugin-log`、`tauri-plugin-sql`、`tauri-plugin-window-state`。**无** dialog / fs / clipboard-manager。
- capabilities 只有 `core:default`（`src-tauri/capabilities/default.json`，项目约定 "SQL remains Rust-only"）；CSP `connect-src` 限 `ipc:`。文件保存需新插件 + capability 权限。

## UI 入口与命令调用

- 侧栏历史项：`ConversationWorkspace.tsx` L365–433，普通 button + hover 显示的 Archive 图标按钮（L416–428，AlertDialog 确认 L694–738）。侧栏会话项**无右键菜单/下拉菜单**（dropdown-menu 目前仅 ProviderSettingsList 用）。
- 头部：L503–582（侧栏开关、新对话、归档标记、ProviderPicker）；设置入口在侧栏 footer `SettingsDialog`（L492–499，分类 `general | providers | conversation`）。
- 状态：zustand `src/features/conversations/store/index.ts`（1584 行）；`selectConversation` L700、`loadConversation` L1083。store 同时持有树投影 `nodesById` 与全量 `fullNodes`。
- 所有 Tauri 调用走 `src/lib/tauri/client.ts`（`CONVERSATION_COMMANDS` L40–50、`call()` 带 zod 请求+响应校验 L230–260）。
- 新增命令清单模式：`commands.rs` handler（L568–665 模式）→ 命令名加进 `CONVERSATION_COMMAND_NAMES`（L19–29）→ `lib.rs` 注册（L9–48）→ contract fixture `contract-fixtures/conversation-ipc.json` 同步（`src-tauri/tests/command_boundary.rs` 冻结命令名与数量 L674）。

## i18n

- `src/lib/i18n/locales/zh-CN.ts` 是**真源**（`as const` 定义 `Dictionary` 类型）；`en.ts` `satisfies Dictionary` 漂移即编译错。语言仅 zh-CN / en。
- 约定：扁平点分 key `<feature>.<component>.<name>`；条目为字符串或 `(params) => string`；新 key 两边同加。
- 规则 `​.trellis/spec/frontend/i18n-guidelines.md`：**消息内容、thinking、对话标题永不翻译**。

## 渲染保真度

- assistant `content` 在 DB 里就是原始 Markdown；user `content` 是纯文本（`whitespace-pre-wrap`）。Markdown 导出可直接拼 `content` + `metadata.thinking`，无损。
- 渲染层：Streamdown（代码高亮+复制、表格复制、sanitize、URL 白名单、**图片仅显示 alt 文本** `ImageAltText` L98–101）；thinking 是可折叠纯文本块 `ThinkingBlock.tsx`。

## 测试与规范

- 前端 vitest（`pnpm test`，colocated `*.test.ts(x)`，setup 固定 zh-CN locale）；全量门 `pnpm check`。
- Rust：`#[cfg(test)]` 内联 + `src-tauri/tests/`（`command_boundary.rs`、`tree_persistence.rs` 等）+ `contract-fixtures/*.json` 契约测试。
- 必读 spec 索引：`.trellis/spec/frontend/index.md`、`.trellis/spec/backend/index.md`、`.trellis/spec/guides/cross-layer-thinking-guide.md`（导出横跨 DB→service→IPC→UI，直接相关）。

## 对导出功能的关键约束（结论）

1. "对话"是树：导出要么取激活路径、要么取全树（store 两者都有现成数据）。
2. 文件保存导出需新增 `tauri-plugin-dialog`（+ 可能 fs）与 capability 条目；剪贴板导出零新增依赖（有 `navigator.clipboard` 先例）。
3. 后端纯读：新命令复用 `ConversationPersistenceService::load_conversation_tree` 即可。
4. 新命令必须同步四处：`commands.rs`、`CONVERSATION_COMMAND_NAMES`、`lib.rs`、`conversation-ipc.json` + zod schema。
5. Markdown 组装可直接用节点原始内容，无需经渲染层转换。
