use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LlmError {
    #[error("invalid LLM input")]
    InvalidInput {
        field: &'static str,
        reason: &'static str,
    },

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

    #[error("provider protocol failure")]
    Protocol,
}

impl LlmError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self::InvalidInput { field, reason }
    }
}
