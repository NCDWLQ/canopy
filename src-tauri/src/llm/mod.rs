pub mod adapters;
pub mod client;
pub mod domain;
pub mod error;
pub mod model_list;

pub use client::OpenAiCompatibleClient;
pub use domain::{
    ChatPrompt, GeneratedContent, MessageRole, PromptMessage, Protocol, ReasoningEffort,
    StreamingRequest, TitlePrompt, ValidatedEndpoint,
};
pub use error::LlmError;
