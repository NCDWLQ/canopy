use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::conversations::PersistenceError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCode {
    InvalidInput,
    NotFound,
    TreeIntegrity,
    DatabaseUnavailable,
    MigrationFailure,
    ProviderAuthentication,
    RateLimited,
    ProviderUnavailable,
    NetworkFailure,
    Cancelled,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl CommandError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self {
            code: CommandErrorCode::InvalidInput,
            message: "The request contains invalid input.".to_owned(),
            retryable: false,
            details: Some(json!({ "field": field, "reason": reason })),
        }
    }

    pub fn internal() -> Self {
        Self {
            code: CommandErrorCode::Internal,
            message: "An unexpected error occurred.".to_owned(),
            retryable: false,
            details: None,
        }
    }
}

impl From<PersistenceError> for CommandError {
    fn from(error: PersistenceError) -> Self {
        match error {
            PersistenceError::NotFound { entity } => Self {
                code: CommandErrorCode::NotFound,
                message: "The requested resource was not found.".to_owned(),
                retryable: false,
                details: Some(json!({ "entity": entity })),
            },
            PersistenceError::InvalidInput { operation, .. } => Self {
                code: CommandErrorCode::InvalidInput,
                message: "The requested operation is not allowed.".to_owned(),
                retryable: false,
                details: Some(json!({ "reason": operation })),
            },
            PersistenceError::TreeIntegrity { reason } => Self {
                code: CommandErrorCode::TreeIntegrity,
                message: "The conversation tree could not be validated.".to_owned(),
                retryable: false,
                details: Some(json!({ "reason": reason })),
            },
            PersistenceError::InvalidStoredData { field } => Self {
                code: CommandErrorCode::TreeIntegrity,
                message: "The conversation tree contains invalid stored data.".to_owned(),
                retryable: false,
                details: Some(json!({ "field": field })),
            },
            PersistenceError::DatabaseUnavailable => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "The conversation database is currently unavailable.".to_owned(),
                retryable: true,
                details: None,
            },
            PersistenceError::Storage(error) if is_transient_storage_error(&error) => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "The conversation database is currently unavailable.".to_owned(),
                retryable: true,
                details: None,
            },
            PersistenceError::Storage(_) => Self::internal(),
        }
    }
}

fn is_transient_storage_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed | sqlx::Error::Io(_) => true,
        sqlx::Error::Database(database_error) => database_error
            .code()
            .and_then(|code| code.parse::<i32>().ok())
            .is_some_and(|code| matches!(code & 0xff, 5 | 6)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CommandError, CommandErrorCode};
    use crate::conversations::PersistenceError;

    #[test]
    fn persistence_errors_map_to_safe_closed_codes() {
        let missing = CommandError::from(PersistenceError::NotFound { entity: "node" });
        assert_eq!(missing.code, CommandErrorCode::NotFound);
        assert!(!missing.retryable);
        assert_eq!(missing.details, Some(json!({ "entity": "node" })));

        let unavailable = CommandError::from(PersistenceError::DatabaseUnavailable);
        assert_eq!(unavailable.code, CommandErrorCode::DatabaseUnavailable);
        assert!(unavailable.retryable);

        let corrupt = CommandError::from(PersistenceError::InvalidStoredData { field: "role" });
        assert_eq!(corrupt.code, CommandErrorCode::TreeIntegrity);
    }

    #[test]
    fn absent_details_are_omitted_from_serialization() {
        assert_eq!(
            serde_json::to_value(CommandError::internal()).expect("error serializes"),
            json!({
                "code": "internal",
                "message": "An unexpected error occurred.",
                "retryable": false
            })
        );
    }
}
