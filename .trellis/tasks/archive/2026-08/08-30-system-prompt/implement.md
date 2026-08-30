# 系统提示词功能 — 执行计划

按层自底向上实施，每步可独立验证。

## Checklist

### 1. 迁移与后端 conversations 域

- [ ] 新增 `src-tauri/migrations/0008_conversation_system_prompt.sql`：`ALTER TABLE conversations ADD COLUMN system_prompt TEXT;`
- [ ] `src-tauri/src/infra/database.rs`：迁移目录登记 0008（若目录为显式列表）
- [ ] `conversations/domain.rs`：`Conversation` 增加 `system_prompt: Option<String>`（`ConversationSummary` 不加）
- [ ] `conversations/repository.rs`：conversation 行查询 SELECT 列表与行映射加入 `system_prompt`；新增 `write_system_prompt(&mut SqliteConnection, conversation_id, Option<&str>)`
- [ ] `conversations/service.rs`：`set_system_prompt`（事务内 `require_writable_conversation` + 写入 + 读回）
- [ ] `conversations/dto.rs`：`ConversationDto` 增加 `system_prompt`；新增 `SetConversationSystemPromptRequest/Result`
- [ ] `conversations/commands.rs`：新命令 `set_conversation_system_prompt`（trim/blank→None/1MiB 上限校验）；`src-tauri/src/lib.rs` 注册命令

### 2. 后端 settings 域 + 聚合 façade

- [ ] `settings/repository.rs`：`get_default_system_prompt` / `set_default_system_prompt`（None → 删除 key）
- [ ] `settings/service.rs`：对应 service 方法
- [ ] `settings/commands.rs`：新命令 `set_default_system_prompt`；`lib.rs` 注册
- [ ] `providers/commands.rs`：`ListProvidersResult` 增加 `default_system_prompt` 并在 `list_providers` 中填充

### 3. 生成注入

- [ ] `generation/service.rs`：`chat_prompt_from_path` 增加 `system_prompt: Option<String>` 参数并 prepend system 消息；`prepare_generation` 解析生效提示词（对话覆盖 → 全局默认 → 无）
- [ ] 更新 `chat_prompt_from_path` 现有调用点与测试签名

### 4. 前端 typed bridge

- [ ] `src/lib/tauri/schemas.ts`：`conversationDtoBaseSchema` 增加 `system_prompt`；新增 `setConversationSystemPromptRequestSchema` / 结果 schema（含 systemPrompt 校验：unicode scalar + ≤1MiB）
- [ ] `src/lib/tauri/provider-schemas.ts`：`listProvidersResultSchema` 增加 `default_system_prompt`；新增 `setDefaultSystemPrompt` 请求/结果 schema
- [ ] `src/lib/tauri/client.ts`：`setConversationSystemPrompt` 命令 + `ConversationView.systemPrompt` 映射
- [ ] `src/lib/tauri/provider-client.ts`：`setDefaultSystemPrompt` + listProviders 映射
- [ ] `src/features/conversations/types`：`ConversationView` 增加 `systemPrompt`

### 5. 前端 stores 与 controller

- [ ] providers store：`defaultSystemPrompt` 状态 + 水合 + `setDefaultSystemPrompt` action
- [ ] conversations store：`systemPrompt` 加载态、`setConversationSystemPrompt` action（epoch 守卫）、`draftSystemPrompt` / `setDraftSystemPrompt`、创建流程重置
- [ ] `useWorkspaceGenerationController.createConversation`：创建后应用 `draftSystemPrompt`

### 6. UI 与 i18n

- [ ] `ConversationSettingsPanel`：全局默认提示词 Field（textarea + 保存，本地草稿 dirty 才可保存）
- [ ] 新 `ConversationSettingsDialog` + workspace 头部入口按钮（草稿/已加载可见，归档只读；空值显示「跟随全局默认」及全局预览；支持清除恢复继承）
- [ ] `en.ts` / `zh-CN.ts` 新增翻译 key

### 7. 测试

- [ ] Rust：`tree_persistence` 表结构断言加列；`released_database_upgrade` ledger 覆盖 0008；service 测试（round-trip、归档拒绝、blank→NULL）；generation 测试（优先级 对话>全局>无、未设置时无注入、快照隔离）
- [ ] 前端：schemas/client、providers store、conversations store、controller 草稿应用、`ConversationSettingsDialog`、设置面板

## Validation Commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm check   # format:check + lint + typecheck + test + build
```

## Risky Files / Rollback Points

- `src-tauri/src/generation/service.rs` — `chat_prompt_from_path` 签名变更波及现有测试；注入逻辑是功能核心，优先保证「未设置时零变化」断言。
- `src-tauri/tests/released_database_upgrade.rs` — fixture/ledger 断言扩展，勿改 0001–0007 字节。
- `src/features/conversations/store/index.ts` — epoch 守卫模式必须照抄，避免 stale 写入。
- 回滚：按层 git revert 即可；已应用迁移保留无害列。

## Pre-start Checks

- [x] `prd.md` / `design.md` / `implement.md` 齐备
- [x] `implement.jsonl` / `check.jsonl` 已配置真实 spec 条目
- [ ] 用户批准最终规划摘要后才运行 `task.py start`
