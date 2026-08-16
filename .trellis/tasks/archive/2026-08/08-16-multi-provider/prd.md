# 多 Provider 支持：多 API 协议与模型列表获取

## Goal

Canopy 目前只支持单一 provider 配置（OpenAI 兼容协议，单例 `default` profile）。本任务将其扩展为多 provider：用户可配置多个命名 provider，支持 OpenAI 兼容与 Anthropic 两种 API 协议，能从 provider 拉取可用模型列表供选择，会话内可随时修改本会话使用的 provider/model 与 reasoning effort，并流式展示模型 thinking 内容。

## 工作树

- 分支 `feat/multi-provider`，位于 `../canopy-multi-provider`（基于 main @ 289ba24）。
- **本任务全部 Trellis 工件（本文件、design、implement、research、jsonl）与后续实现都在该工作树内进行**，随特性分支一起合回 main；主检出保持干净。

## Background（代码现状，已核实）

- 后端 provider 模块 `src-tauri/src/providers/`，单例 profile：`domain.rs:8` `PROFILE_ID = "default"`，`ProviderProfile { base_endpoint, model, credential_ref }`。
- 仅支持 OpenAI 兼容协议：`openai_compatible.rs` 硬编码 `POST {base}/chat/completions` SSE 流式；SSE 解析要求单 choice、finish_reason=stop、`[DONE]` 结尾。
- 存储在 SQLite（`migrations/0004_provider_profile.sql`，表 `provider_profiles` 带 `CHECK (id = 'default')`、`provider_credential_operations` 操作日志），credential 经 keyring（`credentials.rs`），credential_ref 存 DB，service 层用操作日志 + reconcile 保证 DB/keyring 最终一致（`service.rs`）。
- endpoint 校验：仅 https（或精确 loopback http），拒绝 userinfo/query/fragment（`domain.rs` `ValidatedEndpoint`）。
- 请求体仅 `model/messages/stream`，角色映射 system/user/assistant，tool 不支持。
- 生成流程：`generation.rs` `prepare_generation` 全局加载唯一 profile，`GenerationRuntime` 按会话互斥；assistant 节点已持久化 `model` 字段（`nodes.model`）。
- 会话表 `conversations`（`migrations/0002/0003`）：仅 id/title/root_node_id/is_archived，无 provider 绑定；节点历史有 immutable 触发器。
- 前端：`src/features/providers/`（zustand store 持单 profile、`GlobalSettingsDialog.tsx` 单表单）、`src/lib/tauri/provider-client.ts` + `provider-schemas.ts`（zod DTO 校验）；IPC 契约固件在 `contract-fixtures/provider-ipc.json`。

## Key Decisions（均已与用户确认 2026-08-16）

1. **协议范围**：MVP 支持 OpenAI 兼容 + Anthropic Messages 两协议。Gemini 走官方 OpenAI 兼容层（`https://generativelanguage.googleapis.com/v1beta/openai/`），原生支持与 Azure OpenAI 延后。协议调研见 `research/api-protocols.md`。
2. **会话关系**：全局默认 + 会话覆盖。全局有一个激活 provider/model 作默认；每个会话可覆盖为自己的 provider/model，不选则跟随全局。**会话内可随时修改该覆盖**（影响后续消息，不改动已生成消息）。
3. **模型列表（2026-08-17 修订）**：provider 配置持久化「模型列表」（≥1 个，默认模型必在其中）；设置对话框维护该列表（手动添加 + 「获取模型列表」拉取后点选加入）；**会话切换器只从该持久化列表选择，不联网**。
4. **流式不锁定设置**：生成/流式期间设置与本会话绑定均可修改；在途生成靠 prepare 时快照隔离，变更自下一条消息生效（见 R1、design §5）。
5. **thinking 显示**：两协议都支持。OpenAI 兼容系被动捕获 `reasoning_content`/`reasoning`（零请求改动）；Anthropic 请求默认启用思考（固定预算）并按 content block 路由。流式事件 `thinking_delta`，持久化到 `nodes.metadata.thinking`，UI 为可折叠「思考过程」区块，**流式动画使用 shadcn Marker 组件**（`role="status"` + Spinner + shimmer，design §7.5）。格式调研见 `research/thinking-formats.md`。
6. **reasoning effort**：**会话级选择**——会话选择器在 model 旁选 effort（默认/low/medium/high），存会话独立列，与 provider/model 绑定互不牵连（清除绑定不清 effort）。未选择不发送参数：OpenAI 兼容系选了才发 `reasoning_effort`（避免不支持的服务商 400）；Anthropic 映射到思考预算；provider 级默认与每条消息临时选延后。

