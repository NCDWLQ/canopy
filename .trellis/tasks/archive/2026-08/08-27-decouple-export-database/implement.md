# 移除导出的数据库前置依赖：执行计划

- [x] 先更新 mock production registry 回归，使合法导出在空 `DbInstances` 下预期成功并使用唯一临时文件。
- [x] 从 `exports::commands::write_export_file` 删除 `DbInstances` 参数和 `managed_sqlite_pool` 前置调用。
- [x] 保持 `exports::service` 的空值、16 MiB 与 IO 错误测试不变。
- [x] 确认 command name、请求/响应 fixture 和前端 schema 无变化。
- [x] 更新 backend index、directory structure、app capabilities 及相关质量/错误说明，删除 exports → infra 依赖。
- [x] 运行 Rust fmt、Clippy、全量测试、`pnpm check` 与 debug no-bundle Tauri build。

## Rollback

该任务无 migration。回滚恢复 command 的 managed DB 参数/前置调用以及相应测试/spec 即可。
