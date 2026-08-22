# 禁用标题请求思考修复 DeepSeek v4

## Goal

修复 DeepSeek v4 Flash/Pro（Anthropic 协议）自动标题静默失败：标题请求省略 `thinking` 字段时 DeepSeek v4 默认开思考，思考 token 烧穿 `max_tokens`，正文零输出 → `stop_reason=max_tokens` → `stream_body` 空正文守卫抛 `Protocol` → 被折叠为无细节的 `title_generation_skipped`。修复方式为显式发送 `thinking: {"type":"disabled"}`（诊断会话已实测验证：Flash/Pro 均遵守，0 思考事件、6–14 token 出标题；且是 Anthropic 官方合法值，不影响真 Claude 端点）。

## Background（已确认事实）

- 诊断来源：sess_439d8efc 重放验证；放大 max_tokens 不可靠（最坏 prompt 下 2048 仍被烧穿，8192 时思考 ~1500 token），`budget_tokens` 语义 DeepSeek 不遵守。
- 现状代码（main @ 482990b）：`src-tauri/src/providers/anthropic.rs:30` `Thinking { kind, budget_tokens: u32 }` 只能表达 enabled 形态；`:126` 标题请求 `thinking: None` → 序列化时整个字段省略；`:350` 测试断言 `thinking` 字段缺失。
- PR #12 的 max_tokens=256 保留（上限无害；禁用思考后正文仅需 6–14 token）。
- 主对话路径（`build_request`）始终发送 enabled+budget，不受影响。

## Requirements

- R1 `Thinking` 结构的 `budget_tokens` 改为 `Option<u32>`（`skip_serializing_if`），保持 enabled 形态序列化不变（`{"type":"enabled","budget_tokens":N}`）。
- R2 标题请求（`build_title_request`）显式发送 `thinking: Some({"type":"disabled"})`，即请求体含 `{"type":"disabled"}`、无 `budget_tokens`。
- R3 主对话请求路径序列化字节级不变。
- R4 spec 同步：provider-guidelines.md Auto-Title 一节"Anthropic keeps thinking off"改为"显式 `{"type":"disabled"}`（省略字段对 DeepSeek v4 无效）"。

## Acceptance Criteria

- [ ] `title_request_disables_thinking_and_limits_output`（anthropic.rs:350）断言更新：`request["thinking"]["type"] == "disabled"` 且无 `budget_tokens` 键。
- [ ] 主对话 thinking 测试（`budget_tokens` 1024/4096/16384 + type=="enabled"）保持通过、无改动。
- [ ] `cargo test` 全量全绿；`cargo clippy --all-targets -- -D warnings` 通过；编辑文件 fmt-clean。
- [ ] spec 文案同步（R4）。

## Out of Scope

- `title_generation_skipped` 埋点细分（遗留候选 7）
- openai_compatible 通道调整（诊断确认 gpt-5.6 网关默认不思考，无问题）
- 失败重试（遗留候选 2）
