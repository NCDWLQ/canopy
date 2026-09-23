use thiserror::Error;

#[derive(Debug, Error)]
pub enum UsageError {
    #[error("usage storage failure")]
    Storage(#[from] sqlx::Error),
}
