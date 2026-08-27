# Tauri SQL Plugin Upgrade Harness Research

## Current Coverage

- `src-tauri/tests/support/mod.rs:238-262` creates a fresh in-memory SQLite pool and applies `MIGRATION_CATALOG` with `sqlx::raw_sql`; it does not create or verify the plugin migration ledger.
- `src-tauri/src/lib.rs:96-108` builds mock command tests with an empty managed `DbInstances`; it proves handler registration, not SQL plugin startup.
- `src-tauri/src/lib.rs:131-133` only constructs the production builder.
- `src-tauri/tauri.conf.json:29-32` preloads `sqlite:canopy.db` in production.

## Plugin 2.4.0 Behavior

Local dependency source `tauri-plugin-sql-2.4.0/src/lib.rs` confirms that plugin setup:

1. reads the `sql.preload` configuration;
2. maps the SQLite URL into `app.path().app_config_dir()`;
3. opens/creates the database;
4. constructs `sqlx::Migrator` from the registered migration list;
5. runs migrations and records the sqlx ledger;
6. manages the resulting `DbInstances`.

Therefore a direct `raw_sql` loop is not an adequate released-database lifecycle test.

## Recommended Harness

- Commit a binary v0.4.0 fixture containing the SQLx migration ledger for versions 1–6 and representative non-sensitive rows.
- In an isolated integration test, create a unique mock Tauri identifier, resolve its app-config directory using a probe app, copy the fixture to `canopy.db`, then build a second mock app with the production SQL plugin registration and preload config.
- Query the plugin-managed pool after setup, close it, rebuild once against the same temporary database, and verify idempotence.
- Clean only the unique test identifier directory after all app/pool handles are dropped.

## Fixture Provenance

The fixture README must record tag `v0.4.0`, commit `cc8cc83`, migration versions/checksums, seed manifest and fixture SHA-256. It must contain no secrets or real user content.
