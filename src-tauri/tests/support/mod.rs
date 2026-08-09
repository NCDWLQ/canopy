use std::str::FromStr;

use canopy_lib::database::MIGRATION_CATALOG;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

pub fn run_async(test: impl std::future::Future<Output = ()>) {
    tauri::async_runtime::block_on(test);
}

pub async fn migrated_pool() -> SqlitePool {
    migrated_pool_through(i64::MAX).await
}

pub async fn migrated_pool_through(version: i64) -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("in-memory SQLite URL is valid")
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("test database connects");

    for migration in MIGRATION_CATALOG
        .iter()
        .filter(|migration| migration.version <= version)
    {
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("migration {} failed: {error}", migration.version));
    }

    pool
}
