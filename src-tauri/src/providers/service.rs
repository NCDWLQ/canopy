use std::sync::{Arc, OnceLock};

use futures_util::lock::Mutex;
use secrecy::SecretString;
use sqlx::{SqliteConnection, SqlitePool};

use super::{
    domain::{
        validate_model, validate_models, validate_name, ApiKeyAction, Provider, ProviderInput,
        RedactedProvider,
    },
    repository::{CredentialOperation, CredentialOperationKind, ProviderRepository},
    CredentialStore, ProviderError,
};
use crate::llm::ValidatedEndpoint;
use crate::settings::{SettingsRepository, TitleModelBinding};

#[derive(Clone)]
pub struct ProviderService {
    pool: SqlitePool,
    credentials: Arc<dyn CredentialStore>,
    operation_lock: Arc<Mutex<()>>,
}

static PROVIDER_OPERATION_LOCK: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

impl std::fmt::Debug for ProviderService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderService")
            .finish_non_exhaustive()
    }
}

impl ProviderService {
    pub fn new(pool: SqlitePool, credentials: Arc<dyn CredentialStore>) -> Self {
        let operation_lock =
            Arc::clone(PROVIDER_OPERATION_LOCK.get_or_init(|| Arc::new(Mutex::new(()))));
        Self {
            pool,
            credentials,
            operation_lock,
        }
    }

