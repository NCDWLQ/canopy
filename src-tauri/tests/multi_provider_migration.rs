mod support;

use canopy_lib::infra::database::MIGRATION_CATALOG;

use support::{migrated_pool, migrated_pool_through, run_async};

async fn apply_multi_provider_migration(pool: &sqlx::SqlitePool) {
    let migration = MIGRATION_CATALOG
        .iter()
        .find(|migration| migration.version == 5)
        .expect("multi-provider migration is registered");
    sqlx::raw_sql(migration.sql)
        .execute(pool)
        .await
        .expect("multi-provider migration applies");
}

async fn seed_conversation(pool: &sqlx::SqlitePool) {
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO conversations (id, title, root_node_id) \
         VALUES ('conversation-a', 'Migration', 'root-a')",
    )
    .execute(&mut *transaction)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO nodes (id, parent_id, conversation_id, role, content, created_at) \
         VALUES ('root-a', NULL, 'conversation-a', 'user', 'seed', 1)",
    )
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
}

async fn conversation_columns(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM pragma_table_info('conversations') ORDER BY cid")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[test]
fn migration_moves_the_default_profile_pending_operations_and_adds_binding_columns() {
    run_async(async {
        let pool = migrated_pool_through(4).await;
        sqlx::query(
            "INSERT INTO provider_profiles (id, base_endpoint, model, credential_ref, updated_at) \
             VALUES ('default', 'https://provider.example/v1', 'fixture-model', 'credential-a', 41)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, operation, base_endpoint, model, new_credential_ref, old_credential_ref, updated_at) \
             VALUES ('pending-save', 'save', 'https://other.example/v1', 'other-model', \
                     'credential-b', 'credential-a', 42)",
        )
        .execute(&pool)
        .await
        .unwrap();
        seed_conversation(&pool).await;

        apply_multi_provider_migration(&pool).await;

        let legacy_tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' \
               AND name IN ('provider_profiles', 'provider_credential_operations_v2')",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(legacy_tables.is_empty());

        let migrated: (String, String, String, String, Option<String>, i64, i64) = sqlx::query_as(
            "SELECT id, name, protocol, base_endpoint, credential_ref, created_at, updated_at \
             FROM providers",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            migrated,
            (
                "default".to_owned(),
                "默认".to_owned(),
                "openai_compatible".to_owned(),
                "https://provider.example/v1".to_owned(),
                Some("credential-a".to_owned()),
                41,
                41
            )
        );
        let migrated_model: String = sqlx::query_scalar("SELECT model FROM providers")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(migrated_model, "fixture-model");

        let operation: (String, String, String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT id, provider_id, operation, new_credential_ref, old_credential_ref \
             FROM provider_credential_operations",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            operation,
            (
                "pending-save".to_owned(),
                "default".to_owned(),
                "save".to_owned(),
                Some("credential-b".to_owned()),
                Some("credential-a".to_owned())
            )
        );

        let active: Option<(String, String)> =
            sqlx::query_as("SELECT key, value FROM app_settings")
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(
            active,
            Some(("active_provider_id".to_owned(), "default".to_owned()))
        );

        let columns = conversation_columns(&pool).await;
        for column in ["provider_id", "model", "reasoning_effort"] {
            assert!(columns.contains(&column.to_owned()), "missing {column}");
        }
        let binding: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT provider_id, model, reasoning_effort FROM conversations \
             WHERE id = 'conversation-a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(binding, (None, None, None));

        sqlx::query(
            "UPDATE conversations SET provider_id = 'default', model = 'fixture-model', \
             reasoning_effort = 'low' WHERE id = 'conversation-a'",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE conversations SET reasoning_effort = 'bogus' WHERE id = 'conversation-a'",
        )
        .execute(&pool)
        .await
        .unwrap_err();

        // A pending credential operation keeps the provider row referenced;
        // deleting it would orphan the replayable intent.
        sqlx::query("DELETE FROM providers WHERE id = 'default'")
            .execute(&pool)
            .await
            .unwrap_err();
        sqlx::query("DELETE FROM provider_credential_operations WHERE id = 'pending-save'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM providers WHERE id = 'default'")
            .execute(&pool)
            .await
            .unwrap();
        let unbound: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT provider_id, model, reasoning_effort FROM conversations \
             WHERE id = 'conversation-a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            unbound,
            (
                None,
                Some("fixture-model".to_owned()),
                Some("low".to_owned())
            )
        );
    });
}

#[test]
fn migrating_an_empty_provider_schema_creates_no_active_setting() {
    run_async(async {
        // A fresh database runs the whole catalog, including migration 5 over
        // an empty `provider_profiles` table.
        let pool = migrated_pool().await;
        let columns = conversation_columns(&pool).await;
        for column in ["provider_id", "model", "reasoning_effort"] {
            assert!(columns.contains(&column.to_owned()), "missing {column}");
        }

        let providers: i64 = sqlx::query_scalar("SELECT count(*) FROM providers")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(providers, 0);
        let settings: i64 = sqlx::query_scalar("SELECT count(*) FROM app_settings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(settings, 0);
    });
}

#[test]
fn migration_preserves_a_first_save_recovery_operation_without_a_profile_row() {
    run_async(async {
        let pool = migrated_pool_through(4).await;

        // The legacy service wrote a replace intent before it touched the
        // keyring or created the singleton profile. An interruption at this
        // boundary is recoverable and must not make the upgrade fail its new
        // provider foreign key.
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, operation, base_endpoint, model, new_credential_ref, old_credential_ref, updated_at) \
             VALUES ('first-save', 'save', 'https://provider.example/v1', 'fixture-model', \
                     'credential-a', NULL, 41)",
        )
        .execute(&pool)
        .await
        .unwrap();

        apply_multi_provider_migration(&pool).await;

        let provider: (String, String, String, String, Option<String>, i64, i64) = sqlx::query_as(
            "SELECT id, name, protocol, base_endpoint, credential_ref, created_at, updated_at \
             FROM providers",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            provider,
            (
                "default".to_owned(),
                "默认".to_owned(),
                "openai_compatible".to_owned(),
                "https://provider.example/v1".to_owned(),
                None,
                41,
                41,
            )
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT model FROM providers")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "fixture-model"
        );
        assert_eq!(
            sqlx::query_as::<_, (String, String)>(
                "SELECT provider_id, new_credential_ref FROM provider_credential_operations",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("default".to_owned(), "credential-a".to_owned())
        );
        assert_eq!(
            sqlx::query_as::<_, (String, String)>("SELECT key, value FROM app_settings")
                .fetch_one(&pool)
                .await
                .unwrap(),
            ("active_provider_id".to_owned(), "default".to_owned())
        );
    });
}

#[test]
fn provider_models_migration_backfills_each_default_model() {
    run_async(async {
        // Seed through migration 5 (pre-models schema), then apply 0006 on
        // top so the backfill is observable in isolation.
        let pool = migrated_pool_through(5).await;
        sqlx::query(
            "INSERT INTO providers (id, name, protocol, base_endpoint, model, credential_ref, \
                    created_at, updated_at) \
             VALUES ('p1', 'One', 'openai_compatible', 'https://one.example/v1', 'one-model', NULL, 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let migration = MIGRATION_CATALOG
            .iter()
            .find(|migration| migration.version == 6)
            .expect("provider-models migration is registered");
        sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();

        let (models,): (String,) = sqlx::query_as("SELECT models FROM providers WHERE id = 'p1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(models, r#"["one-model"]"#);
    });
}
