pub mod commands;
pub mod dto;
mod error;
mod runtime;
mod service;
mod title;
mod title_prompt;

pub use error::GenerationError;
pub use runtime::GenerationRuntime;
pub use service::chat_prompt_from_path;

pub(crate) use runtime::GenerationLease;
pub(crate) use service::{
    prepare_generation, set_conversation_provider_binding, GenerationOutcome, GenerationStage,
};
pub(crate) use title::spawn_auto_title;
