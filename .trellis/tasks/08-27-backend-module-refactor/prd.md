# 后端模块边界重构

## Goal

在不改变 Canopy 现有可观察行为、线协议、SQLite schema 或本地凭据的前提下，重构 Rust/Tauri 后端模块边界，使服务商配置、应用设置、LLM 协议、回复生成、自动标题、会话持久化和文件导出分别拥有清晰且无环的所有权。

## Background

- 后端产品代码主要集中在 `src-tauri/src/conversations/` 与 `src-tauri/src/providers/`；两者合计约 6,900 行，并承担了大部分应用能力。
- `providers` 同时拥有服务商配置、keyring 凭据补偿、通用设置、模型发现、协议适配、生成生命周期与自动标题（`src-tauri/src/providers/commands.rs:23-36`, `src-tauri/src/providers/service.rs:72-197`, `src-tauri/src/providers/generation.rs:11-20`, `src-tauri/src/providers/titles.rs:5-12`）。
- `conversations::commands` 同时拥有会话 IPC、provider 绑定校验、ID/时钟、搜索与文件写出（`src-tauri/src/conversations/commands.rs:263-286`, `src-tauri/src/conversations/commands.rs:483-530`）。
- `conversations::commands` 导入 provider 内部校验，而 provider 的生成与标题实现反向导入 conversation command/service，已经形成双向业务依赖（`src-tauri/src/conversations/commands.rs:14`, `src-tauri/src/providers/commands.rs:9-13`, `src-tauri/src/providers/generation.rs:11-14`）。
- 基础数据库适配器返回 conversation 拥有的 `PersistenceError`，`ProviderError` 又包装该错误，基础设施与领域错误的依赖方向倒置（`src-tauri/src/database.rs:4-5`, `src-tauri/src/providers/error.rs:3-4`, `src-tauri/src/providers/error.rs:46-50`）。
- 2026-08-27 的基线验证中，`cargo test --manifest-path src-tauri/Cargo.toml --all-features` 共 108 个 Rust 测试全部通过，可作为行为保持重构的回归基线。

## Requirements

- R1. 重构必须严格保持全部 Tauri 命令名、请求包装、序列化字段、空值语义、成功响应、`CommandError` envelope、生成 Channel 事件和 `conversation://title-updated` 事件。
- R2. 不修改 `src-tauri/migrations/0001`–`0006`，不新增迁移，不改变 `DATABASE_URL`、Tauri SQL preload、表/列/索引/触发器或 keyring credential reference。
- R3. 目标边界必须至少区分 `platform`、`settings`、`llm`、`providers`、`conversations`、`generation` 与 `exports`；每个模块必须有唯一职责和明确依赖方向。
- R4. `providers` 只拥有 provider profile、active provider、凭据与相关配置用例；`settings` 拥有类型化 `app_settings` 存取及语言/主题/自动标题设置；`llm` 拥有无数据库、无 Tauri、无 conversation 依赖的协议与 HTTP 适配。
- R5. `generation` 拥有回复生成运行时、prepare/run/finalize 编排、conversation-provider 绑定用例及自动标题；`conversations` 只拥有会话树、搜索、持久化与会话域契约；`exports` 拥有文件写出策略与命令。
- R6. command 层只负责 DTO 校验、服务组合和错误映射；ID/时钟、共享 DTO、领域校验、HTTP、SQL 与文件策略不得继续以 command 文件作为跨模块共享实现。
- R7. 迁移必须采用 add/switch/remove 顺序和短期 re-export/compatibility façade，保证每个阶段均可独立编译、测试和回滚。
- R8. 在移动高风险边界前补齐生产命令注册、生成命令编排和自动标题的 characterization tests；现有迁移、凭据、协议、生成竞争和会话树测试必须保持通过。
- R9. 不引入全局 `utils`/`common` 杂物模块，不为当前两个协议引入动态 trait 分发；继续使用穷尽 enum match，除非另立设计任务批准。
- R10. 实现完成后更新 Trellis backend/frontend 规范，使规范描述当前目标结构而非早期 singleton provider 结构。

## Compatibility Constraints

- 继续返回当前 `list_providers` 聚合响应，包括 providers、active provider、自动标题、标题模型绑定、语言和主题；内部可由兼容 façade 组合新服务。
- 继续保持每个 conversation 同时最多一个 generation、精确 generation ID 取消、finalization 赢得晚到取消、成功结果仅持久化一次、prepare 时快照 provider 配置。
- 自动标题继续绕过 `GenerationRuntime`，仅在现有条件满足时异步运行，并发出原事件名与 payload。
- provider 凭据继续仅存 keyring；凭据操作日志的 reconcile 与崩溃恢复语义不变。
- provider 删除后 `provider_id = NULL` 而 `model` 可能残留的现状继续由读取层隐藏；本任务不通过新迁移改变该行为。
- `write_export_file` 移入 `exports` 后仍保留当前数据库可用性前置检查，避免改变已测试的错误行为。

## Acceptance Criteria

- [ ] 最终源码存在并使用 `platform`、`settings`、`llm`、`providers`、`conversations`、`generation` 与 `exports` 边界，且职责符合 R3–R6。
- [ ] `src-tauri/src/providers/` 不再包含 generation runtime、回复生成、自动标题或 conversation 依赖；`src-tauri/src/conversations/` 不再导入 provider 内部校验或执行 provider 表查询。
- [ ] `database`/`platform` 不再依赖 `conversations::PersistenceError`，各应用错误只在 Tauri command error 映射边界汇合。
- [ ] 26 个现有命令名、生成事件 `started|delta|thinking_delta`、终态 `completed|cancelled|failed`、全局标题事件及前端 Zod schema 保持一致。
- [ ] 六个既有 migration 文件的 SHA-256 与规划基线一致，且没有 `0007` 或其他新增 migration。
- [ ] 生产命令注册只有一个权威装配入口，mock IPC 测试验证的是该生产入口，并覆盖全部命令。
- [ ] 新增 characterization tests 覆盖生成事件顺序/失败阶段/单次持久化，以及自动标题开关、模型回退、写库与事件发射。
- [ ] Rust fmt、Clippy、全量 Rust 测试、`pnpm check` 与 debug no-bundle Tauri build 全部通过。
- [ ] 相关 Trellis spec 已更新，且最终源码中不存在只为迁移保留的旧 generation/title/settings 实现副本。

## Out of Scope

- 修改任何前端产品行为、IPC 命名/字段、错误文案或事件协议。
- 新增或改写数据库迁移、修复 provider/model 残留值、改变导出命令的数据库前置行为。
- 新服务商协议、新设置项、新生成能力、ORM、依赖注入框架、workspace/多 crate 拆分。
- 把 search 从 conversation 域独立成顶层模块，或为两个协议引入动态 plugin/trait 架构。

## Planning Decision

- 2026-08-27：用户批准严格行为保持范围；任何需要改变本 PRD 兼容约束的发现都必须停止实施并返回规划阶段。