## Requirements

### R1 多 provider 管理

- 用户可创建、编辑、删除多个 provider，每个含：显示名（唯一、非空、≤100 字符）、协议（`openai_compatible` | `anthropic`）、base_endpoint（沿用现有 https/loopback 校验）、默认模型、API key。
- API key 沿用 keep/replace/remove 三态语义与 keyring + 操作日志 reconcile 机制，扩展为按 provider 维度。
- 设置对话框从单表单改为 provider 列表 + 编辑表单；保留只读（归档会话）保护；**流式/生成过程中不锁定设置**——provider 配置与本会话绑定在生成期间均可修改。安全性由「生成开始时快照解析」保证：在途生成持有 endpoint/model/密钥/客户端的快照，不受配置变更（含在途 provider 被编辑/删除）影响，变更自下一条消息生效。

### R2 全局激活 provider

- 全局有唯一激活 provider（及其默认 model），作为所有未覆盖会话的默认。
- 删除激活 provider 后激活位清空（回到未配置语义），不自动挑选继任者；用户重新选择后恢复。

### R3 会话级覆盖（含会话内修改）

- 每个会话可绑定 (provider, model)；未绑定时跟随全局激活的 provider 及其默认模型。
- **会话内（会话顶部选择器）可随时查看与修改绑定**：切换 provider、切换 model、清除绑定（回到跟随全局）；仅影响后续生成，不影响已生成消息与进行中的生成。
- 被绑定 provider 删除时，绑定自动置空（回退全局）。
- 会话选择器内提供「管理服务提供商…」入口打开设置对话框。

### R4 Anthropic 协议支持

- 请求：`POST {base}/v1/messages`（base 已以 `/v1` 结尾时不再重复追加），SSE 流式；`x-api-key` + `anthropic-version` 认证头。
- 消息映射：system 角色 nodes 合并为顶层 `system` 字段；user/assistant 映射为 messages；`max_tokens` 必填（MVP 固定值）。
- 模型列表：`GET {base}/v1/models`，解析 `data[].id`。
- OpenAI 兼容协议行为保持不变（`POST {base}/chat/completions`、`GET {base}/models`）。

### R5 模型列表拉取

- 支持两种来源：已保存 provider（用存储凭据）；草稿（设置对话框未保存的 protocol/endpoint/key）。
- 拉取时机：设置对话框手动按钮；会话模型选择器打开时。失败展示可重试错误；手动输入模型名始终可用（不依赖列表）。

### R6 数据迁移

- 现有单 `default` profile 迁移为多 provider 结构中的一行（保留 credential_ref，keyring 条目不动）。
- 凭据操作日志表增加 provider 维度；会话表增加 provider/model 绑定列；全局激活位持久化。
- 迁移后旧命令（load/save/delete 单 profile）由新命令面取代，前后端同批落地。

### R7 生成流程解析

- 生成开始时解析 effective provider：会话绑定优先，否则全局激活；effective model：会话绑定 model 优先，否则 provider 默认模型。
- 按协议分发请求构造与 SSE 解析；错误映射沿用现有 ProviderError 分类（认证/限流/不可用/协议错误）。

### R8 thinking 内容显示（两协议）

- OpenAI 兼容协议：被动捕获 SSE delta 中的 `reasoning_content`（DeepSeek 系约定）与 `reasoning`（OpenRouter 约定）字段，请求侧零改动；模型不输出思考时自然降级为普通展示。
- Anthropic 协议：请求默认启用 extended thinking（固定 `budget_tokens`，`max_tokens` 相应提高），解析 `thinking_delta` 块（`signature_delta` 等忽略）。
- 流式：生成事件新增 `thinking_delta`，思考内容实时展示；正文与思考各自套用现有 1MB 上限。
- 持久化：正文仍存 `nodes.content`；思考存 `nodes.metadata.thinking`（无思考不写字段，无需迁移）。
- UI：assistant 消息可折叠「思考过程」区块——流式思考期间以 shadcn Marker（`role="status"` + Spinner + shimmer）展示动画行、首个正文 delta 后自动折叠、可手动展开；历史消息默认折叠。
- 格式细节见 `research/thinking-formats.md`。

