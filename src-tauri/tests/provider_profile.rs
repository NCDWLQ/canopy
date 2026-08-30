mod support;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use canopy_lib::conversations::{
    dto::{ConversationDto, ReasoningEffortDto},
    ConversationPersistenceService, NewConversation, NewNode, Role,
};
use canopy_lib::llm::Protocol;
use canopy_lib::providers::{
    ApiKeyAction, CredentialStore, ProviderError, ProviderInput, ProviderService, RedactedProvider,
};
use canopy_lib::settings::{
    LanguagePreference, SettingsError, SettingsService, ThemePreference, TitleModelBinding,
};
use secrecy::{ExposeSecret, SecretString};
use serde_json::json;

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

fn input(name: &str, action: ApiKeyAction) -> ProviderInput {
    ProviderInput {
        name: name.to_owned(),
        protocol: Protocol::OpenAiCompatible,
        base_endpoint: "https://provider.example/v1".to_owned(),
        model: "fixture-model".to_owned(),
        models: vec!["fixture-model".to_owned()],
        api_key: action,
    }
}

fn assert_duplicate_name(result: Result<RedactedProvider, ProviderError>) {
    assert!(matches!(
        result,
        Err(ProviderError::InvalidInput {
            field: "name",
            reason: "duplicate",
        })
    ));
}

#[test]
fn language_preference_settings_round_trip_through_the_settings_kv() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = SettingsService::new(pool.clone());

        // A missing key means "system": the UI follows the OS locale.
        assert_eq!(
            service.get_language().await.unwrap(),
            LanguagePreference::System
        );

        // Every stored preference round-trips through the settings kv.
        assert_eq!(
            service
                .set_language(LanguagePreference::ZhCn)
                .await
                .unwrap(),
            LanguagePreference::ZhCn
        );
        assert_eq!(
            service.get_language().await.unwrap(),
            LanguagePreference::ZhCn
        );
        let stored: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'language'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored.as_deref(), Some("zh-CN"));
        assert_eq!(
            service.set_language(LanguagePreference::En).await.unwrap(),
            LanguagePreference::En
        );
        assert_eq!(
            service
                .set_language(LanguagePreference::System)
                .await
                .unwrap(),
            LanguagePreference::System
        );
        assert_eq!(
            service.get_language().await.unwrap(),
            LanguagePreference::System
        );

        // Dirty stored values fail closed instead of silently resetting.
        sqlx::query("UPDATE app_settings SET value = 'klingon' WHERE key = 'language'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            service.get_language().await,
            Err(SettingsError::CorruptValue)
        ));
    });
}

#[test]
fn theme_preference_settings_round_trip_through_the_settings_kv() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = SettingsService::new(pool.clone());

        // A missing key means "system": the UI follows the OS color scheme.
        assert_eq!(service.get_theme().await.unwrap(), ThemePreference::System);

        // Every stored preference round-trips through the settings kv.
        assert_eq!(
            service.set_theme(ThemePreference::Dark).await.unwrap(),
            ThemePreference::Dark
        );
        assert_eq!(service.get_theme().await.unwrap(), ThemePreference::Dark);
        let stored: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'theme'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored.as_deref(), Some("dark"));
        assert_eq!(
            service.set_theme(ThemePreference::Light).await.unwrap(),
            ThemePreference::Light
        );
        assert_eq!(
            service.set_theme(ThemePreference::System).await.unwrap(),
            ThemePreference::System
        );
        assert_eq!(service.get_theme().await.unwrap(), ThemePreference::System);

        // Dirty stored values fail closed instead of silently resetting.
        sqlx::query("UPDATE app_settings SET value = 'solarized' WHERE key = 'theme'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            service.get_theme().await,
            Err(SettingsError::CorruptValue)
        ));
    });
}

