# v0.4.0 已发布数据库升级夹具：技术设计

## 1. Production-Owned Plugin Registration

把 SQL plugin 装配收敛为 `infra::database` 的一个泛型 builder 装配函数。生产 `app_builder` 与升级测试调用同一个函数；函数内部继续使用 `DATABASE_URL` 和 `plugin_migrations()`，避免测试复制注册逻辑后再次漂移。

该抽取不改变 preload、migration 目录或运行时行为。

## 2. Fixture

新增 `src-tauri/tests/fixtures/canopy-v0.4.0.db` 及 provenance README：

- schema 和 SQLx ledger 固定在 v0.4.0 的 `0001`–`0006`；
- 包含一棵合法 conversation tree、一个 provider、代表性 app settings 和 credential reference 占位符；
- 包含一个由 v0.4.0 行为产生的 `provider_id = NULL, model != NULL` conversation，供后续 `0007` 回归使用；本任务只记录该基线，不清理它；
- 不包含 API key、真实内容或主机路径。

测试总是先把 fixture 复制到唯一临时 app-config 目录，版本库内文件只读。

## 3. Lifecycle Test

独立 integration test binary 执行：

1. 构造唯一合法 Tauri identifier。
2. 用无 SQL plugin 的 probe app 获取该 identifier 的 app-config 路径。
3. 创建唯一目录并复制 fixture 为 `canopy.db`。
4. 构造带 `plugins.sql.preload = ["sqlite:canopy.db"]` 的 mock context。
5. 使用生产数据库 plugin 装配函数 build app；plugin setup 自动执行当前 `MIGRATION_CATALOG`。
6. 从 managed `DbInstances` 取得 pool，验证 ledger、schema、数据、`foreign_key_check` 和 tree triggers。
7. 关闭 pool、drop app，再对同一文件重复 build，验证幂等。
8. 关闭全部 handle 后删除唯一测试目录。

## 4. Compatibility and Failure Shape

- 当当前目录仍是 1–6 时，升级是 no-op，但必须证明 released ledger 与当前 migration checksum 兼容。
- 后续加入 0007 时，该测试自动从同一 fixture 执行增量升级。
- migration checksum 不匹配、ledger 异常、数据漂移或 plugin setup 失败都直接使测试失败。

## 5. Rollback

本任务只增加测试资产并抽取等价 plugin 装配函数。回滚删除 harness/fixture 并内联回原注册表达式，不触碰用户数据库。
