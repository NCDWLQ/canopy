mod support;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use canopy_lib::providers::{
    ApiKeyAction, CredentialStore, ProviderError, ProviderProfileInput, ProviderProfileService,
};
use secrecy::{ExposeSecret, SecretString};

use support::{migrated_pool, run_async};

#[derive(Debug, Default)]
struct FakeCredentialStore {
    secrets: Mutex<HashMap<String, String>>,
    unavailable: Mutex<bool>,
}

impl FakeCredentialStore {
    fn set_unavailable(&self, unavailable: bool) {
        *self.unavailable.lock().unwrap() = unavailable;
    }

    fn snapshot(&self) -> HashMap<String, String> {
        self.secrets.lock().unwrap().clone()
    }

    fn remove_direct(&self, credential_ref: &str) {
        self.secrets.lock().unwrap().remove(credential_ref);
    }

    fn check_available(&self) -> Result<(), ProviderError> {
        if *self.unavailable.lock().unwrap() {
            Err(ProviderError::CredentialUnavailable)
        } else {
            Ok(())
        }
    }
}

impl CredentialStore for FakeCredentialStore {
    fn set(&self, credential_ref: &str, secret: &SecretString) -> Result<(), ProviderError> {
        self.check_available()?;
        self.secrets
            .lock()
            .unwrap()
            .insert(credential_ref.to_owned(), secret.expose_secret().to_owned());
        Ok(())
    }

    fn get(&self, credential_ref: &str) -> Result<Option<SecretString>, ProviderError> {
        self.check_available()?;
        Ok(self
            .secrets
            .lock()
            .unwrap()
            .get(credential_ref)
            .cloned()
            .map(SecretString::from))
    }

    fn delete(&self, credential_ref: &str) -> Result<(), ProviderError> {
        self.check_available()?;
        self.secrets.lock().unwrap().remove(credential_ref);
        Ok(())
    }
}

fn input(action: ApiKeyAction) -> ProviderProfileInput {
    ProviderProfileInput {
        base_endpoint: "https://provider.example/v1".to_owned(),
        model: "fixture-model".to_owned(),
        api_key: action,
    }
}

#[test]
fn profile_round_trip_keeps_secrets_only_in_injected_store() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderProfileService::new(pool.clone(), store.clone());
        let sentinel = "SENTINEL_NATIVE_SECRET";

        let saved = service
            .save(
                input(ApiKeyAction::Replace(SecretString::from(sentinel))),
                "operation-replace".to_owned(),
                "credential-new".to_owned(),
                100,
            )
            .await
            .expect("profile saves");
        assert!(saved.has_api_key);
        assert_eq!(store.snapshot().get("credential-new").unwrap(), sentinel);

        let database_text: String = sqlx::query_scalar(
            "SELECT coalesce(group_concat(value, '|'), '') FROM ( \
               SELECT base_endpoint AS value FROM provider_profiles \
               UNION ALL SELECT model FROM provider_profiles \
               UNION ALL SELECT coalesce(credential_ref, '') FROM provider_profiles \
               UNION ALL SELECT coalesce(base_endpoint, '') FROM provider_credential_operations \
               UNION ALL SELECT coalesce(model, '') FROM provider_credential_operations \
               UNION ALL SELECT coalesce(new_credential_ref, '') FROM provider_credential_operations \
             )",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!database_text.contains(sentinel));

        let reconstructed = ProviderProfileService::new(pool.clone(), store.clone());
        assert!(reconstructed.load().await.unwrap().has_api_key);
        reconstructed
            .save(
                ProviderProfileInput {
                    model: "fixture-model-2".to_owned(),
                    ..input(ApiKeyAction::Keep)
                },
                "unused-operation".to_owned(),
                "unused-credential".to_owned(),
                101,
            )
            .await
            .unwrap();
        assert_eq!(store.snapshot().len(), 1);

        let removed = reconstructed
            .save(
                input(ApiKeyAction::Remove),
                "operation-remove".to_owned(),
                "unused-remove".to_owned(),
                102,
            )
            .await
            .unwrap();
        assert!(!removed.has_api_key);
        assert!(store.snapshot().is_empty());
        assert!(reconstructed
            .delete("operation-delete".to_owned())
            .await
            .unwrap());
        assert!(!reconstructed
            .delete("operation-delete-again".to_owned())
            .await
            .unwrap());
    });
}