#[test]
fn automatic_title_settings_default_and_validate_model_bindings() {
    run_async(async {
        let pool = migrated_pool().await;
        let settings = SettingsService::new(pool.clone());
        let service = ProviderService::new(pool, Arc::new(FakeCredentialStore::default()));

        assert!(settings.get_auto_generate_title().await.unwrap());
        assert_eq!(settings.get_title_model_binding().await.unwrap(), None);
        assert!(!settings.set_auto_generate_title(false).await.unwrap());
        assert!(!settings.get_auto_generate_title().await.unwrap());

        service
            .save(
                "provider-title",
                input("Title provider", ApiKeyAction::Keep),
                "operation-title".to_owned(),
                "credential-title".to_owned(),
                100,
            )
            .await
            .unwrap();
        let binding = TitleModelBinding {
            provider_id: "provider-title".to_owned(),
            model: "fixture-model".to_owned(),
        };
        assert_eq!(
            service
                .set_title_model_binding(Some(binding.clone()))
                .await
                .unwrap(),
            Some(binding.clone())
        );
        assert_eq!(
            settings.get_title_model_binding().await.unwrap(),
            Some(binding)
        );
        assert!(service
            .set_title_model_binding(Some(TitleModelBinding {
                provider_id: "provider-title".to_owned(),
                model: "missing-model".to_owned(),
            }))
            .await
            .is_err());

        service
            .save(
                "provider-title",
                ProviderInput {
                    model: "replacement-model".to_owned(),
                    models: vec!["replacement-model".to_owned()],
                    ..input("Title provider", ApiKeyAction::Keep)
                },
                "operation-title-update".to_owned(),
                "credential-title-update".to_owned(),
                101,
            )
            .await
            .unwrap();
        assert_eq!(settings.get_title_model_binding().await.unwrap(), None);

        assert_eq!(service.set_title_model_binding(None).await.unwrap(), None);
    });
}

#[test]
fn provider_crud_round_trip_keeps_secrets_only_in_injected_store() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool.clone(), store.clone());
        let sentinel = "SENTINEL_NATIVE_SECRET";

        let saved = service
            .save(
                "provider-a",
                input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from(sentinel)),
                ),
                "operation-create".to_owned(),
                "credential-a".to_owned(),
                100,
            )
            .await
            .expect("provider saves");
        assert_eq!(saved.id, "provider-a");
        assert_eq!(saved.name, "Primary");
        assert_eq!(saved.protocol, Protocol::OpenAiCompatible);
        assert_eq!(saved.base_endpoint, "https://provider.example/v1");
        assert_eq!(saved.model, "fixture-model");
        assert!(saved.has_api_key);
        assert_eq!((saved.created_at, saved.updated_at), (100, 100));
        assert_eq!(store.snapshot().get("credential-a").unwrap(), sentinel);
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active.as_deref(), Some("provider-a"));

        let database_text: String = sqlx::query_scalar(
            "SELECT coalesce(group_concat(value, '|'), '') FROM ( \
               SELECT name AS value FROM providers \
               UNION ALL SELECT base_endpoint FROM providers \
               UNION ALL SELECT model FROM providers \
               UNION ALL SELECT coalesce(credential_ref, '') FROM providers \
               UNION ALL SELECT coalesce(base_endpoint, '') FROM provider_credential_operations \
               UNION ALL SELECT coalesce(model, '') FROM provider_credential_operations \
               UNION ALL SELECT coalesce(new_credential_ref, '') FROM provider_credential_operations \
             )",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!database_text.contains(sentinel));

        let updated = service
            .save(
                "provider-a",
                ProviderInput {
                    model: "fixture-model-2".to_owned(),
                    models: vec!["fixture-model".to_owned(), "fixture-model-2".to_owned()],
                    ..input("Primary", ApiKeyAction::Keep)
                },
                "unused-operation".to_owned(),
                "unused-credential".to_owned(),
                101,
            )
            .await
            .unwrap();
        assert_eq!(updated.model, "fixture-model-2");
        assert!(updated.has_api_key);
        assert_eq!(updated.created_at, 100);
        assert_eq!(updated.updated_at, 101);
        assert_eq!(store.snapshot().len(), 1);

        service
            .save(
                "provider-b",
                input(
                    "Secondary",
                    ApiKeyAction::Replace(SecretString::from("second-secret")),
                ),
                "operation-create-b".to_owned(),
                "credential-b".to_owned(),
                102,
            )
            .await
            .unwrap();

        let (providers, active) = service.list_providers().await.unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            ["provider-a", "provider-b"]
        );
        assert_eq!(active.as_deref(), Some("provider-a"));

        assert_eq!(
            service.set_active("provider-a").await.unwrap(),
            "provider-a"
        );
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active.as_deref(), Some("provider-a"));
        assert_eq!(service.load_active().await.unwrap().id, "provider-a");
        assert_eq!(
            service.load_by_id("provider-b").await.unwrap().name,
            "Secondary"
        );

        let removed = service
            .save(
                "provider-b",
                input("Secondary", ApiKeyAction::Remove),
                "operation-remove-b".to_owned(),
                "unused-remove".to_owned(),
                103,
            )
            .await
            .unwrap();
        assert!(!removed.has_api_key);
        assert_eq!(store.snapshot().len(), 1);
        assert!(store.snapshot().contains_key("credential-a"));

        assert!(service
            .delete("provider-b", "operation-delete-b".to_owned())
            .await
            .unwrap());
        assert!(!service
            .delete("provider-b", "operation-delete-b-again".to_owned())
            .await
            .unwrap());

        let (providers, active) = service.list_providers().await.unwrap();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "provider-a");
        assert_eq!(active.as_deref(), Some("provider-a"));
    });
}

