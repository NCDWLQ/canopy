# 技术设计：多 Provider 支持

对应 PRD：`prd.md`（R1–R9）。协议调研：`research/api-protocols.md`、`research/thinking-formats.md`。

## 1. 架构总览

```
前端                                          后端 (src-tauri)
├─ features/providers/                        ├─ providers/
│  ├─ store（多 provider + 激活位）            │  ├─ domain.rs      Provider/Protocol/校验
│  ├─ GlobalSettingsDialog（列表+编辑表单）     │  ├─ repository.rs  providers/操作日志/激活位
│  └─ ConversationProviderPicker（新）         │  ├─ service.rs     CRUD/激活/删除级联/reconcile
├─ conversations/                             │  ├─ protocols/
│  ├─ 会话头部集成选择器                        │  │  ├─ openai.rs   （现 openai_compatible.rs 改名）
│  └─ useWorkspaceGenerationController        │  │  └─ anthropic.rs（新）
│     （扩展 thinking 事件通道）                │  ├─ model_list.rs  模型列表（按协议）
                                              │  ├─ generation.rs  effective 解析 + 协议分发
                                              │  └─ commands.rs    新命令面
                                              └─ conversations/（绑定/effort 列读写 + set 命令）

前端契约层（两列共用）：lib/tauri/provider-client.ts + provider-schemas.ts + contract-fixtures/。
```

核心原则：**凭据安全模型不变**（keyring + 操作日志 + reconcile，`service.rs` 既有模式按 provider 维度扩展）；**协议用 enum 静态分发**（仅两协议，不引入 trait 对象/dyn）；**前端契约层不变**（zod DTO + provider-client + contract-fixtures 同步演进）。

## 2. 数据模型与迁移（`migrations/0005_multi_provider.sql`）

```sql
CREATE TABLE providers (
  id             TEXT PRIMARY KEY,            -- 迁移行固定 'default'，新建为 uuid
  name           TEXT NOT NULL,
  protocol       TEXT NOT NULL CHECK (protocol IN ('openai_compatible', 'anthropic')),
  base_endpoint  TEXT NOT NULL,
  model          TEXT NOT NULL,               -- 该 provider 的默认模型
  credential_ref TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
-- 名字唯一性由 service 层校验（大小写不敏感），不加 DB 约束（改名冲突提示更友好）

INSERT INTO providers (id, name, protocol, base_endpoint, model,
                       credential_ref, created_at, updated_at)
  SELECT 'default', '默认', 'openai_compatible', base_endpoint, model,
         credential_ref, updated_at, updated_at
  FROM provider_profiles;
DROP TABLE provider_profiles;

-- 凭据操作日志加 provider 维度（保留原 CHECK 语义）
CREATE TABLE provider_credential_operations_v2 (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL REFERENCES providers(id),
  operation          TEXT NOT NULL CHECK (operation IN ('save', 'delete')),
  base_endpoint      TEXT,
  model              TEXT,
  new_credential_ref TEXT,
  old_credential_ref TEXT,
  updated_at         INTEGER,
  CHECK ((operation = 'save' AND base_endpoint IS NOT NULL AND model IS NOT NULL AND updated_at IS NOT NULL)
      OR (operation = 'delete' AND base_endpoint IS NULL AND model IS NULL AND new_credential_ref IS NULL AND updated_at IS NULL))
);
INSERT INTO provider_credential_operations_v2
  SELECT id, 'default', operation, base_endpoint, model,
         new_credential_ref, old_credential_ref, updated_at
  FROM provider_credential_operations;
DROP TABLE provider_credential_operations;
ALTER TABLE provider_credential_operations_v2 RENAME TO provider_credential_operations;

-- 会话绑定（provider/model 二者同置同清；provider 删除 → 绑定回退全局；effort 独立列不受绑定清除影响）
ALTER TABLE conversations ADD COLUMN provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN model TEXT;
ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT
  CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high'));

-- 全局激活位（key-value，未来其他设置可复用）
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 迁移时 providers 至多一行（旧表 CHECK id='default'）；空库时 INSERT..SELECT 不产生行
INSERT INTO app_settings (key, value)
  SELECT 'active_provider_id', id FROM providers LIMIT 1;
```

要点：

