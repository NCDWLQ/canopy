# v0.4.0 已发布数据库升级夹具：执行计划

## Phase 1 — Freeze v0.4.0 Fixture

- [x] 记录 v0.4.0 tag/commit 与 `0001`–`0006` checksum。
- [x] 通过 SQL plugin/Migrator 生成带 ledger 的 v0.4.0 SQLite fixture，并写入非敏感代表性数据。
- [x] 添加 provenance README、fixture SHA-256 和内容清单。
- [x] 用只读查询确认 fixture 无 secret/真实用户内容且 `foreign_key_check` 为空。

## Phase 2 — Share Production Plugin Wiring

- [x] 在 `infra::database` 抽取 builder 装配函数，保持 `DATABASE_URL`、preload 和 `plugin_migrations()` 不变。
- [x] 让生产 `app_builder` 复用该函数。
- [x] 保持现有 builder/command registry 测试通过。

## Phase 3 — Released Upgrade Harness

- [x] 新增独立 integration test，创建唯一 identifier/app-config 目录并复制 fixture。
- [x] 通过真实 SQL plugin setup 运行当前 migration 目录。
- [x] 验证 SQLx ledger、代表性数据、外键、tree triggers 和 known-v0.4 stale binding baseline。
- [x] 关闭并重启同一临时数据库，验证幂等。
- [x] 失败/成功路径均只清理本测试创建的唯一目录。

## Validation

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --test released_database_upgrade
cargo test --manifest-path src-tauri/Cargo.toml --test tree_persistence
cargo test --manifest-path src-tauri/Cargo.toml --test multi_provider_migration
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

## Review Hotspots

- 测试是否真的经过 plugin setup/preload，而非又一条 `raw_sql` 捷径。
- fixture ledger/checksum 是否来自 v0.4.0。
- 测试路径是否唯一、可清理且绝不指向真实 Canopy 配置目录。
- app/pool handle 是否在清理目录前完全关闭。