#[test]
fn provider_names_are_unique_case_insensitively() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool, store);

        service
            .save(
                "provider-a",
                input("Alpha", ApiKeyAction::Keep),
                "operation-a".to_owned(),
                "unused".to_owned(),
                1,
            )
            .await
            .unwrap();

        assert_duplicate_name(
            service
                .save(
                    "provider-b",
                    input("ALPHA", ApiKeyAction::Keep),
                    "operation-b".to_owned(),
                    "unused".to_owned(),
                    2,
                )
                .await,
        );
        assert_duplicate_name(
            service
                .save(
                    "provider-b",
                    input("  Alpha  ", ApiKeyAction::Keep),
                    "operation-b".to_owned(),
                    "unused".to_owned(),
                    3,
                )
                .await,
        );

        service
            .save(
                "provider-b",
                input("Beta", ApiKeyAction::Keep),
                "operation-b".to_owned(),
                "unused".to_owned(),
                4,
            )
            .await
            .unwrap();

        assert_duplicate_name(
            service
                .save(
                    "provider-a",
                    ProviderInput {
                        name: "beta".to_owned(),
                        ..input("Alpha", ApiKeyAction::Keep)
                    },
                    "operation-rename".to_owned(),
                    "unused".to_owned(),
                    5,
                )
                .await,
        );

        let renamed = service
            .save(
                "provider-a",
                ProviderInput {
                    name: "Gamma".to_owned(),
                    ..input("Alpha", ApiKeyAction::Keep)
                },
                "operation-rename".to_owned(),
                "unused".to_owned(),
                6,
            )
            .await
            .unwrap();
        assert_eq!(renamed.name, "Gamma");
        assert_eq!(service.load_by_id("provider-b").await.unwrap().name, "Beta");
    });
}

