use sqlx::SqlitePool;
use tauri::{Builder, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};
use thiserror::Error;

pub const DATABASE_URL: &str = "sqlite:canopy.db";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("the managed application database is unavailable")]
pub enum DatabaseError {
    Unavailable,
}

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
        sql: include_str!("../../migrations/0001_bootstrap.sql"),
    },
    ApplicationMigration {
        version: 2,
        description: "conversation_tree",
        sql: include_str!("../../migrations/0002_conversation_tree.sql"),
    },
    ApplicationMigration {
        version: 3,
        description: "conversation_archive",
        sql: include_str!("../../migrations/0003_conversation_archive.sql"),
    },
    ApplicationMigration {
        version: 4,
        description: "provider_profile",
        sql: include_str!("../../migrations/0004_provider_profile.sql"),
    },
    ApplicationMigration {
        version: 5,
        description: "multi_provider",
        sql: include_str!("../../migrations/0005_multi_provider.sql"),
    },
    ApplicationMigration {
        version: 6,
        description: "provider_models",
        sql: include_str!("../../migrations/0006_provider_models.sql"),
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

/// Registers the production Tauri SQL plugin with [`DATABASE_URL`] and
/// [`plugin_migrations`]. Production `app_builder` and released-database
/// upgrade tests must share this wiring so registration cannot drift.
pub fn register_sql_plugin<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.plugin(
        tauri_plugin_sql::Builder::default()
            .add_migrations(DATABASE_URL, plugin_migrations())
            .build(),
    )
}

pub async fn managed_sqlite_pool(instances: &DbInstances) -> Result<SqlitePool, DatabaseError> {
    let instances = instances.0.read().await;
    match instances.get(DATABASE_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(DatabaseError::Unavailable),
    }
}
