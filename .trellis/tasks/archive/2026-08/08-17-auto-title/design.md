# 会话标题自动生成 — 技术设计

## 架构与边界

```
助手回复持久化完成 (providers/generation.rs finish_generation → Completed)
        │
        ▼
[titles.rs] 读取 app_settings.auto_generate_title（缺省 true / 开启）
        │ 关闭 → 立即返回，零 LLM 调用
        ▼
[titles.rs] 判定：该会话是否只有 1 个 assistant 节点（首轮回复）
        │ 是
        ▼
[titles.rs] 解析标题模型绑定：
   app_settings.title_model_binding (JSON {provider_id, model})
   ├─ 未配置 → 跟随会话：conversation.provider_id + conversation.model
   └─ 会话无绑定 → 回退 active provider (ACTIVE_PROVIDER_SETTING_KEY)
        │
        ▼
[titles.rs] 一次性轻量调用：复用 OpenAiCompatibleClient / Anthropic 流式通道，
   max_tokens ≈ 60，禁用 thinking，累积 delta 为纯文本
   ⚠ 不经过 GenerationRuntime（不写节点、不占会话生成锁）
        │
        ▼
[titles.rs] 清洗：trim、去首尾引号、单行化；validate_title (≤200 chars)；
   失败/为空 → 静默放弃，保留截断标题
        │
        ▼
conversations Repository: UPDATE conversations.title
        │
        ▼
Tauri 全局事件 `conversation://title-updated` { conversation_id, title }
        │
        ▼
前端 store 监听 → upsertSummary 更新 history.summaries；
若为当前会话，同步更新 tree.conversation.title
```

## 数据流与契约

### 新增 IPC 命令（providers 域）

- `set_auto_generate_title(bool)` / 读取并入设置加载路径 — 写入 `app_settings.auto_generate_title`（`"true"` / `"false"`）。
- `set_title_model_binding({ provider_id, model } | null)` — 写入/清除 `app_settings.title_model_binding`；null = 跟随会话。校验 provider 存在且 model 属于该 provider 的 models 列表。
- 绑定与开关读取并入现有设置加载路径或独立 getter，前端设置对话框加载时读取。

### Tauri 事件契约

```json
// event: conversation://title-updated
{ "conversation_id": "...", "title": "..." }
```

序列化遵循现有 snake_case 契约（`deny_unknown_fields` 风格，参考 commands.rs DTO)。

### 标题生成提示词（内部常量，不进设置）

- 硬编码英文指令（`providers/title_prompt.rs`）：概括用户首轮主题/问题/意图；用户消息为主、助手仅消歧辅助；标题语言跟随用户消息；中文 ≤20 字、非中文 ≤40 字符；只用纯标题文本。对话内容包裹在 `<conversation>/<user>/<assistant>` 中；嵌入前对 `&<>` 做实体转义，防止 `</conversation>` 标签逃逸注入。
- **存放位置**：独立于业务编排——仅导出提示词模板/组装函数；`titles.rs` 只调用组装结果，不内联长字符串。
- 模型返回纯文本标题（非 JSON）；清洗后写库（仅剥成对包裹引号，保留内容引号）。

## 关键决策与取舍

| 决策 | 选择 | 取舍 |
|------|------|------|
| 触发点 | 后端 `finish_generation` Completed 后 spawn 异步任务 | 前端无感知、不阻塞回复事件；代价是后端需自行解析绑定与凭证 |
| 并发 | 独立路径，绕过 GenerationRuntime | 标题调用与回复生成互不阻塞；理论上同 provider 会有两个并发请求，可接受 |
| 总开关 | 设置「自动生成会话标题」，默认开；后端在 spawn 前读开关 | 用户可控成本/隐私；关闭时零 LLM 调用，标题模型选择器仅 UI 禁用 |
| UI 文案 | 仅控件标签，无辅助说明段 | 语义已由开关名 +「标题模型」表达；避免设置页噪音 |
| 触发条件 | 开关开启且会话 assistant 节点数 == 1 | 天然一次性，无需"标题是否默认"的字符串比对； rename 不存在，无覆盖风险 |
| 失败处理 | 全流程静默回退，仅 log（遵循 logging-guidelines 脱敏） | 标题是锦上添花，绝不打断主流程 |
| 通知前端 | 新增全局 `emit` 事件（项目首个全局事件） | 替代方案"完成后再拉取历史"有时序竞争（标题生成晚于树刷新），事件最稳 |
| thinking | 标题调用禁用 reasoning/thinking | 避免 thinking 模型的额外开销与输出污染 |
| 提示词存放 | 独立 `title_prompt` 模块，纯文本返回 | 业务编排与文案解耦；改措辞不碰触发/写库逻辑 |

## 兼容性

- 纯增量：新设置键、新命令、新事件，不动现有表结构（无需 migration)。
- 旧行为保留：创建会话时仍先写截断标题作占位，首轮回复后被覆盖。

## 回滚

- 事件监听缺失时功能静默无效（标题保持截断占位），无崩溃面。
- 后端标题任务任何一步失败都只影响标题本身。

## 测试策略

- 后端：开关关闭短路、绑定解析矩阵（跟随会话/指定/无绑定回退 active)、触发条件（assistant 节点数）、标题清洗（引号/换行/超长/空）、失败静默。
- 前端：store 监听事件 → summary upsert + 当前会话标题同步；设置对话框开关 + 标题模型选择交互（关时选择器禁用）。
- 契约：事件 payload 反序列化测试。