#[test]
fn credential_recovery_replays_to_the_owning_provider_and_fails_closed() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool.clone(), store.clone());
        service
            .save(
                "provider-a",
                input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from("old-secret")),
                ),
                "operation-a".to_owned(),
                "credential-old".to_owned(),
                1,
            )
            .await
            .unwrap();
        service
            .save(
                "provider-b",
                input(
                    "Secondary",
                    ApiKeyAction::Replace(SecretString::from("b-secret")),
                ),
                "operation-b".to_owned(),
                "credential-b".to_owned(),
                2,
            )
            .await
            .unwrap();

        // Unwritten replace: the staged row keeps the previous reference and
        // the pending intent is discarded because the key never landed.
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, provider_id, operation, base_endpoint, model, new_credential_ref, \
                old_credential_ref, updated_at) \
             VALUES ('interrupted', 'provider-a', 'save', 'https://other.example/v1', \
                     'other-model', 'never-written', 'credential-old', 3)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let (providers, _) = service.list_providers().await.unwrap();
        let provider_a = providers
            .iter()
            .find(|provider| provider.id == "provider-a")
            .unwrap();
        assert!(provider_a.has_api_key);
        assert!(store.snapshot().contains_key("credential-old"));
        assert!(!store.snapshot().contains_key("never-written"));
        let operation_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM provider_credential_operations")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(operation_count, 0);

        // Written save replays onto its owning provider only.
        store
            .set(
                "credential-new",
                &SecretString::from("new-secret".to_owned()),
            )
            .unwrap();
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, provider_id, operation, base_endpoint, model, new_credential_ref, \
                old_credential_ref, updated_at) \
             VALUES ('written-save', 'provider-a', 'save', 'https://new.example/v1', \
                     'new-model', 'credential-new', 'credential-old', 4)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let (provider_a, secret) = service.load_by_id_with_secret("provider-a").await.unwrap();
        assert_eq!(provider_a.base_endpoint, "https://new.example/v1");
        assert_eq!(provider_a.model, "new-model");
        assert_eq!(secret.unwrap().expose_secret(), "new-secret");
        assert!(!store.snapshot().contains_key("credential-old"));
        assert!(store.snapshot().contains_key("credential-b"));
        let (provider_b, secret_b) = service.load_by_id_with_secret("provider-b").await.unwrap();
        assert_eq!(provider_b.model, "fixture-model");
        assert_eq!(secret_b.unwrap().expose_secret(), "b-secret");

        // Pending delete replay removes the row, keyring entry, and, for the
        // active provider, the activation pointer.
        service.set_active("provider-b").await.unwrap();
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, provider_id, operation, old_credential_ref) \
             VALUES ('interrupted-delete', 'provider-b', 'delete', 'credential-b')",
        )
        .execute(&pool)
        .await
        .unwrap();
        service.reconcile().await.unwrap();
        assert!(!store.snapshot().contains_key("credential-b"));
        assert!(store.snapshot().contains_key("credential-new"));
        let (providers, active) = service.list_providers().await.unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            ["provider-a"]
        );
        assert_eq!(active, None);

        // A locked store fails closed and leaves the credential untouched.
        store.set_unavailable(true);
        assert!(matches!(
            service
                .save(
                    "provider-a",
                    input(
                        "Primary",
                        ApiKeyAction::Replace(SecretString::from("secret"))
                    ),
                    "operation-unavailable".to_owned(),
                    "credential-x".to_owned(),
                    5,
                )
                .await,
            Err(ProviderError::CredentialUnavailable)
        ));
        assert!(matches!(
            service.load_by_id_with_secret("provider-a").await,
            Err(ProviderError::CredentialUnavailable)
        ));

        store.set_unavailable(false);
        let (providers, _) = service.list_providers().await.unwrap();
        let provider_a = providers
            .iter()
            .find(|provider| provider.id == "provider-a")
            .unwrap();
        assert!(provider_a.has_api_key);
        assert!(store.snapshot().contains_key("credential-new"));
        assert!(!store.snapshot().contains_key("credential-x"));

        // Keep against a vanished keyring entry rejects the write.
        let model_before_keep: String =
            sqlx::query_scalar("SELECT model FROM providers WHERE id = 'provider-a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        store.remove_direct("credential-new");
        assert!(matches!(
            service
                .save(
                    "provider-a",
                    ProviderInput {
                        model: "must-not-commit".to_owned(),
                        models: vec!["must-not-commit".to_owned()],
                        ..input("Primary", ApiKeyAction::Keep)
                    },
                    "operation-missing-keep".to_owned(),
                    "unused".to_owned(),
                    6,
                )
                .await,
            Err(ProviderError::CredentialMissing)
        ));
        let stored_model: String =
            sqlx::query_scalar("SELECT model FROM providers WHERE id = 'provider-a'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_model, model_before_keep);
    });
}

#[test]
fn deleting_active_provider_clears_activation_and_unbinds_conversations() {
    run_async(async {
        let pool = migrated_pool().await;
        let persistence = ConversationPersistenceService::new(pool.clone());
        persistence
            .create_conversation(
                NewConversation {
                    id: "conversation".to_owned(),
                    title: "Providers".to_owned(),
                    root_node_id: "root".to_owned(),
                },
                NewNode {
                    id: "root".to_owned(),
                    parent_id: None,
                    conversation_id: "conversation".to_owned(),
                    role: Role::User,
                    content: "question".to_owned(),
                    model: None,
                    created_at: 1,
                    metadata: json!({}),
                },
            )
            .await
            .unwrap();

        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool.clone(), store.clone());
        service
            .save(
                "provider-a",
                input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from("secret")),
                ),
                "operation-create-a".to_owned(),
                "credential-a".to_owned(),
                1,
            )
            .await
            .unwrap();
        service
            .save(
                "provider-b",
                input("Secondary", ApiKeyAction::Keep),
                "operation-create-b".to_owned(),
                "unused".to_owned(),
                2,
            )
            .await
            .unwrap();
        service.set_active("provider-a").await.unwrap();
        sqlx::query(
            "UPDATE conversations \
             SET provider_id = 'provider-a', model = 'primary-model', reasoning_effort = 'low' \
             WHERE id = 'conversation'",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(service
            .delete("provider-a", "operation-delete-a".to_owned())
            .await
            .unwrap());

        let (providers, active) = service.list_providers().await.unwrap();
        assert_eq!(
            providers
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            ["provider-b"]
        );
        assert_eq!(active, None);
        assert!(store.snapshot().is_empty());
        let binding: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT provider_id, model, reasoning_effort FROM conversations \
             WHERE id = 'conversation'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(binding, (None, None, Some("low".to_owned())));
        assert!(matches!(
            service.load_active().await,
            Err(ProviderError::ProfileNotFound)
        ));

        // Binding columns stay paired after delete; DTO mapping remains a
        // defensive guard for any historical residual that predates migration 7.
        let tree = persistence
            .load_conversation_tree("conversation")
            .await
            .unwrap();
        let dto = ConversationDto::from(tree.conversation);
        assert_eq!(dto.provider_id, None);
        assert_eq!(dto.model, None);
        // Effort is independent of the binding and survives the deletion.
        assert_eq!(dto.reasoning_effort, Some(ReasoningEffortDto::Low));

        service.set_active("provider-b").await.unwrap();
        assert_eq!(service.load_active().await.unwrap().id, "provider-b");
    });
}

