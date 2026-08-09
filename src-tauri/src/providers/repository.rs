use sqlx::{sqlite::SqliteRow, Row, SqliteConnection};

use super::{domain::PROFILE_ID, ProviderError, ProviderProfile};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialOperationKind {
    Save,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CredentialOperation {
    pub id: String,
    pub kind: CredentialOperationKind,
    pub base_endpoint: Option<String>,
    pub model: Option<String>,
    pub new_credential_ref: Option<String>,
    pub old_credential_ref: Option<String>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Default)]
pub(crate) struct ProviderProfileRepository;

impl ProviderProfileRepository {
    pub(crate) async fn load_profile(
        connection: &mut SqliteConnection,
    ) -> Result<Option<ProviderProfile>, ProviderError> {
        let row = sqlx::query(
            "SELECT base_endpoint, model, credential_ref, updated_at \
             FROM provider_profiles WHERE id = ?1",
        )
        .bind(PROFILE_ID)
        .fetch_optional(connection)
        .await?;
        row.map(decode_profile).transpose()
    }

    pub(crate) async fn upsert_profile(
        connection: &mut SqliteConnection,
        profile: &ProviderProfile,
    ) -> Result<(), ProviderError> {
        sqlx::query(
            "INSERT INTO provider_profiles \
               (id, base_endpoint, model, credential_ref, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(id) DO UPDATE SET \
               base_endpoint = excluded.base_endpoint, model = excluded.model, \
               credential_ref = excluded.credential_ref, updated_at = excluded.updated_at",
        )
        .bind(PROFILE_ID)
        .bind(&profile.base_endpoint)
        .bind(&profile.model)
        .bind(&profile.credential_ref)
        .bind(profile.updated_at)
        .execute(connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn delete_profile(
        connection: &mut SqliteConnection,
    ) -> Result<bool, ProviderError> {
        Ok(sqlx::query("DELETE FROM provider_profiles WHERE id = ?1")
            .bind(PROFILE_ID)
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
               (id, operation, base_endpoint, model, new_credential_ref, \
                old_credential_ref, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(&operation.id)
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
            "SELECT id, operation, base_endpoint, model, new_credential_ref, \
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
}

fn decode_profile(row: SqliteRow) -> Result<ProviderProfile, ProviderError> {
    Ok(ProviderProfile {
        base_endpoint: row.try_get("base_endpoint")?,
        model: row.try_get("model")?,
        credential_ref: row.try_get("credential_ref")?,
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
        kind,
        base_endpoint: row.try_get("base_endpoint")?,
        model: row.try_get("model")?,
        new_credential_ref: row.try_get("new_credential_ref")?,
        old_credential_ref: row.try_get("old_credential_ref")?,
        updated_at: row.try_get("updated_at")?,
    })
}