#[test]
fn recovery_discards_unwritten_replace_and_locked_store_fails_closed() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderProfileService::new(pool.clone(), store.clone());
        service
            .save(
                input(ApiKeyAction::Keep),
                "initial".to_owned(),
                "unused".to_owned(),
                1,
            )
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, operation, base_endpoint, model, new_credential_ref, old_credential_ref, updated_at) \
             VALUES ('interrupted', 'save', 'https://other.example/v1', 'other-model', \
                     'never-written', NULL, 2)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let recovered = service.load().await.unwrap();
        assert_eq!(recovered.model, "fixture-model");
        let operation_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM provider_credential_operations")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(operation_count, 0);

        service
            .save(
                input(ApiKeyAction::Replace(SecretString::from("secret"))),
                "replace".to_owned(),
                "credential".to_owned(),
                3,
            )
            .await
            .unwrap();
        store.set_unavailable(true);
        assert!(matches!(
            service.load().await,
            Err(ProviderError::CredentialUnavailable)
        ));

        let unavailable_keep = service
            .save(
                ProviderProfileInput {
                    model: "must-not-commit".to_owned(),
                    ..input(ApiKeyAction::Keep)
                },
                "keep-unavailable".to_owned(),
                "unused".to_owned(),
                4,
            )
            .await;
        assert!(matches!(
            unavailable_keep,
            Err(ProviderError::CredentialUnavailable)
        ));
        let stored_model: String =
            sqlx::query_scalar("SELECT model FROM provider_profiles WHERE id = 'default'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_model, "fixture-model");

        store.set_unavailable(false);
        store.remove_direct("credential");
        let missing_keep = service
            .save(
                ProviderProfileInput {
                    model: "also-must-not-commit".to_owned(),
                    ..input(ApiKeyAction::Keep)
                },
                "keep-missing".to_owned(),
                "unused".to_owned(),
                5,
            )
            .await;
        assert!(matches!(
            missing_keep,
            Err(ProviderError::CredentialMissing)
        ));
        let stored_model: String =
            sqlx::query_scalar("SELECT model FROM provider_profiles WHERE id = 'default'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_model, "fixture-model");
    });
}

#[test]
fn recovery_replays_written_save_cleanup_and_delete_boundaries() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderProfileService::new(pool.clone(), store.clone());
        service
            .save(
                input(ApiKeyAction::Replace(SecretString::from("old-secret"))),
                "initial".to_owned(),
                "credential-old".to_owned(),
                1,
            )
            .await
            .unwrap();

        store
            .set(
                "credential-new",
                &SecretString::from("new-secret".to_owned()),
            )
            .unwrap();
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, operation, base_endpoint, model, new_credential_ref, old_credential_ref, updated_at) \
             VALUES ('written-save', 'save', 'https://new.example/v1', 'new-model', \
                     'credential-new', 'credential-old', 2)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let recovered = service.load().await.unwrap();
        assert_eq!(recovered.base_endpoint, "https://new.example/v1");
        assert_eq!(recovered.model, "new-model");
        assert_eq!(
            store.snapshot(),
            HashMap::from([("credential-new".to_owned(), "new-secret".to_owned())])
        );

        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, operation, old_credential_ref) \
             VALUES ('interrupted-delete', 'delete', 'credential-new')",
        )
        .execute(&pool)
        .await
        .unwrap();
        service.reconcile().await.unwrap();
        assert!(store.snapshot().is_empty());
        let profile_count: i64 = sqlx::query_scalar("SELECT count(*) FROM provider_profiles")
            .fetch_one(&pool)
            .await
            .unwrap();
        let operation_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM provider_credential_operations")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((profile_count, operation_count), (0, 0));
    });
}

#[test]
fn concurrent_profile_replacements_are_serialized_without_orphaned_credentials() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let first = ProviderProfileService::new(pool.clone(), store.clone());
        let second = ProviderProfileService::new(pool.clone(), store.clone());
        let first_save = first.save(
            ProviderProfileInput {
                model: "model-first".to_owned(),
                ..input(ApiKeyAction::Replace(SecretString::from("value-first")))
            },
            "operation-first".to_owned(),
            "credential-first".to_owned(),
            1,
        );
        let second_save = second.save(
            ProviderProfileInput {
                model: "model-second".to_owned(),
                ..input(ApiKeyAction::Replace(SecretString::from("value-second")))
            },
            "operation-second".to_owned(),
            "credential-second".to_owned(),
            2,
        );
        let (first_result, second_result) =
            futures_util::future::join(first_save, second_save).await;
        first_result.unwrap();
        second_result.unwrap();

        let profile = first.load().await.unwrap();
        assert!(matches!(
            profile.model.as_str(),
            "model-first" | "model-second"
        ));
        assert_eq!(store.snapshot().len(), 1);
        let operation_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM provider_credential_operations")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(operation_count, 0);
    });
}

#[test]
fn migration_is_additive_and_contains_no_secret_column() {
    run_async(async {
        let pool = migrated_pool().await;
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(tables.contains(&"conversations".to_owned()));
        assert!(tables.contains(&"nodes".to_owned()));
        assert!(tables.contains(&"provider_profiles".to_owned()));
        assert!(tables.contains(&"provider_credential_operations".to_owned()));

        let columns: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('provider_profiles') ORDER BY cid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            columns,
            [
                "id",
                "base_endpoint",
                "model",
                "credential_ref",
                "updated_at"
            ]
        );
        assert!(columns
            .iter()
            .all(|column| !column.contains("key") && !column.contains("secret")));
    });
}
