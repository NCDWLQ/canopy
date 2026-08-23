# 对话导出 — 技术设计

对应 PRD：`prd.md`（决策 D1–D4）。基线 commit 878e189。

## 架构总览

```
MessageNode(action 栏导出按钮)
  └─ store.exportUpToMessage(nodeId)                # zustand 新动作
       ├─ prefix = activePath.slice(0, anchorIdx+1) # 数据已在 store（PathMessageView 含完整 content）
       ├─ buildExportMarkdown(prefix, title, labels)# 前端纯函数（vitest 覆盖）
       ├─ save()                                     # @tauri-apps/plugin-dialog JS API
       │    返回 null（取消）→ 静默结束
       └─ invoke write_export_file({ path, content })
            └─ Rust: 校验 → std::fs::write → { bytes_written }
       └─ toast 成功/失败（sonner，先例 useWorkspaceGenerationController.ts）
```

职责边界：**前端拥有展示层**（i18n 角色标签、Markdown 排版、默认文件名），**Rust 拥有 OS IO**（写文件）。数据零新增读路径——激活路径每条消息的完整 `content` 已在 store 中（`PathMessageView`）。

## 备选方案与取舍

- **B. rfd 全 Rust**（命令内开对话框 + 组装 + 写入）：无插件/capability 变更，但角色标签 i18n 无法自然获得（需把标签串传进请求或硬编码），Markdown 排版测试只能在 Rust 侧。落选：展示层职责错位。
- **C. Rust 从 DB 组装**（标签由请求传入）：数据权威在读侧，但导出内容与界面所见（store 投影）存在双源；本功能锚点本就定义在 UI 消息上。落选：契约面更大（请求含 anchor_node_id + 标签），收益低。
- **选定 A**：JS 对话框 + 前端组装 + Rust 纯写入。文件系统能力不进 webview（沿用 "SQL remains Rust-only" 的最小 capability 原则）。

## 变更清单（按层）

### 1. Rust 侧

- `src-tauri/Cargo.toml`：+ `tauri-plugin-dialog`。
- `src-tauri/src/lib.rs`：`.plugin(tauri_plugin_dialog::init())`；`register_conversation_commands` 注册新命令 `write_export_file`。
- `src-tauri/src/conversations/commands.rs`：
  - `CONVERSATION_COMMAND_NAMES` 增名（`command_boundary.rs` 有数量断言，需同步）。
  - 请求 DTO `WriteExportFileRequest { path: String, content: String }`（snake_case、`deny_unknown_fields`、非空校验、content 大小上限沿用节点 1 MiB × 宽裕余量——上限 16 MiB 防误用）。
  - 响应 DTO `WriteExportFileResponse { bytes_written: u64 }`。
  - service 方法：`std::fs::write(path, content)`，IO 错误映射 `CommandError`（新错误码，如 `export_file_write`，消息中文默认，符合 `error.rs` 信封约定）。
- `src-tauri/capabilities/default.json`：permissions 增 `"dialog:allow-save"`（最小权限，不用 `dialog:default` 全集）。
- `contract-fixtures/conversation-ipc.json`：新命令条目（与 schemas/命令名同步，`command_boundary.rs` 契约测试读取）。

### 2. 前端

- `package.json`：+ `@tauri-apps/plugin-dialog`。
- `src/lib/tauri/schemas.ts`：请求/响应 zod schema；`src/lib/tauri/client.ts`：`CONVERSATION_COMMANDS` 增 `writeExportFile` 封装（走现有 `call()`，自动校验）。
- `src/features/conversations/exportMarkdown.ts`（+ colocated test，仿 `deriveConversationTitle.ts` 先例）：
  - `buildExportMarkdown(input: { messages, title, userLabel, assistantLabel }): string`
  - 过滤仅 `user | assistant`（防御性；根节点即首条 user 消息，路径天然交替）。
  - 模板：`# {title}` 空行后依次 `## {角色标签}` + 正文，消息间空行；user 正文原样插入（见 PRD Out of Scope 的已知取舍）。
  - `sanitizeExportFilename(title): string`：替换 `[\\/:*?"<>|]` 与控制字符、trim、截 80 字符、空回退 `conversation`。
- `src/features/conversations/store/index.ts`：新动作 `exportUpToMessage(anchorNodeId)`：
  - 取当前会话 `path`（激活路径），切到锚点前缀；对话框 `save({ defaultPath: sanitized + '.md' 扩展由 filters 处理', filters: [{ name: 'Markdown', extensions: ['md'] }] })`；
  - `null` → 直接返回；否则 `writeExportFile` → 成功 toast（含文件名）/失败 toast。
- `src/features/conversations/components/MessageNode.tsx`：action 栏加导出按钮（`ExternalLink` 图标，lucide 已有依赖；即 fa-up-right-from-square 同形，「从这里发出去」语义，避免 Download 的「下载附件」歧义，2026-08-23 用户确认），`canExport = message.role === "assistant"`；按钮 `disabled` 由新 prop `exportDisabled` 传入（生成中为 true）。样式复用现有 ghost icon 按钮（`size-7 text-muted-foreground hover:text-foreground`）。
- `src/features/conversations/components/ConversationPane.tsx`：组装处判断 `generationRuns` 是否有当前会话运行中记录，传入 `exportDisabled` 与 handler。
- `src/lib/i18n/locales/zh-CN.ts` + `en.ts`（同步新增，zh-CN 为真源）：
  - `conversation.message.export`（按钮 title/aria）
  - `conversation.export.success`（(params) => string，含文件名）
  - `conversation.export.failed`
  - `conversation.export.userLabel` / `conversation.export.assistantLabel`

### 3. 生成中禁用（R5）

复用 store `generationRuns[conversationId]` 判定（现focus 逻辑同源，`store/index.ts` L100/L372）；存在运行中记录 → `exportDisabled=true`。流式 assistant 消息尚未落库，导出会被禁用挡住。

## 兼容与回滚

- 无 DB 迁移、无既有命令改动；新命令为追加（契约 fixture 数量断言 +1）。
- 回滚 = revert 分支：插件注册、capability、依赖、命令一并随代码回退，无数据残留。
- 保存对话框取消不产生任何写入与状态变化。

## 风险

- capability 最小化：仅 `dialog:allow-save`，不引入 fs 权限给 webview。
- `write_export_file` 为通用写命令（webview 可指定任意路径写文件）——桌面单机应用、路径来自原生对话框，风险接受；如后续收紧可校验扩展名/大小（当前仅大小校验）。
- Windows/macOS 文件名非法字符差异：sanitize 覆盖两平台并集。
