use thiserror::Error;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("stored setting value is invalid")]
    CorruptValue,

    #[error("settings storage failure")]
    Storage(#[from] sqlx::Error),
}
