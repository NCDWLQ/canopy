use thiserror::Error;

use crate::conversations::PersistenceError;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("invalid provider input")]
    InvalidInput {
        field: &'static str,
        reason: &'static str,
    },

    #[error("provider profile was not found")]
    ProfileNotFound,

    #[error("provider credential is missing")]
    CredentialMissing,

    #[error("native credential storage is unavailable")]
    CredentialUnavailable,

    #[error("a generation is already active for this conversation")]
    GenerationAlreadyActive,

    #[error("provider rejected authentication")]
    Authentication,

    #[error("provider rate limit")]
    RateLimited { retry_after_ms: Option<u64> },

    #[error("provider is unavailable")]
    Unavailable,

    #[error("provider network failure")]
    Network,

    #[error("generation was cancelled")]
    Cancelled,

    #[error("provider runtime invariant failure")]
    RuntimeInvariant,

    #[error("provider protocol failure")]
    Protocol,

    #[error("persistence failure")]
    Persistence(#[from] PersistenceError),

    #[error("provider storage failure")]
    Storage(#[from] sqlx::Error),
}

impl ProviderError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self::InvalidInput { field, reason }
    }
}
