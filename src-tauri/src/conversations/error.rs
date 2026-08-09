use sqlx::error::ErrorKind;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("requested {entity} was not found")]
    NotFound { entity: &'static str },

    #[error("invalid input for {operation}")]
    InvalidInput {
        operation: &'static str,
        #[source]
        source: Option<sqlx::Error>,
    },

    #[error("conversation tree integrity failure: {reason}")]
    TreeIntegrity { reason: &'static str },

    #[error("invalid stored value in {field}")]
    InvalidStoredData { field: &'static str },

    #[error("the managed application database is unavailable")]
    DatabaseUnavailable,

    #[error("storage operation failed")]
    Storage(#[from] sqlx::Error),
}

impl PersistenceError {
    pub(crate) fn invalid_input(operation: &'static str) -> Self {
        Self::InvalidInput {
            operation,
            source: None,
        }
    }

    pub(crate) fn from_write(operation: &'static str, error: sqlx::Error) -> Self {
        let is_known_rejection = match &error {
            sqlx::Error::Database(database_error) => {
                matches!(
                    database_error.kind(),
                    ErrorKind::UniqueViolation
                        | ErrorKind::ForeignKeyViolation
                        | ErrorKind::NotNullViolation
                        | ErrorKind::CheckViolation
                ) || [
                    "designated_root_must_be_structural_root",
                    "designated_root_cannot_be_archived",
                    "node_history_is_immutable",
                    "node_history_cannot_be_deleted",
                    "conversation_identity_and_root_are_immutable",
                    "node_archive_is_not_supported",
                    "archived_conversation_is_read_only",
                    "conversation_archive_is_forward_only",
                ]
                .iter()
                .any(|marker| database_error.message().contains(marker))
            }
            _ => false,
        };

        if is_known_rejection {
            Self::InvalidInput {
                operation,
                source: Some(error),
            }
        } else {
            Self::Storage(error)
        }
    }
}
