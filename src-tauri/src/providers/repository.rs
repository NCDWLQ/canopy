use sqlx::{sqlite::SqliteRow, Row, SqliteConnection};

use super::{
    domain::{Protocol, Provider},
    ProviderError,
};

pub(crate) const ACTIVE_PROVIDER_SETTING_KEY: &str = "active_provider_id";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialOperationKind {
    Save,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CredentialOperation {
    pub id: String,
    pub provider_id: String,
    pub kind: CredentialOperationKind,
    pub base_endpoint: Option<String>,
    pub model: Option<String>,
    pub new_credential_ref: Option<String>,
    pub old_credential_ref: Option<String>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Default)]
pub(crate) struct ProviderRepository;

impl ProviderRepository {
    pub(crate) async fn list_providers(
        connection: &mut SqliteConnection,
    ) -> Result<Vec<Provider>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, name, protocol, base_endpoint, model, models, credential_ref, \
                    created_at, updated_at \
             FROM providers ORDER BY created_at ASC, id ASC",
        )
        .fetch_all(connection)
        .await?;
        rows.into_iter().map(decode_provider).collect()
    }

    pub(crate) async fn get_by_id(
        connection: &mut SqliteConnection,
        id: &str,
    ) -> Result<Option<Provider>, ProviderError> {
        let row = sqlx::query(
            "SELECT id, name, protocol, base_endpoint, model, models, credential_ref, \
                    created_at, updated_at \
             FROM providers WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(connection)
        .await?;
        row.map(decode_provider).transpose()
    }

    pub(crate) async fn upsert_provider(
        connection: &mut SqliteConnection,
        provider: &Provider,
    ) -> Result<(), ProviderError> {
        sqlx::query(
            "INSERT INTO providers \
               (id, name, protocol, base_endpoint, model, models, credential_ref, \
                created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(id) DO UPDATE SET \
               name = excluded.name, protocol = excluded.protocol, \
               base_endpoint = excluded.base_endpoint, model = excluded.model, \
               models = excluded.models, credential_ref = excluded.credential_ref, \
               updated_at = excluded.updated_at",
        )
        .bind(&provider.id)
        .bind(&provider.name)
        .bind(provider.protocol.as_str())
        .bind(&provider.base_endpoint)
        .bind(&provider.model)
        .bind(serde_json::to_string(&provider.models).map_err(|_| ProviderError::Protocol)?)
        .bind(&provider.credential_ref)
        .bind(provider.created_at)
        .bind(provider.updated_at)
        .execute(connection)
        .await?;
        Ok(())
    }

    /// Applies the durable columns carried by a save operation. The display
    /// name, protocol, and creation timestamp live only in `providers`, so a
    /// replayed operation updates the remaining columns in place.
    pub(crate) async fn apply_save_operation(
        connection: &mut SqliteConnection,
        operation: &CredentialOperation,
    ) -> Result<(), ProviderError> {
        sqlx::query(
            "UPDATE providers \
             SET base_endpoint = ?1, model = ?2, credential_ref = ?3, updated_at = ?4 \
             WHERE id = ?5",
        )
        .bind(&operation.base_endpoint)
        .bind(&operation.model)
        .bind(&operation.new_credential_ref)
        .bind(operation.updated_at)
        .bind(&operation.provider_id)
        .execute(connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn delete_provider(
        connection: &mut SqliteConnection,
        id: &str,
    ) -> Result<bool, ProviderError> {
        Ok(sqlx::query("DELETE FROM providers WHERE id = ?1")
            .bind(id)
            .execute(connection)
            .await?
            .rows_affected()
            > 0)
    }

    pub(crate) async fn insert_operation(
        connection: &mut SqliteConnection,
        operation: &CredentialOperation,
    ) -> Result<(), ProviderError> {
        sqlx::query(
            "INSERT INTO provider_credential_operations \
               (id, provider_id, operation, base_endpoint, model, new_credential_ref, \
                old_credential_ref, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&operation.id)
        .bind(&operation.provider_id)
        .bind(match operation.kind {
            CredentialOperationKind::Save => "save",
            CredentialOperationKind::Delete => "delete",
        })
        .bind(&operation.base_endpoint)
        .bind(&operation.model)
        .bind(&operation.new_credential_ref)
        .bind(&operation.old_credential_ref)
        .bind(operation.updated_at)
        .execute(connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn load_operations(
        connection: &mut SqliteConnection,
    ) -> Result<Vec<CredentialOperation>, ProviderError> {
        let rows = sqlx::query(
            "SELECT id, provider_id, operation, base_endpoint, model, new_credential_ref, \
                    old_credential_ref, updated_at \
             FROM provider_credential_operations ORDER BY rowid ASC",
        )
        .fetch_all(connection)
        .await?;
        rows.into_iter().map(decode_operation).collect()
    }

    pub(crate) async fn delete_operation(
        connection: &mut SqliteConnection,
        id: &str,
    ) -> Result<(), ProviderError> {
        sqlx::query("DELETE FROM provider_credential_operations WHERE id = ?1")
            .bind(id)
            .execute(connection)
            .await?;
        Ok(())
    }

    pub(crate) async fn get_setting(
        connection: &mut SqliteConnection,
        key: &str,
    ) -> Result<Option<String>, ProviderError> {
        let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(connection)
            .await?;
        row.map(|row| row.try_get("value"))
            .transpose()
            .map_err(Into::into)
    }

    pub(crate) async fn set_setting(
        connection: &mut SqliteConnection,
        key: &str,
        value: &str,
    ) -> Result<(), ProviderError> {
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn delete_setting_value(
        connection: &mut SqliteConnection,
        key: &str,
        value: &str,
    ) -> Result<(), ProviderError> {
        sqlx::query("DELETE FROM app_settings WHERE key = ?1 AND value = ?2")
            .bind(key)
            .bind(value)
            .execute(connection)
            .await?;
        Ok(())
    }
}

fn decode_provider(row: SqliteRow) -> Result<Provider, ProviderError> {
    let protocol: String = row.try_get("protocol")?;
    let models_json: String = row.try_get("models")?;
    let models: Vec<String> =
        serde_json::from_str(&models_json).map_err(|_| ProviderError::Protocol)?;
    Ok(Provider {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        protocol: Protocol::from_db_text(&protocol)?,
        base_endpoint: row.try_get("base_endpoint")?,
        model: row.try_get("model")?,
        models,
        credential_ref: row.try_get("credential_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn decode_operation(row: SqliteRow) -> Result<CredentialOperation, ProviderError> {
    let operation: String = row.try_get("operation")?;
    let kind = match operation.as_str() {
        "save" => CredentialOperationKind::Save,
        "delete" => CredentialOperationKind::Delete,
        _ => return Err(ProviderError::Protocol),
    };
    Ok(CredentialOperation {
        id: row.try_get("id")?,
        provider_id: row.try_get("provider_id")?,
        kind,
        base_endpoint: row.try_get("base_endpoint")?,
        model: row.try_get("model")?,
        new_credential_ref: row.try_get("new_credential_ref")?,
        old_credential_ref: row.try_get("old_credential_ref")?,
        updated_at: row.try_get("updated_at")?,
    })
}