    /// Lists every stored provider together with the persisted global
    /// activation pointer (`None` while no provider is activated).
    pub async fn list_providers(
        &self,
    ) -> Result<(Vec<RedactedProvider>, Option<String>), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let providers = ProviderRepository::list_providers(&mut transaction).await?;
        let active = SettingsRepository::get_active_provider_id(&mut transaction).await?;
        transaction.commit().await?;
        Ok((
            providers
                .into_iter()
                .map(|provider| {
                    let has_api_key = provider.credential_ref.is_some();
                    redact_provider(provider, has_api_key)
                })
                .collect(),
            active,
        ))
    }

    pub async fn set_title_model_binding(
        &self,
        binding: Option<TitleModelBinding>,
    ) -> Result<Option<TitleModelBinding>, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let stored_binding = match binding.as_ref() {
            Some(binding) => {
                let provider =
                    ProviderRepository::get_by_id(&mut transaction, &binding.provider_id)
                        .await?
                        .ok_or(ProviderError::ProfileNotFound)?;
                let model = validate_model(&binding.model)?;
                if !provider.models.iter().any(|candidate| candidate == &model) {
                    return Err(ProviderError::invalid_input("model", "not_in_models"));
                }
                let normalized = TitleModelBinding {
                    provider_id: binding.provider_id.clone(),
                    model,
                };
                SettingsRepository::set_title_model_binding(&mut transaction, &normalized).await?;
                Some(normalized)
            }
            None => {
                SettingsRepository::delete_title_model_binding(&mut transaction).await?;
                None
            }
        };
        transaction.commit().await?;
        Ok(stored_binding)
    }

    /// Saves one provider. `provider_id` addresses the row: an absent row is
    /// created, an existing row is updated (credential actions unchanged).
    pub async fn save(
        &self,
        provider_id: &str,
        input: ProviderInput,
        operation_id: String,
        credential_ref: String,
        now_millis: i64,
    ) -> Result<RedactedProvider, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let name = validate_name(&input.name)?;
        let endpoint = ValidatedEndpoint::parse(&input.base_endpoint, input.protocol)?;
        let base_endpoint = endpoint.normalized_base();
        let model = validate_model(&input.model)?;
        let models = validate_models(&input.models, &model)?;

        let mut transaction = self.pool.begin().await?;
        let providers = ProviderRepository::list_providers(&mut transaction).await?;
        let was_empty = providers.is_empty();
        let existing = providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .cloned();
        let is_create = existing.is_none();
        if providers
            .iter()
            .any(|provider| provider.id != provider_id && provider.name.eq_ignore_ascii_case(&name))
        {
            return Err(ProviderError::invalid_input("name", "duplicate"));
        }

        match input.api_key {
            ApiKeyAction::Keep => {
                let credential_ref = existing
                    .as_ref()
                    .and_then(|provider| provider.credential_ref.clone());
                if let Some(credential_ref) = credential_ref.as_ref() {
                    self.credential_get(credential_ref.clone())
                        .await?
                        .ok_or(ProviderError::CredentialMissing)?;
                }
                let provider = Provider {
                    id: provider_id.to_owned(),
                    name,
                    protocol: input.protocol,
                    base_endpoint,
                    model,
                    models: models.clone(),
                    credential_ref,
                    created_at: existing
                        .as_ref()
                        .map_or(now_millis, |provider| provider.created_at),
                    updated_at: now_millis,
                };
                ProviderRepository::upsert_provider(&mut transaction, &provider).await?;
                SettingsRepository::clear_invalid_title_binding_for_provider(
                    &mut transaction,
                    provider_id,
                    &provider.models,
                )
                .await?;
                if was_empty && is_create {
                    SettingsRepository::set_active_provider_id(&mut transaction, provider_id)
                        .await?;
                }
                transaction.commit().await?;
            }
            ApiKeyAction::Replace(secret) => {
                validate_secret(&secret)?;
                // Stage the row first carrying its unchanged credential
                // reference: the operation row's foreign key needs the
                // provider row present, and the durable reference may only
                // move once the keyring write is verified in reconcile.
                let staged = Provider {
                    id: provider_id.to_owned(),
                    name,
                    protocol: input.protocol,
                    base_endpoint: base_endpoint.clone(),
                    model: model.clone(),
                    models: models.clone(),
                    credential_ref: existing
                        .as_ref()
                        .and_then(|provider| provider.credential_ref.clone()),
                    created_at: existing
                        .as_ref()
                        .map_or(now_millis, |provider| provider.created_at),
                    updated_at: now_millis,
                };
                ProviderRepository::upsert_provider(&mut transaction, &staged).await?;
                SettingsRepository::clear_invalid_title_binding_for_provider(
                    &mut transaction,
                    provider_id,
                    &staged.models,
                )
                .await?;
                let operation = CredentialOperation {
                    id: operation_id,
                    provider_id: provider_id.to_owned(),
                    kind: CredentialOperationKind::Save,
                    base_endpoint: Some(base_endpoint),
                    model: Some(model),
                    new_credential_ref: Some(credential_ref.clone()),
                    old_credential_ref: existing.and_then(|provider| provider.credential_ref),
                    updated_at: Some(now_millis),
                };
                ProviderRepository::insert_operation(&mut transaction, &operation).await?;
                if was_empty && is_create {
                    SettingsRepository::set_active_provider_id(&mut transaction, provider_id)
                        .await?;
                }
                transaction.commit().await?;
                self.credential_set(credential_ref, secret).await?;
                self.reconcile_inner().await?;
            }
            ApiKeyAction::Remove => {
                let stored_ref = existing
                    .as_ref()
                    .and_then(|provider| provider.credential_ref.clone());
                if stored_ref.is_none() {
                    // Nothing to remove: persist the row directly.
                    let provider = Provider {
                        id: provider_id.to_owned(),
                        name,
                        protocol: input.protocol,
                        base_endpoint,
                        model,
                        models,
                        credential_ref: None,
                        created_at: existing
                            .as_ref()
                            .map_or(now_millis, |provider| provider.created_at),
                        updated_at: now_millis,
                    };
                    ProviderRepository::upsert_provider(&mut transaction, &provider).await?;
                    SettingsRepository::clear_invalid_title_binding_for_provider(
                        &mut transaction,
                        provider_id,
                        &provider.models,
                    )
                    .await?;
                    if was_empty && is_create {
                        SettingsRepository::set_active_provider_id(&mut transaction, provider_id)
                            .await?;
                    }
                    transaction.commit().await?;
                } else {
                    let staged = Provider {
                        id: provider_id.to_owned(),
                        name,
                        protocol: input.protocol,
                        base_endpoint: base_endpoint.clone(),
                        model: model.clone(),
                        models: models.clone(),
                        credential_ref: stored_ref,
                        created_at: existing
                            .as_ref()
                            .map_or(now_millis, |provider| provider.created_at),
                        updated_at: now_millis,
                    };
                    ProviderRepository::upsert_provider(&mut transaction, &staged).await?;
                    SettingsRepository::clear_invalid_title_binding_for_provider(
                        &mut transaction,
                        provider_id,
                        &staged.models,
                    )
                    .await?;
                    let operation = CredentialOperation {
                        id: operation_id,
                        provider_id: provider_id.to_owned(),
                        kind: CredentialOperationKind::Save,
                        base_endpoint: Some(base_endpoint),
                        model: Some(model),
                        new_credential_ref: None,
                        old_credential_ref: existing.and_then(|provider| provider.credential_ref),
                        updated_at: Some(now_millis),
                    };
                    ProviderRepository::insert_operation(&mut transaction, &operation).await?;
                    if was_empty && is_create {
                        SettingsRepository::set_active_provider_id(&mut transaction, provider_id)
                            .await?;
                    }
                    transaction.commit().await?;
                    self.reconcile_inner().await?;
                }
            }
        }

        let (provider, secret) = self.load_with_secret_inner(provider_id).await?;
        Ok(redact_provider(provider, secret.is_some()))
    }

    /// Deletes one provider. Reconciles pending credential intents first,
    /// removes the row (bound conversations fall back to the global provider
    /// through the foreign key), and clears the activation pointer when the
    /// deleted provider was active. Returns whether a row was removed.
    pub async fn delete(
        &self,
        provider_id: &str,
        operation_id: String,
    ) -> Result<bool, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let existing = ProviderRepository::get_by_id(&mut transaction, provider_id).await?;
        let Some(existing) = existing else {
            transaction.commit().await?;
            return Ok(false);
        };
        if existing.credential_ref.is_none() {
            let deleted =
                ProviderRepository::delete_provider(&mut transaction, provider_id).await?;
            SettingsRepository::clear_active_provider_id_if(&mut transaction, provider_id).await?;
            SettingsRepository::clear_title_binding_for_provider(&mut transaction, provider_id)
                .await?;
            transaction.commit().await?;
            return Ok(deleted);
        }
        ProviderRepository::insert_operation(
            &mut transaction,
            &CredentialOperation {
                id: operation_id,
                provider_id: provider_id.to_owned(),
                kind: CredentialOperationKind::Delete,
                base_endpoint: None,
                model: None,
                new_credential_ref: None,
                old_credential_ref: existing.credential_ref,
                updated_at: None,
            },
        )
        .await?;
        transaction.commit().await?;
        self.reconcile_inner().await?;
        Ok(true)
    }

    /// Activates one stored provider as the global default.
    pub async fn set_active(&self, provider_id: &str) -> Result<String, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let provider = ProviderRepository::get_by_id(&mut transaction, provider_id)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        SettingsRepository::set_active_provider_id(&mut transaction, provider_id).await?;
        transaction.commit().await?;
        Ok(provider.id)
    }

    pub async fn load_by_id(&self, provider_id: &str) -> Result<Provider, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let provider = ProviderRepository::get_by_id(&mut transaction, provider_id)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        transaction.commit().await?;
        Ok(provider)
    }

    /// Looks up a provider id on an existing connection so generation can
    /// validate a conversation binding in the same transaction as the write.
    /// Returns `sqlx::Error` so transient failures keep the historical
    /// persistence `CommandError` mapping rather than the provider-storage
    /// envelope.
    pub(crate) async fn exists_on(
        connection: &mut SqliteConnection,
        provider_id: &str,
    ) -> Result<bool, sqlx::Error> {
        ProviderRepository::exists(connection, provider_id).await
    }

    pub async fn load_by_id_with_secret(
        &self,
        provider_id: &str,
    ) -> Result<(Provider, Option<SecretString>), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.load_with_secret_inner(provider_id).await
    }

    /// Loads the globally activated provider. Fails with `ProfileNotFound`
    /// while no provider is activated.
    pub async fn load_active(&self) -> Result<Provider, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let active = SettingsRepository::get_active_provider_id(&mut transaction)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        let provider = ProviderRepository::get_by_id(&mut transaction, &active)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        transaction.commit().await?;
        Ok(provider)
    }

    /// Loads the globally activated provider together with its credential in
    /// one reconciliation/operation-lock window. Generation uses this rather
    /// than resolving the active id and credential in separate reads so its
    /// request snapshot cannot mix two provider configurations.
    pub async fn load_active_with_secret(
        &self,
    ) -> Result<(Provider, Option<SecretString>), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let active = SettingsRepository::get_active_provider_id(&mut transaction)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        let provider = ProviderRepository::get_by_id(&mut transaction, &active)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        transaction.commit().await?;
        let secret = match provider.credential_ref.clone() {
            Some(credential_ref) => Some(
                self.credential_get(credential_ref)
                    .await?
                    .ok_or(ProviderError::CredentialMissing)?,
            ),
            None => None,
        };
        Ok((provider, secret))
    }

    pub async fn reconcile(&self) -> Result<(), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await
    }

    async fn load_with_secret_inner(
        &self,
        provider_id: &str,
    ) -> Result<(Provider, Option<SecretString>), ProviderError> {
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let provider = ProviderRepository::get_by_id(&mut transaction, provider_id)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        transaction.commit().await?;
        let secret = match provider.credential_ref.clone() {
            Some(credential_ref) => Some(
                self.credential_get(credential_ref)
                    .await?
                    .ok_or(ProviderError::CredentialMissing)?,
            ),
            None => None,
        };
        Ok((provider, secret))
    }

    async fn reconcile_inner(&self) -> Result<(), ProviderError> {
        let mut connection = self.pool.acquire().await?;
        let operations = ProviderRepository::load_operations(&mut connection).await?;
        drop(connection);

        for operation in operations {
            match operation.kind {
                CredentialOperationKind::Save => self.reconcile_save(operation).await?,
                CredentialOperationKind::Delete => self.reconcile_delete(operation).await?,
            }
        }
        Ok(())
    }

    async fn reconcile_save(&self, operation: CredentialOperation) -> Result<(), ProviderError> {
        if let Some(new_ref) = operation.new_credential_ref.clone() {
            if self.credential_get(new_ref).await?.is_none() {
                // The keyring write never landed; the intent is void and the
                // staged row keeps its previous credential reference.
                let mut transaction = self.pool.begin().await?;
                ProviderRepository::delete_operation(&mut transaction, &operation.id).await?;
                transaction.commit().await?;
                return Ok(());
            }
        }

        let mut transaction = self.pool.begin().await?;
        ProviderRepository::apply_save_operation(&mut transaction, &operation).await?;
        transaction.commit().await?;

        if let Some(old_ref) = operation.old_credential_ref {
            if Some(old_ref.as_str()) != operation.new_credential_ref.as_deref() {
                self.credential_delete(old_ref).await?;
            }
        }
        let mut transaction = self.pool.begin().await?;
        ProviderRepository::delete_operation(&mut transaction, &operation.id).await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn reconcile_delete(&self, operation: CredentialOperation) -> Result<(), ProviderError> {
        if let Some(old_ref) = operation.old_credential_ref {
            self.credential_delete(old_ref).await?;
        }
        let mut transaction = self.pool.begin().await?;
        // The operation row keeps the provider row referenced, so remove the
        // intent before the row; the foreign key is immediate, not deferred.
        ProviderRepository::delete_operation(&mut transaction, &operation.id).await?;
        ProviderRepository::delete_provider(&mut transaction, &operation.provider_id).await?;
        SettingsRepository::clear_active_provider_id_if(&mut transaction, &operation.provider_id)
            .await?;
        SettingsRepository::clear_title_binding_for_provider(
            &mut transaction,
            &operation.provider_id,
        )
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn credential_set(
        &self,
        credential_ref: String,
        secret: SecretString,
    ) -> Result<(), ProviderError> {
        let store = Arc::clone(&self.credentials);
        tauri::async_runtime::spawn_blocking(move || store.set(&credential_ref, &secret))
            .await
            .map_err(|_| ProviderError::CredentialUnavailable)?
    }

    async fn credential_get(
        &self,
        credential_ref: String,
    ) -> Result<Option<SecretString>, ProviderError> {
        let store = Arc::clone(&self.credentials);
        tauri::async_runtime::spawn_blocking(move || store.get(&credential_ref))
            .await
            .map_err(|_| ProviderError::CredentialUnavailable)?
    }

    async fn credential_delete(&self, credential_ref: String) -> Result<(), ProviderError> {
        let store = Arc::clone(&self.credentials);
        tauri::async_runtime::spawn_blocking(move || store.delete(&credential_ref))
            .await
            .map_err(|_| ProviderError::CredentialUnavailable)?
    }
}

fn validate_secret(secret: &SecretString) -> Result<(), ProviderError> {
    use secrecy::ExposeSecret;
    let value = secret.expose_secret();
    if value.trim().is_empty() {
        return Err(ProviderError::invalid_input("api_key", "blank"));
    }
    if value.len() > 16 * 1024 {
        return Err(ProviderError::invalid_input("api_key", "too_long"));
    }
    Ok(())
}

fn redact_provider(provider: Provider, has_api_key: bool) -> RedactedProvider {
    RedactedProvider {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        base_endpoint: provider.base_endpoint,
        model: provider.model,
        models: provider.models,
        has_api_key,
        created_at: provider.created_at,
        updated_at: provider.updated_at,
    }
}
