use sqlx::SqlitePool;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

use crate::conversations::PersistenceError;

pub const DATABASE_URL: &str = "sqlite:canopy.db";

#[derive(Debug, Clone, Copy)]
pub struct ApplicationMigration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

pub const MIGRATION_CATALOG: &[ApplicationMigration] = &[
    ApplicationMigration {
        version: 1,
        description: "bootstrap",
        sql: include_str!("../migrations/0001_bootstrap.sql"),
    },
    ApplicationMigration {
        version: 2,
        description: "conversation_tree",
        sql: include_str!("../migrations/0002_conversation_tree.sql"),
    },
];

pub fn plugin_migrations() -> Vec<Migration> {
    MIGRATION_CATALOG
        .iter()
        .map(|migration| Migration {
            version: migration.version,
            description: migration.description,
            sql: migration.sql,
            kind: MigrationKind::Up,
        })
        .collect()
}

pub async fn managed_sqlite_pool(instances: &DbInstances) -> Result<SqlitePool, PersistenceError> {
    let instances = instances.0.read().await;
    match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(PersistenceError::DatabaseUnavailable),
    }
}
