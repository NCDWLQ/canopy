pub mod commands;
pub mod credentials;
pub mod domain;
pub mod error;
pub mod generation;
mod repository;
pub mod service;
mod title_prompt;
mod titles;

pub use credentials::{CredentialStore, NativeCredentialStore};
pub use domain::{
    ApiKeyAction, Protocol, Provider, ProviderInput, RedactedProvider, ValidatedEndpoint,
    MIGRATED_PROVIDER_ID, MIGRATED_PROVIDER_NAME,
};
pub use error::ProviderError;
pub use generation::{chat_prompt_from_path, GenerationRuntime};
pub use service::ProviderService;

pub use crate::llm::adapters::{anthropic, openai_compatible};
pub use crate::llm::model_list;
pub use crate::settings::{LanguagePreference, ThemePreference, TitleModelBinding};
