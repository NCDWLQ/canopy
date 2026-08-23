pub mod commands;
mod domain;
mod error;
mod repository;
mod service;

pub use domain::{
    Conversation, ConversationSearchResult, ConversationSummary, ConversationTree, NewConversation,
    NewNode, Node, ReasoningEffort, Role, SearchHit, UnknownRole, ValidatedPath,
};
pub use error::PersistenceError;
pub use service::{AutoTitleContext, ConversationPersistenceService};
