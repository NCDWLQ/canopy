# 系统提示词功能

## Goal

让用户能够配置系统提示词（system prompt），在每次 LLM 生成时作为 system 消息注入，从而控制模型的行为、语气和角色设定。支持全局默认 + 每对话覆盖两层配置。

## Background（代码勘察结论）

- Canopy 是 Tauri 2 + React 19 本地优先聊天应用，对话为树形分支结构，SQLite 持久化（sqlx + tauri-plugin-sql）。
- LLM 链路已完整支持 system 角色：`src-tauri/src/generation/service.rs` 的 `chat_prompt_from_path` 映射 `Role::System`；`openai_compatible.rs` 支持 `role: "system"`；`anthropic.rs` 合并 system 消息到顶层 `system` 字段。
- 但目前无用户可编辑入口：新对话根节点永远是 user（`src-tauri/src/conversations/commands.rs`）。
- 节点内容插入后不可变（`nodes_immutable_history` trigger）→ 系统提示词必须做成元数据列 + 生成时注入，而非 system 节点。
- 全局设置存储：`app_settings` KV 表（`src-tauri/src/settings/repository.rs`，已有 `auto_generate_title`、`language`、`theme` 等 typed key）。
- 每对话设置存储：`conversations` 表列（`provider_id`、`model`、`reasoning_effort`），无 `system_prompt` 列；最新迁移为 0007，v0.4.0 已发布（0001–0006 字节不可改）。
- 全局设置前端水合通道：`list_providers` 聚合 façade → providers store（`auto_generate_title` 为先例）。
- 每对话设置前端模式：`setConversationProvider` action（epoch 守卫）+ 草稿态 `draftBinding` / `draftReasoningEffort` + 创建后应用（`useWorkspaceGenerationController.createConversation`）。
- UI 落点：全局 → `ConversationSettingsPanel.tsx`（Field 模式）；每对话 → workspace 头部 `ConversationProviderPicker` 旁。

## Requirements

- R1 全局默认系统提示词
  - 存储为 `app_settings` 新 key `default_system_prompt`（缺失 = 无默认；清除即删除 key）。
  - 设置对话框「对话」面板中可编辑（多行文本 + 保存）。
- R2 每对话系统提示词覆盖
  - 新迁移 0008：`conversations` 增加可空 `system_prompt` 列；`NULL` = 跟随全局默认（不支持「显式不使用」，已确认）。
  - 独立「对话设置」对话框编辑（入口在 workspace 头部；该对话框日后扩展为通用对话设置容器，已确认）。
  - 草稿态（对话创建前）可预设，创建对话后写入。
  - 归档对话只读；修改只影响之后的生成（历史不可变）。
- R3 生成时注入
  - `prepare_generation` 解析生效提示词：对话覆盖 > 全局默认 > 无；非空时在 `chat_prompt_from_path` 组装的消息列表前 prepend 一条 system 消息。
  - 未设置任何提示词时请求体与现状完全一致（零行为变化）。
  - 注入属于 prepare 快照：运行中修改不影响在途请求。
- R4 规范化与校验：入口 trim；空白 = 清除；上限 1 MiB（与节点 content 一致）；前端 Zod 镜像。
- R5 IPC + 类型同步：新命令 `set_conversation_system_prompt` / `set_default_system_prompt`；`list_providers` 结果与 `ConversationDto` 扩展；`src/lib/tauri` Zod schema 与映射同步。
- R6 前端状态：providers store（`defaultSystemPrompt`）、conversations store（`systemPrompt` + `draftSystemPrompt` + epoch 守卫 action）。
- R7 i18n：en / zh-CN 同步新增 key。

## Out of Scope

- Markdown 导出包含系统提示词（已确认不包含，导出保持 user/assistant）。
- 全景视图（`ConversationPanorama.tsx`）体现系统提示词（已确认不体现：提示词是配置而非对话内容，全景保持纯消息树）。
- 内置预置提示词（已确认不做：全局默认初始为空，无任何开箱即用的提示词）。
- 提示词模板库 / 预设管理、变量插值。
- 自动标题接入用户提示词（`generation/title_prompt.rs` 保持硬编码）。
- 对话级「显式不使用」三态（留空即跟随全局）。
- 历史摘要（侧栏）展示系统提示词。

## 文案约定

- 产品文案统一使用「对话」（而非「会话」），与 `zh-CN.ts` 现有文案一致（如「新建对话」「跟随对话」「对话全景」）；i18n key 路径保持英文不变。

## Acceptance Criteria

- [ ] 设置对话框中可配置全局默认系统提示词，保存后新生成生效。
- [ ] 每个对话可单独设置系统提示词，优先级高于全局默认；清除后恢复跟随全局。
- [ ] 草稿态预设的系统提示词在对话创建后生效。
- [ ] 未设置任何系统提示词时，请求体与现状完全一致（无 system 消息注入）。
- [ ] OpenAI 兼容协议与 Anthropic 协议下，注入的 system 消息均正确出现在请求中。
- [ ] 归档对话无法修改系统提示词；修改不影响已有历史消息。
- [ ] 旧数据库（v0.4.0 fixture）升级后新列存在且存量数据不变。
