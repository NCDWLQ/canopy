# v0.4.0 已发布数据库升级夹具

## Goal

建立可重复、无凭据的 v0.4.0 已发布数据库 fixture，并通过与生产一致的 migration 目录和 Tauri SQL 插件生命周期验证前向升级，为 `0007+` migration 提供发布级回归门。

## Background

- `v0.4.0` tag（`cc8cc83`）包含 `0001`–`0006`，因此当前项目已经有必须兼容的已发布 schema。
- `src-tauri/tests/support/mod.rs` 当前把 `MIGRATION_CATALOG` 直接以 `sqlx::raw_sql` 应用到全新内存数据库。
- `src-tauri/src/lib.rs` 的 mock IPC 使用空 `DbInstances`，`application_builder_is_constructible` 只证明 builder 可构造；两者都没有验证已发布数据库文件经 SQL plugin 启动、登记和升级的生命周期。

## Requirements

- R1. fixture 必须由 v0.4.0 schema 生成并记录来源/校验方式，包含足以验证 conversation、node、provider、app_settings、外键和 trigger 的代表性非敏感数据。
- R2. 测试必须复制 fixture 到临时目录后运行，绝不原地修改版本化 fixture。
- R3. 升级路径必须复用生产 `DATABASE_URL`、`plugin_migrations()` 与 Tauri SQL plugin 注册方式；仅重复执行 `sqlx::raw_sql` 不满足本任务。
- R4. 测试必须验证 migration ledger、schema 版本、代表性数据、外键与 trigger 行为，并证明应用重启/重复启动不会重复破坏数据。
- R5. fixture 不得包含 API key、keyring secret、用户内容或机器专属路径；必要的 credential reference 使用明显的测试占位值。
- R6. 本任务只建立升级安全网，不新增 `0007`，不改变现有 migration SQL 或产品行为。

## Acceptance Criteria

- [ ] 存在有来源说明和稳定校验值的 v0.4.0 数据库 fixture。
- [ ] 自动化测试通过生产 SQL plugin/migration 注册路径把 fixture 升级到当前目录版本。
- [ ] 升级后 migration ledger 无缺失/重复，代表性数据逐项保持，`PRAGMA foreign_key_check` 无结果，关键 trigger 仍拒绝非法树变更。
- [ ] 对同一临时数据库再次启动升级流程保持幂等，数据和 ledger 不发生额外变化。
- [ ] 现有 fresh-database migration、tree persistence、provider migration 和 command registry 测试保持通过。

## Out of Scope

- 新增或设计 `0007` migration。
- 清理 provider/model 残值。
- 打包安装器、降级、down migration 或跨未来版本矩阵。

## Dependency

- 本任务必须在 `08-27-cleanup-stale-provider-binding` 开始实现前完成并归档。