- 迁移行 id 固定 `'default'`（新表无 `CHECK (id=…)` 限制），keyring credential_ref 原值保留，**keyring 条目零变动**。
- 存量 pending 操作行全部归到 `'default'` 名下，reconcile 语义连续（升级时若有 pending 操作，回放目标正确）。
- `conversations_immutable_identity_and_root` 触发器只锁 id/root_node_id，新列可自由 UPDATE；`nodes_immutable_history` 不受影响。
- `ON DELETE SET NULL` 使「删除被绑定 provider → 会话回退全局」由 DB 保证；`model` 列残留无意义值无害（provider_id 为 NULL 时忽略 model 列，见 §5 解析规则）。

## 2.5 增量迁移（`migrations/0006_provider_models.sql`，2026-08-17 修订）

```sql
ALTER TABLE providers ADD COLUMN models TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(models));
UPDATE providers SET models = json_array(model);   -- 每个存量 provider 以默认模型回填，保证列表非空
```

providers.models 为 JSON 数组（有序去重的模型 id，1..50 个）；默认模型 `model` 必须是列表成员（service 层校验）。会话切换器的模型选项 = 该列表（迁移后至少 1 项），不再联网。

## 3. 领域模型（`domain.rs`）

```rust
pub enum Protocol { OpenAiCompatible, Anthropic }   // DB 文本 'openai_compatible' | 'anthropic'

pub struct Provider {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub base_endpoint: String,
    pub model: String,              // 默认模型
    pub(crate) credential_ref: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
pub struct RedactedProvider { /* 同上去掉 credential_ref，加 has_api_key: bool */ }

pub struct ProviderInput {          // create/update 共用
    pub name: String,
    pub protocol: Protocol,
    pub base_endpoint: String,
    pub model: String,
    pub api_key: ApiKeyAction,      // 语义不变
}
```

- `validate_name`：trim 后非空、≤100 字符；唯一性（大小写不敏感）在 service 查询校验，冲突返回 `invalid_input("name", "duplicate")`。
- `ValidatedEndpoint` 改为按协议派生 URL：
  - `openai_compatible`：`{base}/chat/completions`、`{base}/models`（用户 base 含 `/v1`，与现状一致）。
  - `anthropic`：base 路径已以 `/v1`（或 `/v1/`）结尾 → 追加 `messages`/`models`；否则追加 `v1/messages`/`v1/models`。即 `https://api.anthropic.com` 与 `https://api.anthropic.com/v1` 均可用。
  - scheme/userinfo/query/fragment/loopback 校验规则完全沿用。

## 4. 协议层（`protocols/`）

### 4.1 openai.rs（自 `openai_compatible.rs` 平移）

- `build_request` / SSE 流式解析逻辑不变（单 choice、finish_reason=stop、`[DONE]`）。
- thinking 捕获（PRD R8）：delta 中 `reasoning_content`（DeepSeek 系约定，优先）或 `reasoning`（OpenRouter 约定）非空时作为思考增量回调；请求侧零改动，无思考字段时行为不变。
- reasoning effort（PRD R9）：请求体增加 `#[serde(skip_serializing_if = "Option::is_none")] reasoning_effort: Option<&'static str>`（low/medium/high）——仅会话显式选择时携带，未选不发（避免不支持的服务商 400）。
- 新增 `list_models(endpoint, secret)`：`GET {base}/models`，Bearer 认证，解析 `{ "data": [{ "id": String }] }`。

### 4.2 anthropic.rs（新）

- 认证：`x-api-key: <key>` + `anthropic-version: 2023-06-01`（无 key 时不发 x-api-key，与现状「可选凭据」对齐）。
- 请求构造：
  ```rust
  struct AnthropicMessagesRequest {
      model: String,
      system: Option<String>,       // path 中连续/非连续 system nodes 以 "\n\n" 连接
      messages: Vec<ChatMessage>,   // user/assistant，保持 path 顺序
      max_tokens: u32,              // = budget + 4096（正文保底）；见下方 effort 档位表
      thinking: ThinkingConfig,     // { type: "enabled", budget_tokens }，档位见下
      stream: bool,                 // true
  }
  ```
  effort → 预算档位（PRD R9，未选择维持默认档）：

  | 会话 effort | budget_tokens | max_tokens |
  |---|---|---|
  | 未选择（默认） | 2048 | 8192 |
  | low | 1024 | 5120 |
  | medium | 4096 | 8192 |
  | high | 16384 | 20480 |

  全部档位 ≤ Claude 4.x 输出上限（≥32k）；仅 Claude 3 时代旧模型在 medium/high 会 400（§9 已记风险）。
  终止节点必须为 user 的校验、空内容拒绝、tool 角色拒绝与 openai 版一致（共用校验 helper，避免复制）。