#[test]
fn deleting_provider_without_credentials_clears_conversation_binding_pair() {
    run_async(async {
        let pool = migrated_pool().await;
        let persistence = ConversationPersistenceService::new(pool.clone());
        persistence
            .create_conversation(
                NewConversation {
                    id: "conversation".to_owned(),
                    title: "Uncredentialed delete".to_owned(),
                    root_node_id: "root".to_owned(),
                },
                NewNode {
                    id: "root".to_owned(),
                    parent_id: None,
                    conversation_id: "conversation".to_owned(),
                    role: Role::User,
                    content: "question".to_owned(),
                    model: None,
                    created_at: 1,
                    metadata: json!({}),
                },
            )
            .await
            .unwrap();

        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool.clone(), store.clone());
        service
            .save(
                "provider-a",
                input("Primary", ApiKeyAction::Keep),
                "operation-create-a".to_owned(),
                "unused".to_owned(),
                1,
            )
            .await
            .unwrap();
        service
            .save(
                "provider-b",
                input(
                    "Secondary",
                    ApiKeyAction::Replace(SecretString::from("keep-me")),
                ),
                "operation-create-b".to_owned(),
                "credential-b".to_owned(),
                2,
            )
            .await
            .unwrap();
        sqlx::query(
            "UPDATE conversations \
             SET provider_id = 'provider-a', model = 'primary-model', reasoning_effort = 'high' \
             WHERE id = 'conversation'",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(service
            .delete("provider-a", "operation-delete-a".to_owned())
            .await
            .unwrap());

        let binding: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT provider_id, model, reasoning_effort FROM conversations \
             WHERE id = 'conversation'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(binding, (None, None, Some("high".to_owned())));
        assert_eq!(
            service
                .list_providers()
                .await
                .unwrap()
                .0
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>(),
            ["provider-b"]
        );
        assert!(store.snapshot().contains_key("credential-b"));
    });
}

#[test]
fn concurrent_provider_saves_are_serialized_without_orphaned_credentials() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let first = ProviderService::new(pool.clone(), store.clone());
        let second = ProviderService::new(pool.clone(), store.clone());

        let first_create = first.save(
            "provider-a",
            input(
                "Primary",
                ApiKeyAction::Replace(SecretString::from("value-first")),
            ),
            "operation-create-first".to_owned(),
            "credential-first".to_owned(),
            1,
        );
        let second_create = second.save(
            "provider-b",
            input(
                "Secondary",
                ApiKeyAction::Replace(SecretString::from("value-second")),
            ),
            "operation-create-second".to_owned(),
            "credential-second".to_owned(),
            2,
        );
        let (first_result, second_result) =
            futures_util::future::join(first_create, second_create).await;
        first_result.unwrap();
        second_result.unwrap();
        assert_eq!(store.snapshot().len(), 2);

        let first_replace = first.save(
            "provider-a",
            ProviderInput {
                model: "model-first".to_owned(),
                models: vec!["model-first".to_owned()],
                ..input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from("again-first")),
                )
            },
            "operation-replace-first".to_owned(),
            "credential-again-first".to_owned(),
            3,
        );
        let second_replace = second.save(
            "provider-a",
            ProviderInput {
                model: "model-second".to_owned(),
                models: vec!["model-second".to_owned()],
                ..input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from("again-second")),
                )
            },
            "operation-replace-second".to_owned(),
            "credential-again-second".to_owned(),
            4,
        );
        let (first_result, second_result) =
            futures_util::future::join(first_replace, second_replace).await;
        first_result.unwrap();
        second_result.unwrap();

        let provider = first.load_by_id("provider-a").await.unwrap();
        assert!(matches!(
            provider.model.as_str(),
            "model-first" | "model-second"
        ));
        assert_eq!(store.snapshot().len(), 2);
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
        assert!(tables.contains(&"providers".to_owned()));
        assert!(tables.contains(&"provider_credential_operations".to_owned()));
        assert!(tables.contains(&"app_settings".to_owned()));
        assert!(!tables.contains(&"provider_profiles".to_owned()));

        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('providers') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            columns,
            [
                "id",
                "name",
                "protocol",
                "base_endpoint",
                "model",
                "credential_ref",
                "created_at",
                "updated_at",
                "models"
            ]
        );
        assert!(columns
            .iter()
            .all(|column| !column.contains("key") && !column.contains("secret")));
    });
}

