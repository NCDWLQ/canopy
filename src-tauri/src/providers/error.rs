use thiserror::Error;

use crate::{llm::LlmError, settings::SettingsError};

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

    #[error("provider storage failure")]
    Storage(#[from] sqlx::Error),

    #[error(transparent)]
    Llm(#[from] LlmError),
}

impl ProviderError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self::InvalidInput { field, reason }
    }
}

impl From<SettingsError> for ProviderError {
    fn from(error: SettingsError) -> Self {
        match error {
            SettingsError::CorruptValue => Self::Llm(LlmError::Protocol),
            SettingsError::Storage(error) => Self::Storage(error),
        }
    }
}