- SSE 解析：`eventsource_stream` 的 `Event` 已带 `event` 字段（现仅用了 `data`）。状态机：
  - `event: content_block_start` → 登记 `index → content_block.type`（`thinking` | `text`）。
  - `event: content_block_delta` → 按 index 路由：`thinking_delta.thinking` → 思考增量；`text_delta.text` → 正文增量；`signature_delta`/其他 delta 类型忽略。UTF-8 字节上限正文/思考各自套用 `MAX_RESPONSE_BYTES`。
  - `event: message_delta` + `data.delta.stop_reason ∈ {end_turn, max_tokens}` → 记录完成；`stop_sequence`/缺失 → 协议错误。`max_tokens` 视为成功（截断但内容完整有效，拒绝会把整段已流式内容作废）。
  - `event: message_stop` → 流结束标志（无 `[DONE]`）。
  - `event: error` / 解析失败 → `ProviderError::Protocol`。
  - 完成条件：收到 message_stop 且 stop_reason 已记录且**正文**非空（思考可选），缺一为协议错误。
- 错误映射：401/403 → Authentication、429（含 `retry-after`）→ RateLimited、5xx → Unavailable，其余 → Protocol（与 `map_status` 共用）。
- `list_models`：`GET {base}/v1/models` → `{ "data": [{ "id", "display_name"? }] }`。

### 4.3 分发

`generation.rs` 中 `match protocol { OpenAiCompatible => openai::…, Anthropic => anthropic::… }` 静态分发；`model_list.rs` 同样。两协议共用：HTTP client 单例（`no_proxy`、无重定向、超时不变）、传输错误映射、状态码映射、取消令牌集成。协议扩展点 = 新增模块 + enum 变体 + 两处 match（design 层面刻意保持显式）。

## 5. 生成流程（`generation.rs`）

`prepare_generation` 解析顺序：

```
binding = conversations.provider_id / conversations.model（load_generation_context 扩展返回）
effort  = conversations.reasoning_effort（独立于 binding）
provider = providers.find(binding.provider_id ?? app_settings['active_provider_id'])
         ?? Err(ProfileNotFound)          // 绑定行由 FK SET NULL 保证存在性
model    = binding.model（binding.provider_id 非 NULL 时） ?? provider.model
```

effort 随快照进入 `PreparedGeneration`，按协议映射进请求体（§4.1/§4.2）；其余同前。

- 归档会话只读保护在命令层已存在，不重复校验。
- `started` 事件 DTO 保持 `{model}` 不变（不引入 provider 字段，避免前端事件机校验改动）。
- **thinking 数据流（PRD R8）**：协议层 `stream` 的回调拆为 `on_delta`（正文）与 `on_thinking`（思考）双通道，返回值从 `String` 改为 `GeneratedContent { content: String, thinking: Option<String> }`；生成事件新增 `thinking_delta {generation_id, content}`（仅在 streaming 阶段合法，与 `delta` 并列）；`finish_generation` 持久化时思考非空则写入 `nodes.metadata.thinking`（正文仍存 `content`，metadata 无思考时保持 `{}`）。字节上限正文/思考双通道各 1MB（前端 `MAX_GENERATED_CONTENT_BYTES` 同步拆分）。
- **流式期间不锁定配置（PRD R1/R3）**：`PreparedGeneration` 在 prepare 时快照 endpoint/model/secret/协议客户端，在途生成不再回读 providers 表或激活位；service 的 `operation_lock` 只串行化配置变更本身。因此流式中编辑/删除 provider、切换绑定均不影响在途生成，变更自下一条消息生效。

## 6. 命令面（`commands.rs`，前后端同批替换）