### R9 reasoning effort（会话级）

- 会话选择器提供 effort 选择：默认（不发送）/ low / medium / high，存 `conversations.reasoning_effort` 独立列，与 provider/model 绑定互不牵连（清除绑定不清除 effort）。
- 请求映射：OpenAI 兼容协议仅在选择了 effort 时携带 `reasoning_effort` 字段（`skip_serializing_if` 语义，未选不发，避免不支持的服务商 400）；Anthropic 映射到思考预算（low/medium/high → budget_tokens 档位，未选维持默认预算）；DeepSeek 等无该参数的服务商由「未选不发」策略自然兼容。
- effort 随会话独立生效，同样适用「修改自下一条消息生效」的快照语义；模型不支持时由服务端错误照常透出（现有错误映射）。

## Acceptance Criteria

- [ ] `cargo test`（src-tauri）全绿，新增覆盖：迁移（旧 default 行 → 多 provider + 激活位 + 会话绑定列 + effort 列）；Anthropic 请求构造（system 提取、角色映射、max_tokens/thinking 字段、effort→预算映射）；Anthropic SSE 解析（增量/完成/异常流、thinking 块路由、signature 忽略）；OpenAI 兼容 thinking 捕获（reasoning_content/reasoning/两者皆无）与 reasoning_effort 按需携带（未选不发）；两种协议模型列表响应解析（正常/空/畸形）；provider CRUD、激活管理、删除级联（绑定会话置空、激活位清空）；effective provider/model/effort 解析（覆盖/回退组合）；thinking 持久化到 metadata。
- [ ] `pnpm check`（format:check + lint + typecheck + test + build）全绿，新增覆盖：providers store（列表/保存/删除/激活/模型列表错误路径）；设置对话框多 provider 交互；会话顶部 provider/model 选择器（切换、清除、跟随全局显示、管理入口、effort 选择组）；thinking_delta 事件机校验与消息节点折叠 UI（Marker 动画行）。
- [ ] `contract-fixtures/provider-ipc.json` 更新为新命令面契约，前后端测试一致。
- [ ] 手动验收：旧库升级后原配置可用（迁移不丢凭据引用）；配置 OpenAI 兼容 + Anthropic 各一个 provider，两个会话分别用不同 provider 生成成功；会话内切换 provider/model 后下一条消息生效；删除被绑定 provider 后会话回退全局；「获取模型列表」在 key 错误时给出可重试错误且可手动输入；流式过程中修改全局设置或在途 provider 配置/删除在途 provider，在途回复正常完成且下一条消息使用新配置；思考模型（如 deepseek-reasoner 与 Claude）流式展示思考过程（Marker 动画）、完成后折叠可回看、重开会话后仍可见；会话设置 effort 后 OpenAI 兼容请求体携带 `reasoning_effort`、未设置时不携带，Anthropic 思考预算随 effort 档位变化。

## Out of Scope

- tool-call / 多模态消息（维持现有角色限制）。
- Gemini 原生协议、Azure OpenAI、其他协议（架构留协议扩展点）。
- provider 级用量统计、计费、模型列表缓存、`max_tokens` 等生成参数可配置化（含 Anthropic thinking 按 provider 开关——MVP 全开，预算由 effort 档位映射，未选走默认档，见 R9）。
- reasoning effort 的 provider 级默认、每条消息临时选择、`minimal` 档位（gpt-5 专属）——MVP 仅会话级 low/medium/high。

## Risks / Deferred

- 迁移风险：旧库 pending 凭据操作跨结构变更回放——迁移脚本需把存量操作行归到迁移 provider 名下（design.md 有明确方案）。
- Anthropic `max_tokens` 固定值可能小于个别模型上限偏好——延后为可配置项。
- 流式期间解锁设置/绑定修改：实现上由 prepare 时快照保证隔离（PRD R1、design §5）；若实际使用中出现用户困惑（改了设置但当前回复仍是旧配置），考虑在 UI 上加「下一条生效」提示，不回退锁定。
