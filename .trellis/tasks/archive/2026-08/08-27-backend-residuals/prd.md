# 后端重构遗留问题收敛

## Goal

在不重新打开已完成的后端能力边界重构、不改变既有 IPC 字段与本地凭据语义的前提下，收敛三项已确认遗留：建立 v0.4.0 已发布数据库升级安全网、修复 provider 删除后的会话绑定残值，以及解除 Markdown 导出对数据库可用性的假依赖。

## Background

- `v0.4.0` 是正式 Git tag，已包含 `0001`–`0006`；后续任何新 migration 都必须验证从该已发布 schema 前向升级。
- 当前删除 provider 时 SQLite 只通过 `ON DELETE SET NULL` 清空 `conversations.provider_id`，`model` 仍可残留；DTO 层会隐藏该残值，但数据库不变量不完整。
- 当前 `write_export_file` 在文件写入前解析 managed SQLite pool；数据库不可用会阻止不需要 SQL 的导出。
- 三个交付物可独立验证；数据库残值修复依赖升级夹具，导出解耦可独立执行。

## Requirements

- R1. 子任务 `08-27-released-db-upgrade-harness` 建立 v0.4.0 已发布数据库的可重复前向升级验证。
- R2. 子任务 `08-27-cleanup-stale-provider-binding` 清理既有残值并防止未来 provider 删除再次留下 `model`。
- R3. 子任务 `08-27-decouple-export-database` 移除导出命令的 managed-database 前置条件，同时保持命令名、请求/响应结构与文件校验契约。
- R4. 执行顺序为 R1 → R2；R3 可独立执行。每个子任务单独规划、检查、提交并归档。
- R5. 父任务只拥有跨子任务范围、顺序与最终集成验收，不承载生产实现。

## Acceptance Criteria

- [x] 三个子任务均通过各自验收、质量门和归档流程。
- [x] v0.4.0 fixture 能经生产 migration 目录升级到当前 schema，且数据、外键、触发器和 migration ledger 完整。
- [x] provider 删除后 `provider_id` 与 `model` 同时为空；既有残值升级后被清理，`reasoning_effort` 不受影响。
- [x] 数据库不可用时，合法 Markdown 导出仍可写入；IPC 与文件错误契约保持稳定。
- [x] 全量 Rust、前端检查与 debug no-bundle Tauri build 通过，相关 backend spec 与最终实现一致。

## Out of Scope

- 自动标题与手动改名竞态。
- 前端 Tauri client 按 settings/generation/providers 重新分组。
- 动态 LLM protocol/plugin 架构、新协议或新生成能力。
- 与三项遗留无关的 schema、IPC、UI、凭据或产品行为变更。

## Task Map

- `08-27-released-db-upgrade-harness`：先执行，提供后续 migration 的发布升级门。
- `08-27-cleanup-stale-provider-binding`：依赖升级夹具通过后执行。
- `08-27-decouple-export-database`：无数据库 migration 依赖，可独立执行。
