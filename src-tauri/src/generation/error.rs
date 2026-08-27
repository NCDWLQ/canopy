use thiserror::Error;

use crate::{conversations::PersistenceError, llm::LlmError, providers::ProviderError};

/// Application-workflow failures for reply generation, cancellation, and
/// conversation-provider binding. Domain errors are composed transparently so
/// the CommandError mapper can keep historical codes and Chinese messages.
#[derive(Debug, Error)]
pub enum GenerationError {
    #[error("invalid generation input")]
    InvalidInput {
        field: &'static str,
        reason: &'static str,
    },

    #[error("a generation is already active for this conversation")]
    AlreadyActive,

    #[error("generation runtime invariant failure")]
    RuntimeInvariant,

    #[error("persistence failure")]
    Persistence(#[from] PersistenceError),

    #[error("provider failure")]
    Provider(#[from] ProviderError),

    #[error(transparent)]
    Llm(#[from] LlmError),
}

impl GenerationError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self::InvalidInput { field, reason }
    }
}

impl From<sqlx::Error> for GenerationError {
    fn from(error: sqlx::Error) -> Self {
        Self::Persistence(PersistenceError::from(error))
    }
}
