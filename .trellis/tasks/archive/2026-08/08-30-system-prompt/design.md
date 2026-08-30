# 系统提示词功能 — 技术设计

## Architecture & Boundaries

特性横跨 5 层，严格沿用现有「provider binding / auto-title」模式，不引入新架构：

```text
UI (ConversationSettingsPanel / ConversationSettingsDialog)
  → Zustand stores (providers store = 全局设置; conversations store = 对话设置 + 草稿)
  → src/lib/tauri typed bridge (Zod 双向校验)
  → Tauri commands (settings::commands / conversations::commands)
  → Rust services (settings / conversations / generation)
  → repositories → SQLite (app_settings KV / conversations 表)
```

所有权划分（遵循 backend directory-structure spec）：

- `settings` 拥有全局默认提示词（typed `app_settings` key `default_system_prompt`）。
- `conversations` 拥有 `conversations.system_prompt` 列的 SQL 与持久化服务。
- `generation` 不拥有 SQL；在 `prepare_generation` 中组合「对话覆盖 + 全局默认」并注入 prompt。
- `providers::commands::list_providers` 作为既有聚合 IPC façade，额外携带 `default_system_prompt` 供前端水合（与 `auto_generate_title` 同一通道）。

## Data Flow & Contracts

### 存储

1. 新迁移 `0008_conversation_system_prompt.sql`：
   - `ALTER TABLE conversations ADD COLUMN system_prompt TEXT;`
   - `NULL` = 跟随全局默认（唯一语义，无「显式不使用」三态 — PRD 已确认）。
   - 0001–0007 已发布（v0.4.0 = 0001–0006，0007 已随 fixture 校验），只允许前向迁移，不改旧文件字节。
2. 全局：`app_settings` key `default_system_prompt`，key 缺失 = 无默认。清除时删除 key（同 `delete_title_model_binding` 模式）。

### 规范化与校验（入口校验一次）

- 两侧入口（`set_default_system_prompt`、`set_conversation_system_prompt`）统一策略：
  - trim Rust whitespace；trim 后为空 → 存 `NULL` / 删除 key（即「清除」）。
  - 字节上限 1 MiB（与节点 content 上限一致），超限 → `invalid_input`。
- 前端 Zod schema 镜像同一规则（`unicodeScalarStringSchema` + byte cap refine），在 bridge 层 fail-fast。

### 生成时注入

- `prepare_generation`（`src-tauri/src/generation/service.rs`）在 `load_generation_context` 之后解析生效提示词：
  - `conversation.system_prompt` 非空 → 使用它；
  - 否则读 `SettingsService::get_default_system_prompt`；非空 → 使用它；
  - 否则不注入，请求体与现状完全一致。
- `chat_prompt_from_path` 增加 `system_prompt: Option<String>` 参数；非空时在路径消息之前 prepend 一条 `PromptMessage { role: System, content }`。路径上理论存在的 system 节点保持原样排在其后（当前无用户入口创建 system 节点，无需合并逻辑）。
- 注入发生在 prepare 阶段，属于快照的一部分：运行中修改提示词不影响在途请求（与现有 `prepared_generation_snapshots_survive_concurrent_provider_changes` 测试语义一致）。

### IPC 契约

| Command | Request | Result |
|---|---|---|
| `set_conversation_system_prompt`（新，conversations） | `{ conversation_id, system_prompt: string \| null }` | `{ conversation_id, system_prompt: string \| null }` |
| `set_default_system_prompt`（新，settings） | `{ prompt: string \| null }` | `{ prompt: string \| null }` |
| `list_providers`（扩展） | — | 增加 `default_system_prompt: string \| null` |
| `load_conversation_tree`（扩展） | — | `ConversationDto` 增加 `system_prompt?: string \| null` |

- `ConversationSummaryDto` / 历史列表 **不** 携带 system_prompt（侧栏无需展示，减小面）。
- 归档对话拒绝写（`require_writable_conversation`，同 binding）。
- DTO 沿用 `skip_serializing_if = "Option::is_none"` + 前端 `.nullable().optional()` 风格。

### 前端状态

- providers store：新增 `defaultSystemPrompt: string | null` + `setDefaultSystemPrompt(client, prompt)`；水合自 `listProviders` 结果。
- conversations store：
  - 加载态新增 `systemPrompt: string | null`（来自 `mapConversation`）；
  - `setConversationSystemPrompt(client, prompt)` action：epoch 守卫 + 归档/未加载早退，模式照抄 `setConversationProvider`（不写 history summaries）；
  - 草稿态新增 `draftSystemPrompt` + `setDraftSystemPrompt`；`enterConversationCreation` / 创建成功后重置。
- controller `createConversation`：创建成功后若 `draftSystemPrompt !== null`，调用 `setConversationSystemPrompt`（紧随现有 binding 应用逻辑之后）。

### UI

- 全局：`ConversationSettingsPanel` 新增一个 Field（多行 textarea + 保存按钮）。受控本地草稿，dirty 时保存按钮可用；保存成功 toast 可选（沿用面板现有静默模式则不加）。
- 每对话：新组件 `ConversationSettingsDialog`（`src/features/conversations/components/`），入口为 workspace 头部 `ConversationProviderPicker` 旁的 icon 按钮（blank 草稿或已加载对话时可见；归档只读）。
  - 草稿模式：读写 `draftSystemPrompt`，不走 IPC。
  - 非草稿：初始值 = 对话 `systemPrompt`；为空时 placeholder 提示「跟随全局默认」并展示全局默认预览；「恢复跟随全局」按钮 = 保存 `null`。
  - 该对话框定位为日后通用「对话设置」容器（用户明确要求）。

### i18n

- `en.ts` / `zh-CN.ts` 同步新增 key：`settings.conversation.defaultSystemPrompt*`、`conversation.settingsDialog.*` 等。

## Compatibility & Migration

- 旧数据库升级：0008 为纯 `ADD COLUMN ... TEXT`（可空、无默认值），对存量行无影响；`released_database_upgrade` 测试 ledger 扩展至 0008 并断言新列存在。
- `tree_persistence` 的精确表结构断言需同步加入 `system_prompt` 列。
- 未设置任何提示词时请求体逐字节等同现状（无 system 消息），保证默认行为零变化。
- 导出（`exportMarkdown.ts`）保持不变，不含系统提示词（PRD 已确认）。
- 全景视图（`ConversationPanorama.tsx`）不体现系统提示词：注入式方案不产生节点，全景保持纯消息树（PRD 已确认）。
- 无内置预置提示词：全局默认初始为空，`default_system_prompt` key 缺失即无默认（PRD 已确认）。
- 自动标题（`generation/title_prompt.rs`）硬编码指令，不接入用户提示词。
- 用户可见文案统一用「对话」（i18n key 路径不变）。

## Trade-offs

- **注入而非 system 根节点**：节点历史不可变（trigger 强制），做成节点则无法编辑；元数据列 + 生成时注入是唯一符合不可变约束的方案。代价：提示词不在消息树中可见 — 通过设置对话框展示生效值缓解。
- **全局默认经 `list_providers` 水合**：复用现有聚合 façade，避免新增「加载设置」命令；代价是 providers store 名义上多了一个非 provider 字段（`auto_generate_title` 已有先例）。
- **摘要不携带 system_prompt**：减小 IPC 面；若日后侧栏需要展示再扩展。

## Rollback

- 代码回滚即功能消失；已应用的 0008 迁移保留一个未使用的可空列，无害（符合前向迁移策略，不写 down migration）。
