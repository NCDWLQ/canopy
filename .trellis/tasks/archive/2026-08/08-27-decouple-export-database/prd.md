# 移除导出的数据库前置依赖

## Goal

让 `write_export_file` 只依赖请求校验和文件系统：即使 managed SQLite pool 不存在或不可用，只要路径与内容合法且文件系统允许，导出仍成功。

## Background

- `src-tauri/src/exports/commands.rs` 当前在写文件前调用 `managed_sqlite_pool`，但导出内容已由前端组装，service 不执行 SQL。
- 该前置检查是后端边界重构为保持旧可观察错误而冻结的兼容行为；本任务明确批准改变这一点，同时保持其余 IPC 与文件错误合同。

## Requirements

- R1. `write_export_file` command 不再接收或解析 `DbInstances`，`exports` 模块不再依赖 `infra::database`。
- R2. 命令名、`{ request: { path, content } }` 包装、snake_case 响应和 `bytes_written` 语义保持不变。
- R3. 空路径、空内容、16 MiB 上限和文件系统写入失败的现有 `CommandError` 映射保持不变。
- R4. mock production command registry 必须证明在没有 managed database 的应用中，合法导出能到达文件写入并成功返回，而不是 `database_unavailable`。
- R5. 更新 backend capability/directory/error/quality 文档，删除“导出需要 DB preflight”的过时契约和依赖箭头。
- R6. 不修改前端导出 UX、Markdown 格式、保存对话框权限或其他 command。

## Acceptance Criteria

- [ ] 没有 managed SQLite pool 时，合法临时路径与内容通过真实 command registry 成功写出并返回正确字节数。
- [ ] 数据库可用与否不影响导出结果；文件验证及 IO 错误合同与修改前一致。
- [ ] `src-tauri/src/exports` 不再导入 `DbInstances`、`managed_sqlite_pool` 或其他数据库能力。
- [ ] 生产注册仍只有一个权威入口，冻结 command 名称和前端 schema/fixture 保持兼容。
- [ ] Rust fmt、Clippy、全量测试、`pnpm check` 与 debug no-bundle Tauri build 通过。

## Out of Scope

- 修改导出 Markdown 内容、文件名、对话框或前端交互。
- JSON、剪贴板或其他新导出格式。
- 数据库、migration 或 provider 行为变更。

## Planning Status

- 该子任务范围单一、无 schema 设计，可按 PRD-only 轻量任务执行；仍需在 `task.py start` 前进行最终规划确认。
