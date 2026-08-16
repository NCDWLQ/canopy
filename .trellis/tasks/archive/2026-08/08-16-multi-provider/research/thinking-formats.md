# Thinking / 推理内容流式格式调研

调研日期：2026-08-16。为「多 Provider 支持」任务的 thinking 显示功能（PRD R8）提供实现依据。实现时应以各服务商最新文档复核字段名。

## OpenAI 兼容系（无需改请求，模型思考时自动输出）

SSE chunk 的 `choices[0].delta` 除 `content` 外可选携带思考字段：

- `delta.reasoning_content` — DeepSeek R1（deepseek-reasoner）约定，智谱 GLM、Qwen、SiliconFlow 等国内服务商广泛沿用。
- `delta.reasoning` — OpenRouter 约定。

两者同一 chunk 不会同时出现；解析规则：`reasoning_content` 优先，其次 `reasoning`。字段可能为空字符串（跳过）。请求侧无任何开关——模型自身决定是否思考，不思考就没有这些字段。

示例 chunk：

```json
{"choices":[{"index":0,"delta":{"reasoning_content":"让我想想..."},"finish_reason":null}]}
{"choices":[{"index":0,"delta":{"content":"答案是..."},"finish_reason":null}]}
```

注意：OpenAI 官方 o 系列在 chat completions 下不输出 reasoning 字段（Responses API 才有）；Gemini 的 OpenAI 兼容层同样不返回思考。本功能对这类「无思考输出」的模型自然降级为普通展示，无需特判。

## Anthropic（需请求显式开启）

### 请求

```json
{
  "model": "...",
  "max_tokens": 8192,
  "thinking": { "type": "enabled", "budget_tokens": 2048 },
  "stream": true,
  ...
}
```

约束：`budget_tokens >= 1024`；`max_tokens` 必须大于 `budget_tokens`（预算只约束思考，最终回答另占 max_tokens 总额）。开启后计费与延迟小幅增加。

模型兼容：Claude 4.x 系列输出上限 ≥32k，max_tokens=8192 安全；仅 Claude 3 Haiku（4096）等旧模型会 400（max_tokens 超限），可接受。

### 流式事件（在既有事件之外新增）

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"..."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"..."}}   ← 忽略

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"..."}}
```

解析要点：

- 用 `content_block_start.content_block.type`（`thinking` | `text`）登记 index → 类型，`content_block_delta` 按 index 路由：`thinking_delta.thinking` 累入思考，`text_delta.text` 累入正文。
- `signature_delta`、`citation_delta` 等其他 delta 类型忽略（不报错）。
- 完成语义不变：`message_delta.delta.stop_reason ∈ {end_turn, max_tokens}` + `message_stop`。
- 思考为可选内容：正文非空仍是成功必要条件；无思考块时行为与未开启一致。

## 事件协议与持久化约定（本任务设计）

- 生成事件新增 `thinking_delta {generation_id, content}`，与 `delta`（正文）并列；仅在 streaming 阶段合法（前端事件机同步扩展）。
- 后端 stream 返回值从 `String`（正文）扩展为 `{content, thinking: Option<String>}`。
- 持久化：正文仍存 `nodes.content`（语义不变）；思考存 `nodes.metadata` JSON 的 `thinking` 字段（`metadata` 已是 `json_valid` TEXT，无需迁移）。无思考时 metadata 保持 `{}`，不写空字段。
- 字节上限：思考与正文各自套用既有 1MB 上限（前端 `MAX_GENERATED_CONTENT_BYTES` 同步扩展为双通道）。
- UI：assistant 消息可折叠「思考过程」区块——思考流式期间展开，首个正文 delta 到达后自动折叠，点击可再展开；历史消息默认折叠。

## 权衡记录

- Anthropic 思考**默认全开**而非按 provider 开关：避免新增 provider 字段与 UI 开关；代价是每次请求多花思考 token 与少量延迟。预算档位随会话 reasoning effort 映射（PRD R9 / design §4.2：low=1024 / 未选=2048 / medium=4096 / high=16384，max_tokens = budget + 4096）；开关与档位可配置化延后（PRD Out of Scope）。
- OpenAI 兼容系零请求改动捕获思考；reasoning effort 仅在会话显式选择时发 `reasoning_effort`（未选不发，避免不支持的服务商 400）。
- 流式动画行用 shadcn Marker（`role="status"` + Spinner + shimmer 工具类，官方 Thinking 流式场景同款）；折叠容器用 Collapsible。
