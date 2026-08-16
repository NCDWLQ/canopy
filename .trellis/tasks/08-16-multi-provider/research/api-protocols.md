# 常见聊天补全 API 协议与模型列表端点调研

调研日期：2026-08-16。为「多 provider 支持」任务的协议范围决策提供依据。

## 协议概览

### 1. OpenAI 兼容协议（事实上的行业标准）

- 端点：`POST {base}/chat/completions`（SSE 流式，`data: [DONE]` 结尾），`GET {base}/models` 拉模型列表。
- 模型列表响应：`{ "data": [{ "id": "model-name", ... }] }`。
- 认证：`Authorization: Bearer <key>`。
- 覆盖的服务商：OpenAI 本家、DeepSeek、Moonshot/Kimi、智谱 GLM、SiliconFlow、OpenRouter、Groq、Mistral、xAI，以及本地方案 Ollama（`/v1`）、LM Studio、vLLM。
- **Canopy 现状即此协议**（`openai_compatible.rs`），单 choice、finish_reason=stop、`[DONE]`。

### 2. Anthropic Messages API（Claude 原生）

- 端点：`POST {base}/v1/messages`（SSE 流式，事件类型 `message_start` / `content_block_delta` / `message_stop` 等，无 `[DONE]`）。
- 模型列表：`GET {base}/v1/models` → `{ "data": [{ "id": "...", "display_name": "..." }] }`。
- 认证：`x-api-key` + `anthropic-version` 头，与 Bearer 不同。
- 请求体：`system` 独立顶层字段（非 messages 内 system role）、`max_tokens` 必填。
- 消息角色：user / assistant，assistant 内容为 blocks 数组。

### 3. Google Gemini（原生 generateContent）

- 端点：`POST .../v1beta/models/{model}:generateContent`（流式为 `:streamGenerateContent?alt=sse`），URL 结构与上面两者差异最大（模型在路径里）。
- 模型列表：`GET /v1beta/models` → `{ "models": [{ "name": "models/gemini-...", "displayName": ... }] }`。
- 认证：`x-goog-api-key` 头或 `?key=`（后者与现有 endpoint 校验冲突：拒绝 query）。
- **重要**：Google 官方提供 OpenAI 兼容层 `https://generativelanguage.googleapis.com/v1beta/openai/`，含 `/models` 列表。走 OpenAI 兼容协议即可用 Gemini，无需原生支持。

### 4. Azure OpenAI

- URL 结构特殊：`{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=...`（query 参数与现有 endpoint 校验冲突），认证为 `api-key` 头。
- 国内直连场景少，且可通过网关/代理转成 OpenAI 兼容形式。

## 对架构的影响

- 协议数量决定后端是否需要 strategy/enum 分发：每协议需要 (a) 请求构造器 (b) SSE 解析器 (c) 模型列表端点与响应解析 (d) 认证头方式。
- OpenAI 兼容 + Anthropic 两协议即可覆盖绝大多数国内外主流场景；Gemini 可借官方 OpenAI 兼容层使用。
- 模型列表三种响应格式（`data[].id` / `data[].id+display_name` / `models[].name`）都需各自解析，但 OpenAI 兼容与 Anthropic 的 `{data: [...]}` 外层结构一致。

## reasoning effort 参数约定（2026-08-16 补充，PRD R9）

- OpenAI 兼容系：请求体可选 `reasoning_effort`，取值 `minimal`（gpt-5 专属）/`low`/`medium`/`high`，仅推理模型（o 系、gpt-5 等）有意义；发给不支持的模型时严格服务商会 400，宽松网关忽略。约定：**仅在用户显式选择时携带**（skip_serializing_if），MVP 档位 low/medium/high，minimal 延后。
- OpenRouter：统一为 `reasoning: { effort: "low" | "medium" | "high" }`（或 `reasoning.max_tokens`）；其 OpenAI 兼容端点也接受顶层 `reasoning_effort`。
- Anthropic：无 effort 参数，等价旋钮是 thinking `budget_tokens`；映射档位见 design §4.2（low=1024 / medium=4096 / high=16384，未选默认 2048）。
- DeepSeek R1 等始终思考的模型无该参数；「未选不发」策略天然兼容。

## 结论（供决策参考）

- 推荐 MVP：OpenAI 兼容 + Anthropic 原生。
- Gemini 原生、Azure 可延后（前者有官方 OpenAI 兼容层兜底，后者场景少）。

## DeepSeek Anthropic 端点实测（2026-08-17，修复「无法使用」故障）

- 正确 base：`https://api.deepseek.com/anthropic`（messages = `/anthropic/v1/messages`）；只填 `https://api.deepseek.com` 会打到 `/v1/messages` → 404。
- `thinking` 参数受支持（budget_tokens 被忽略，思考仍会输出）；SSE 完全标准：thinking/text content_block 按 index 路由、`signature_delta` 伴随 thinking 块、`stop_reason: "end_turn"`、`message_stop` 收尾，ping 无 `event:` 行（纯 data）。
- **`GET /anthropic/v1/models` 带有效鉴权仍 404**——但同主机的 OpenAI 兼容面提供模型列表：`GET /v1/models` 与 `GET /models` 均返回 OpenAI 格式（同一 key、x-api-key/Bearer 皆可）。
- **回退实现（2026-08-17 补）**：anthropic 协议拉模型列表遇 404 时，自动以 Bearer 探测 `{origin}/v1/models`（OpenAI 格式解析），成功即用；双 404 照常报协议错误；非 404（如 401）不触发回退。api.anthropic.com 自身 200 不受影响。
- 错误响应为纯文本（如 401 的 `Authentication Fails (governor)`），非 Anthropic 错误 JSON；状态码映射不受影响。
- 修复：用户 DB 端点改为带 /anthropic；设置对话框 anthropic 协议增加 FieldDescription 提示网关前缀。
