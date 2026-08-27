pub mod commands;
mod domain;
pub mod dto;
mod error;
mod repository;
mod service;

pub(crate) use domain::{parse_title, TitleParseError, MAX_TITLE_CHARS};
pub use domain::{
    Conversation, ConversationSearchResult, ConversationSummary, ConversationTree, NewConversation,
    NewNode, Node, ReasoningEffort, Role, SearchHit, UnknownRole, ValidatedPath,
};
pub use error::PersistenceError;
pub use service::{AutoTitleContext, ConversationPersistenceService};