| 新命令 | 请求 | 响应 |
|---|---|---|
| `list_providers` | `{}` | `{ providers: RedactedProvider[], active_provider_id: Option<String> }` |
| `save_provider` | `{ id?: String, name, protocol, base_endpoint, model, api_key }`（无 id=创建） | `RedactedProvider` |
| `delete_provider` | `{ provider_id }` | `{ deleted: bool }` |
| `set_active_provider` | `{ provider_id }` | `{ active_provider_id: String }` |
| `list_provider_models` | `{ source: {type:"saved", provider_id} \| {type:"draft", protocol, base_endpoint, api_key?: String} }` | `{ models: [{ id, display_name?: String }] }`（按 id 排序，上限 500） |
| `set_conversation_provider` | `{ conversation_id, binding: null \| { provider_id, model }, reasoning_effort: null \| "low" \| "medium" \| "high" }`（整体覆盖写入；binding 与 effort 互不牵连） | `{ conversation_id, provider_id: Option, model: Option, reasoning_effort: Option }` |

- 删除级联（service 层，操作日志锁内）：reconcile → 删 providers 行（FK 自动置空会话绑定）→ 若为激活 provider 则删 `active_provider_id` 设置行（回退未配置，不自动继任）。
- `set_conversation_provider` 归 conversations 命令面：provider 存在性校验（读 providers 表）、model 校验（`validate_model`）、二者同置同清（binding 非空则两字段必填）。
- `load_provider_profile` / `delete_provider_profile` 移除；`generate_from_active_path` / `cancel_generation` 请求响应形状不变（内部解析逻辑变）。
- 会话列表/详情 DTO 增加 `provider_id: Option<String>`、`model: Option<String>`、`reasoning_effort: Option<String>`（仅绑定/设置值，不含解析结果——前端结合 providers store 自行计算展示）。

## 7. 前端设计

### 7.1 类型与契约（`types/`、`lib/tauri/provider-schemas.ts`、`provider-client.ts`）

```ts
type Protocol = "openai_compatible" | "anthropic"
type ProviderView = { id, name, protocol, baseEndpoint, model, hasApiKey, createdAt, updatedAt }
type ModelSummaryView = { id: string, displayName?: string }
type ModelListSource = { type: "saved"; providerId: string }
                     | { type: "draft"; protocol; baseEndpoint; apiKey?: string }
type ReasoningEffort = "low" | "medium" | "high"      // 会话独立设置，null = 不发送
// 生成事件新增变体：{ type: "thinking_delta"; generationId; content }
// ConversationNodeView 透出 metadata.thinking → thinking?: string（assistant 消息）
// 会话视图增加 providerId/model（绑定）与 reasoningEffort 字段
```

- DTO zod schema、client 方法与 `contract-fixtures/provider-ipc.json` 同步更新；旧单 profile schema/方法删除。
- 会话类型（`features/conversations/types`）增加 `providerId: string | null`、`model: string | null`。

### 7.2 providers store（zustand，替换现单 profile store）

- 状态：`{ phase, providers: ProviderView[], activeProviderId: string | null }` + 每会话绑定不进此 store（归 conversations store）。
- actions：`loadProviders`、`saveProvider`、`deleteProvider`、`setActiveProvider`；沿用 requestEpoch 竞态防护与 `normalizeError` 模式。
- 模型列表**不进 store**：拉取是瞬时交互（按钮/开面板），组件本地 state 管理（loading/error/list），避免全局缓存语义（PRD 决策 3：不缓存）。

### 7.3 设置对话框（`GlobalSettingsDialog.tsx` 重构）

- 结构：provider 列表（名称 + 协议徽章 + 默认模型 + API key 状态 + 激活单选）＋ 选中/新建的编辑表单（名称、协议选择、base endpoint 按协议换 placeholder、模型字段 = 手动输入 + 「获取模型列表」按钮 + 下拉、API key 三态沿用 `apiKeyAction.ts`）＋ 删除确认（AlertDialog 沿用）。
- 「获取模型列表」用 draft source（未保存也能拉）；保存前校验名称唯一（错误透传）。
- 只读（归档会话）保护保留；**移除 `generationActive` 门禁**（PRD 决策：流式过程中不锁定设置，隔离性由 §5 快照保证）：对话框 props 去掉 `generationActive`，`mutationDisabled` 仅由 `readOnly || phase === "loading"` 构成。

### 7.4 会话 provider/model 选择器（新组件 `ConversationProviderPicker`）

