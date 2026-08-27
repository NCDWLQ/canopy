# 修复 provider 删除后的会话绑定残值

## Goal

通过前向 migration 修复已发布数据库中的会话绑定残值，并把“provider 绑定的 `provider_id` 与 `model` 同置同清”恢复为持久化层可验证的不变量。

## Background

- `0005_multi_provider.sql` 为 `conversations.provider_id` 设置 `ON DELETE SET NULL`，但 `model` 是独立可空列。
- 删除 provider 后 DTO 层通过 `binding_model` 隐藏孤立 `model`，因此用户界面通常无异常，但数据库仍保存无所属 provider 的值。
- v0.4.0 已正式发布且包含 `0001`–`0006`，修复必须是 `0007+` 前向升级，不得改写既有 migration。

## Requirements

- R1. 新 migration 必须清理所有 `provider_id IS NULL AND model IS NOT NULL` 的既有 conversation 行。
- R2. 修复必须防止未来从生产 provider 删除路径或直接数据库 provider 删除再次产生同类残值；不得只做一次性数据 `UPDATE`。
- R3. 清理 provider 绑定时保留 conversation、nodes、标题、归档状态和独立的 `reasoning_effort`。
- R4. 正常设置/清除 conversation provider binding 的现有命令、DTO、校验、事务与错误契约保持不变。
- R5. provider credential reconcile、active provider/title binding 清理和 keyring 行为保持不变。
- R6. migration 必须通过 `08-27-released-db-upgrade-harness` 从 v0.4.0 fixture 升级验证，并保留 fresh database 路径。

## Acceptance Criteria

- [ ] v0.4.0 fixture 中的孤立 `model` 升级后变为 `NULL`，其他 conversation 字段逐字节保持。
- [ ] 升级后删除一个仍被 conversation 绑定的 provider，会使该 conversation 的 `provider_id` 和 `model` 同时为 `NULL`，`reasoning_effort` 原样保留。
- [ ] 设置绑定时 provider/model 同时写入，显式清除时同时置空；无新的不一致状态可由受支持路径产生。
- [ ] 重复启动不会重复改写已修复数据，migration ledger 正确。
- [ ] provider、generation、conversation、migration 与全量 Rust 测试通过，六个已发布 migration 文件保持不变。

## Out of Scope

- 清除 `reasoning_effort`。
- 修改 provider 删除的 UI、IPC、错误文案或凭据语义。
- 修复自动标题/手动改名竞态或其他无关 schema 问题。

## Dependency

- 实现前必须先完成并归档 `08-27-released-db-upgrade-harness`。
