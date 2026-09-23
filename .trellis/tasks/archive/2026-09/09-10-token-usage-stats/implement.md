# Token 用量统计 — 执行计划

## 有序检查清单

1. [x] 迁移 `src-tauri/migrations/0009_token_usage.sql` + `infra/database.rs` 的 `MIGRATION_CATALOG` 注册
2. [x] `llm/domain.rs`：`TokenUsage` 类型 + `GeneratedContent.usage`
3. [x] `adapters/openai_compatible.rs`：`ChatCompletionRequest` 加 `stream_options.include_usage`（同时覆盖 build_request / build_title_request）+ 终帧 usage 解析 + 400 提及 stream_options 时的去字段重试兜底
4. [x] `adapters/anthropic.rs`：`message_start` 取 input_tokens、`message_delta` 的 `usage.output_tokens` 末次覆盖；不改变既有 stop_reason 错误控制流
5. [x] 适配器单测：fixture SSE 流（有 usage / 无 usage / 400 重试三态），确定性断言
6. [x] `usage` 模块：`usage/repository.rs`（insert + 聚合查询 + clear），模块注册；仓库测试用显式时间戳验证按日/按模型聚合与 localtime 分组
7. [x] `generation/service.rs` `finish_generation`：chat 记录落库（写失败仅 warn）
8. [x] `generation/title.rs`：title 记录落库
9. [x] 迁移测试：0009 约束/索引测试 + 确认 v0.4.0 released fixture 前向升级测试在加入 0009 后仍通过（quality-guidelines 强制路径）
10. [x] IPC：`get_usage_summary` / `clear_usage_records` 命令 + `lib.rs` 注册 + `error.rs` 映射
11. [x] 前端 Zod client（`src/lib/tauri/`）+ contract-fixtures 同步（成功/失败 fixture 与 Rust 序列化对齐）
12. [x] `SettingsDialog` 新增 `usage` 分类 + `UsagePanel.tsx`（汇总卡片 + 来源拆分 + 热度图 + 明细 tabs：按模型/按日表格 + 刷新 + 清除按钮）；热度图为独立子组件（如 `UsageHeatmap.tsx`，Tailwind 7×53 网格 + 5 档相对色阶 + tooltip）
13. [x] 质量检查（见验证命令）+ `trellis-check` 全流程

## 验证命令

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
pnpm check          # format:check + lint + typecheck + test + build
```

## 风险文件 / 回滚点

- `adapters/openai_compatible.rs`：SSE 解析路径是核心链路，改动后必须跑现有 adapter 测试；`stream_options` 兜底重试只限"400 且错误提及 stream_options"，避免对真实 400（如鉴权/模型错误）误重试。
- `adapters/anthropic.rs`：usage 解析不得改变 `message_delta` 的 stop_reason 错误控制流（L237–244）。
- `generation/service.rs` finish_generation：持久化失败不可阻断回复落库。
- 检查点：步骤 6 完成后先验证写入路径（cargo test），再做 IPC 和 UI。
- 回滚：迁移只增不改，代码回滚即安全。

## 启动前检查

- prd.md / design.md / implement.md 齐备 ✓
- implement.jsonl / check.jsonl 需含真实 spec 条目（非 seed `_example`）
- `task.py start` 需用户在最终规划摘要后明确批准
