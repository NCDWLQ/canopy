use std::sync::{Arc, OnceLock};

use futures_util::lock::Mutex;
use secrecy::SecretString;
use sqlx::SqlitePool;

use super::{
    domain::{validate_model, ApiKeyAction, ProviderProfileInput, ValidatedEndpoint},
    repository::{CredentialOperation, CredentialOperationKind, ProviderProfileRepository},
    CredentialStore, ProviderError, ProviderProfile, RedactedProviderProfile,
};

#[derive(Clone)]
pub struct ProviderProfileService {
    pool: SqlitePool,
    credentials: Arc<dyn CredentialStore>,
    operation_lock: Arc<Mutex<()>>,
}

static PROFILE_OPERATION_LOCK: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

impl std::fmt::Debug for ProviderProfileService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderProfileService")
            .finish_non_exhaustive()
    }
}

impl ProviderProfileService {
    pub fn new(pool: SqlitePool, credentials: Arc<dyn CredentialStore>) -> Self {
        let operation_lock =
            Arc::clone(PROFILE_OPERATION_LOCK.get_or_init(|| Arc::new(Mutex::new(()))));
        Self {
            pool,
            credentials,
            operation_lock,
        }
    }

    pub async fn save(
        &self,
        input: ProviderProfileInput,
        operation_id: String,
        credential_ref: String,
        updated_at: i64,
    ) -> Result<RedactedProviderProfile, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let endpoint = ValidatedEndpoint::parse(&input.base_endpoint)?;
        let model = validate_model(&input.model)?;
        let mut transaction = self.pool.begin().await?;
        let existing = ProviderProfileRepository::load_profile(&mut transaction).await?;

        match input.api_key {
            ApiKeyAction::Keep => {
                let credential_ref = existing
                    .as_ref()
                    .and_then(|profile| profile.credential_ref.clone());
                if let Some(credential_ref) = credential_ref.as_ref() {
                    self.credential_get(credential_ref.clone())
                        .await?
                        .ok_or(ProviderError::CredentialMissing)?;
                }
                let profile = ProviderProfile {
                    base_endpoint: endpoint.normalized_base(),
                    model,
                    credential_ref,
                    updated_at,
                };
                ProviderProfileRepository::upsert_profile(&mut transaction, &profile).await?;
                transaction.commit().await?;
            }
            ApiKeyAction::Replace(secret) => {
                validate_secret(&secret)?;
                let operation = CredentialOperation {
                    id: operation_id,
                    kind: CredentialOperationKind::Save,
                    base_endpoint: Some(endpoint.normalized_base()),
                    model: Some(model),
                    new_credential_ref: Some(credential_ref.clone()),
                    old_credential_ref: existing.and_then(|profile| profile.credential_ref),
                    updated_at: Some(updated_at),
                };
                ProviderProfileRepository::insert_operation(&mut transaction, &operation).await?;
                transaction.commit().await?;
                self.credential_set(credential_ref, secret).await?;
                self.reconcile_inner().await?;
            }
            ApiKeyAction::Remove => {
                let operation = CredentialOperation {
                    id: operation_id,
                    kind: CredentialOperationKind::Save,
                    base_endpoint: Some(endpoint.normalized_base()),
                    model: Some(model),
                    new_credential_ref: None,
                    old_credential_ref: existing.and_then(|profile| profile.credential_ref),
                    updated_at: Some(updated_at),
                };
                ProviderProfileRepository::insert_operation(&mut transaction, &operation).await?;
                transaction.commit().await?;
                self.reconcile_inner().await?;
            }
        }

        let (profile, secret) = self.load_with_secret_inner().await?;
        Ok(redact_profile(profile, secret.is_some()))
    }

    pub async fn load(&self) -> Result<RedactedProviderProfile, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        let (profile, secret) = self.load_with_secret_inner().await?;
        Ok(redact_profile(profile, secret.is_some()))
    }

    pub async fn load_with_secret(
        &self,
    ) -> Result<(ProviderProfile, Option<SecretString>), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.load_with_secret_inner().await
    }

    async fn load_with_secret_inner(
        &self,
    ) -> Result<(ProviderProfile, Option<SecretString>), ProviderError> {
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let profile = ProviderProfileRepository::load_profile(&mut transaction)
            .await?
            .ok_or(ProviderError::ProfileNotFound)?;
        transaction.commit().await?;
        let secret = match profile.credential_ref.clone() {
            Some(credential_ref) => Some(
                self.credential_get(credential_ref)
                    .await?
                    .ok_or(ProviderError::CredentialMissing)?,
            ),
            None => None,
        };
        Ok((profile, secret))
    }

    pub async fn delete(&self, operation_id: String) -> Result<bool, ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await?;
        let mut transaction = self.pool.begin().await?;
        let profile = ProviderProfileRepository::load_profile(&mut transaction).await?;
        let Some(profile) = profile else {
            transaction.commit().await?;
            return Ok(false);
        };
        if profile.credential_ref.is_none() {
            let deleted = ProviderProfileRepository::delete_profile(&mut transaction).await?;
            transaction.commit().await?;
            return Ok(deleted);
        }
        ProviderProfileRepository::insert_operation(
            &mut transaction,
            &CredentialOperation {
                id: operation_id,
                kind: CredentialOperationKind::Delete,
                base_endpoint: None,
                model: None,
                new_credential_ref: None,
                old_credential_ref: profile.credential_ref,
                updated_at: None,
            },
        )
        .await?;
        transaction.commit().await?;
        self.reconcile_inner().await?;
        Ok(true)
    }

    pub async fn reconcile(&self) -> Result<(), ProviderError> {
        let _guard = self.operation_lock.lock().await;
        self.reconcile_inner().await
    }

    async fn reconcile_inner(&self) -> Result<(), ProviderError> {
        let mut connection = self.pool.acquire().await?;
        let operations = ProviderProfileRepository::load_operations(&mut connection).await?;
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
                let mut transaction = self.pool.begin().await?;
                ProviderProfileRepository::delete_operation(&mut transaction, &operation.id)
                    .await?;
                transaction.commit().await?;
                return Ok(());
            }
        }

        let profile = ProviderProfile {
            base_endpoint: operation.base_endpoint.ok_or(ProviderError::Protocol)?,
            model: operation.model.ok_or(ProviderError::Protocol)?,
            credential_ref: operation.new_credential_ref.clone(),
            updated_at: operation.updated_at.ok_or(ProviderError::Protocol)?,
        };
        let mut transaction = self.pool.begin().await?;
        ProviderProfileRepository::upsert_profile(&mut transaction, &profile).await?;
        transaction.commit().await?;

        if let Some(old_ref) = operation.old_credential_ref {
            if Some(old_ref.as_str()) != operation.new_credential_ref.as_deref() {
                self.credential_delete(old_ref).await?;
            }
        }
        let mut transaction = self.pool.begin().await?;
        ProviderProfileRepository::delete_operation(&mut transaction, &operation.id).await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn reconcile_delete(&self, operation: CredentialOperation) -> Result<(), ProviderError> {
        if let Some(old_ref) = operation.old_credential_ref {
            self.credential_delete(old_ref).await?;
        }
        let mut transaction = self.pool.begin().await?;
        ProviderProfileRepository::delete_profile(&mut transaction).await?;
        ProviderProfileRepository::delete_operation(&mut transaction, &operation.id).await?;
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

fn redact_profile(profile: ProviderProfile, has_api_key: bool) -> RedactedProviderProfile {
    RedactedProviderProfile {
        base_endpoint: profile.base_endpoint,
        model: profile.model,
        has_api_key,
        updated_at: profile.updated_at,
    }
}