#[test]
fn model_list_is_validated_deduplicated_and_persisted() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = ProviderService::new(pool, Arc::new(FakeCredentialStore::default()));

        let saved = service
            .save(
                "provider-models",
                ProviderInput {
                    model: "main-model".to_owned(),
                    models: vec![
                        "side-model".to_owned(),
                        "main-model".to_owned(),
                        "main-model".to_owned(),
                        " side-model ".to_owned(),
                    ],
                    ..input("Models", ApiKeyAction::Keep)
                },
                "op-models".to_owned(),
                "unused".to_owned(),
                1,
            )
            .await
            .unwrap();
        assert_eq!(
            saved.models,
            vec!["side-model".to_owned(), "main-model".to_owned()]
        );

        // The default model must be a member of the list.
        let outside = service
            .save(
                "provider-models",
                ProviderInput {
                    model: "ghost-model".to_owned(),
                    models: vec!["main-model".to_owned()],
                    ..input("Models", ApiKeyAction::Keep)
                },
                "op-models-2".to_owned(),
                "unused".to_owned(),
                2,
            )
            .await;
        assert!(matches!(
            outside,
            Err(ProviderError::InvalidInput { field: "model", .. })
        ));

        // Empty and oversized lists are rejected.
        for models in [
            Vec::new(),
            (0..51)
                .map(|index| format!("m-{index}"))
                .collect::<Vec<_>>(),
        ] {
            let result = service
                .save(
                    "provider-models",
                    ProviderInput {
                        models,
                        ..input("Models", ApiKeyAction::Keep)
                    },
                    "op-models-3".to_owned(),
                    "unused".to_owned(),
                    3,
                )
                .await;
            assert!(
                matches!(
                    result,
                    Err(ProviderError::InvalidInput {
                        field: "models",
                        ..
                    })
                ),
                "list size must be enforced"
            );
        }
    });
}

#[test]
fn saving_the_first_provider_auto_activates_and_later_saves_do_not() {
    run_async(async {
        let pool = migrated_pool().await;
        let store = Arc::new(FakeCredentialStore::default());
        let service = ProviderService::new(pool.clone(), store);

        service
            .save(
                "provider-a",
                input(
                    "Primary",
                    ApiKeyAction::Replace(SecretString::from("secret-a")),
                ),
                "operation-a".to_owned(),
                "credential-a".to_owned(),
                1,
            )
            .await
            .unwrap();
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active.as_deref(), Some("provider-a"));
        assert_eq!(service.load_active().await.unwrap().id, "provider-a");

        service
            .save(
                "provider-b",
                input("Secondary", ApiKeyAction::Keep),
                "operation-b".to_owned(),
                "unused".to_owned(),
                2,
            )
            .await
            .unwrap();
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active.as_deref(), Some("provider-a"));

        service.delete("provider-a", "operation-delete-a".to_owned())
            .await
            .unwrap();
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active, None);

        service
            .save(
                "provider-b",
                input(
                    "Secondary",
                    ApiKeyAction::Replace(SecretString::from("secret-b")),
                ),
                "operation-b-update".to_owned(),
                "credential-b".to_owned(),
                3,
            )
            .await
            .unwrap();
        let (_, active) = service.list_providers().await.unwrap();
        assert_eq!(active, None);

        assert_duplicate_name(
            service
                .save(
                    "provider-c",
                    input("Secondary", ApiKeyAction::Keep),
                    "operation-c".to_owned(),
                    "unused".to_owned(),
                    4,
                )
                .await,
        );
        let active_setting: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'active_provider_id'")
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(active_setting, None);
    });
}
