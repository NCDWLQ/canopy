# 改进对话标题生成（快速包：候选 1+4+6+5）

## Goal

基于对 Open WebUI / LibreChat / NextChat / LobeChat 的调研（见 research.md），修复自动标题生成在思考型模型下的静默失败，并通过 prompt 重写（角色分离 + few-shot + 风格约束）与输出清洗强化提升标题质量。不改动触发/重试逻辑，无 schema 变更。

## Background（已确认事实）

- 现有实现：`src-tauri/src/providers/title_prompt.rs` 单 user 消息（指令+数据混装）；`openai_compatible.rs:87` / `anthropic.rs:117` 的 `build_title_request`：max_tokens=60、reasoning_effort=None（Anthropic thinking=None）。
- 正确性问题：o 系列 / R1 类思考模型的思考 token 计入 max_tokens，60 不够，正文可能为空 → 标题静默失败（仅 `title_generation_skipped` 埋点）。标题模型 fallback 会直接用会话主模型（`titles.rs:110`），思考型主模型必然踩中。
- 传输层复用：两协议的 `stream_title` 均调用与主对话相同的流式函数（`stream_chat_completion` / `stream_body`）；请求体构造各自独立，改标题请求不碰主对话路径。
- `ReasoningEffort::Low`（`conversations/domain.rs:29`）现成，`as_str()` → "low"；`ChatCompletionRequest.reasoning_effort` 仅在 Some 时序列化。
- `clean_title`（`titles.rs:139`）现只合并空白 + 去包裹引号；`validate_title`（`conversations/commands.rs:395`）只查空白与长度。
- 本项目注入防护（转义 + 不可信声明）与分语言长度限制优于四个参考产品，重写 prompt 时必须保留。

## Requirements

- R1（候选 1）标题请求输出预算从 60 提到足够容纳思考型模型的少量思考 + 标题正文的值；OpenAI-compatible 通道标题请求携带 `reasoning_effort: "low"`，压制思考开销；Anthropic 通道维持 `thinking: None`，仅提升 max_tokens。
- R2（候选 6）标题请求改为 system/user 角色分离：任务指令全部进 system，`<conversation>` 数据进 user。两协议同步（OpenAI-compatible 加一条 system 消息；Anthropic 顶层 `system` 字段填指令）。
- R3（候选 4）system 指令重写并强化：保留现有全部约束（user 消息为主、反模糊标题黑名单、语言跟随用户消息、分语言长度限制、注入防护声明、裸文本输出）；新增：压制花哨风格（plain and factual）、显式禁 emoji/《》/引号/Markdown/包裹标点、2-3 个中英 few-shot 示例并注明勿照抄。
- R4（候选 5）`clean_title` 在去引号后剥离开头的 "Title:"/"标题："/"标题:" 前缀（仅带冒号形式，一次），再走 `validate_title`。
- R5 注入防护与截断行为不回退：2000 字符截断、`&<>` 转义、转义后的结构完整性保持现有测试语义。

## Acceptance Criteria

- [ ] `build_title_request`（OpenAI-compatible）序列化结果：messages 为 [system, user] 两条、max_tokens 为新预算值、`reasoning_effort == "low"`；对应单元测试由"disables_reasoning"反转为"bounds_reasoning"断言。
- [ ] `build_title_request`（Anthropic）：顶层 `system` 为指令文本、messages 仅 1 条 user、max_tokens 为新预算值、`thinking` 不存在/禁用。
- [ ] `title_prompt` 测试：system 含 few-shot 示例、风格与符号禁令、注入防护声明；user 含转义后的 `<conversation>` 块；两条各 2000 字符截断与转义防逃逸断言保持通过。
- [ ] `clean_title` 测试新增：`"Title: Foo"`→`"Foo"`、`"标题：东京三日"`→`"东京三日"`；不以冒号开头的合法内容（如"标题党现象讨论"）不被误剥。
- [ ] `cargo test`（src-tauri）全绿；改动文件通过 `cargo fmt --check` 与 clippy（遵循"仅保持已编辑文件 fmt-clean"约定）。
- [ ] 主对话请求路径（`build_request` 两协议）零改动。

## Out of Scope

- 候选 2 失败重试 + title 来源列 migration（本轮明确不做；首轮失败仍不重试）
- 候选 3 寒暄开场兜底（多带 user 消息）
- 候选 7 埋点按失败原因细分
- temperature 字段引入（`ChatCompletionRequest` 无此字段，属请求结构扩展，收益不明确）
- JSON Schema 结构化输出、用户自定义标题 prompt、titleTiming=immediate 并行生成

## Technical Notes

- 严格 OpenAI-compatible 网关若拒绝 `reasoning_effort` 参数会 400 → 标题跳过并埋点，与现状失败路径一致，可接受（设计文档记录该权衡）。
- 前端零改动；`TITLE_UPDATED_EVENT` 协议不变。
