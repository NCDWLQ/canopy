# provider 删除后的会话绑定残值：执行计划

## Preconditions

- [x] `08-27-released-db-upgrade-harness` 已完成、提交并归档。
- [x] v0.4.0 fixture 含可验证的 stale provider/model conversation。

## Phase 1 — Characterize and Add Migration

- [x] 先增加失败回归：released fixture cleanup、直接 provider 删除、service 两条删除路径与 effort 保留。
- [x] 新增版本 7 migration，清理既有残值并创建 provider-delete trigger。
- [x] 注册 migration 7，更新 migration 版本/名称断言；确认 1–6 checksum 不变。

## Phase 2 — Cross-Layer Verification

- [x] 运行 released upgrade harness，确认 stale row 只清理 model。
- [x] 运行 provider profile/reconcile tests，确认 active/title/keyring 行为无漂移。
- [x] 运行 generation binding、conversation DTO 与 migration tests。
- [x] 更新 database/provider/quality spec，记录 provider 删除不变量和版本 7。

## Validation

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --test released_database_upgrade
cargo test --manifest-path src-tauri/Cargo.toml --test multi_provider_migration
cargo test --manifest-path src-tauri/Cargo.toml --test provider_profile
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm check
pnpm tauri build --debug --no-bundle
```

## Review Hotspots

- migration 是否真的覆盖未来删除，而非只清理一次。
- trigger 与 immediate credential-operation FK 的删除顺序。
- `reasoning_effort`、active provider、title binding 与 keyring reconcile 是否保持。
- released fixture upgrade 与 fresh database 两条路径是否都通过。