- 位置：会话工作区头部；显示 effective 值：`binding ?? (activeProvider 默认)`。
- 交互：打开 Popover → provider 列表（含「跟随全局默认」清除项、「管理服务提供商…」打开设置对话框）→ 选中 provider 后按需 `list_provider_models`(saved) 拉模型（loading/重试/手动输入兜底）→ 选定即 `set_conversation_provider`。
- **effort 选择组**（PRD R9）：同一 Popover 内 model 旁提供 默认/低/中/高 单选（ToggleGroup 或 Select），与会话绑定独立提交（未选=「默认」，不发送参数）。
- 生成中不禁用（见 §5）；归档会话中禁用（沿用 readOnly 语义）。

### 7.5 生成控制器与消息展示

- `useWorkspaceGenerationController` 请求形状不变；事件机（`provider-client.ts` 校验逻辑）**需扩展**：合法转移表加入 `thinking_delta`（仅 streaming 阶段、generation_id 匹配），思考字节计入独立 1MB 预算。
- `MessageNode`（assistant）thinking 展示基于 shadcn **`Marker`** 组件（本任务新增安装 `marker` + `shimmer` 工具 + `collapsible`，项目当前均未装）：
  - **流式思考中**：`<Marker role="status">` + `MarkerIcon(Spinner)` + `MarkerContent className="shimmer"`（「思考中…」动画行；shimmer 为官方流式文字动画工具类，随 `shadcn` 包提供）；思考文本在其下方实时流入。
  - **首个正文 delta 后**：动画行消失，思考内容折叠进 `Collapsible` 区块，点击可展开/收起。
  - **历史消息**（`metadata.thinking` 存在）：默认折叠，折叠头复用 `Marker`（default 变体、静态、无 shimmer、无 role）。
  - 可访问性遵循组件文档：流式行 `role="status"`，`MarkerIcon` 自带 `aria-hidden`；纯展示行不加 role。
- 会话头部 effective 值由 providers store + conversation binding 计算。

## 8. 兼容与迁移

- 升级路径：0005 迁移原子执行；keyring 不动；存量 pending 凭据操作归 `'default'` 继续可回放。
- 无 provider 的新装库：`providers` 空、无 `active_provider_id` 行 → 前端 `unconfigured` 语义（与现 `ProfileNotFound` → unconfigured 一致）。
- 回滚：迁移不可逆（DROP 旧表），回滚 = 恢复备份库或前滚修复；实现顺序上先落后端测试（含迁移测试）再动前端，风险集中在后端首批提交。

## 9. 主要权衡记录

- **enum match 而非 trait/dyn**：两协议下 match 更直白可测；第三协议加入时再评估抽象（YAGNI）。
- **激活位用 app_settings 而非 providers.is_active 列**：避免翻转激活的双写与部分唯一索引；key-value 表可复用于未来设置。
- **删除激活 provider 不自动继任**：静默切换 provider 可能让生成打到非预期端点，显式未配置更安全。
- **Anthropic `max_tokens` 固定 8192 + thinking 默认全开（budget 2048）**：思考显示是本任务需求（PRD R8），原生协议必须显式开启；固定预算避免新增 provider 字段与 UI 开关。Claude 4.x 输出上限 ≥32k 全部安全，仅 Claude 3 Haiku（4096）等旧模型会 400——可接受，预算/开关可配置化延后（PRD Out of Scope）。
- **reasoning effort 会话级独立列**：与 provider/model 绑定互不牵连（清除绑定不清 effort）——effort 是模型无关的轻量旋钮，随会话走比随绑定走更符合直觉；未选不发参数是唯一的兼容性防线（OpenAI 系严格服务商会对不支持模型 400，错误经现有映射透出，用户自行调整档位）。`minimal` 档（gpt-5 专属）与 provider 级默认延后（PRD Out of Scope）。
- **thinking 存 `metadata` 而非新列**：`nodes.metadata` 已是 `json_valid` TEXT 且节点一次性插入（immutable 触发器无 UPDATE 场景），零迁移；前端经 node DTO 透出 `thinking` 字段。
- **模型列表不缓存**：拉取点都是显式交互，缓存失效复杂度 > 收益（PRD 决策 3）。
- **流式期间解锁配置修改**：快照隔离（§5）使锁定没有必要；锁定反而与「会话内随时切换」语义不一致。若用户困惑可加「下一条生效」UI 提示，不回退锁定。
