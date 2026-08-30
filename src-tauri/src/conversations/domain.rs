use std::fmt;

use serde_json::Value;

pub const MAX_TITLE_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleParseError {
    Blank,
    TooLong,
}

/// Shared display-title policy used by rename commands and auto-title cleanup.
/// Trims Unicode whitespace; rejects empty and >200-scalar values.
pub fn parse_title(title: &str) -> Result<String, TitleParseError> {
    let title = title.trim();
    if title.is_empty() {
        Err(TitleParseError::Blank)
    } else if title.chars().count() > MAX_TITLE_CHARS {
        Err(TitleParseError::TooLong)
    } else {
        Ok(title.to_owned())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub root_node_id: String,
    pub is_archived: bool,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub root_node_id: String,
    pub is_archived: bool,
    pub updated_at: i64,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
}

impl ReasoningEffort {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

impl TryFrom<&str> for ReasoningEffort {
    type Error = ();

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewConversation {
    pub id: String,
    pub title: String,
    pub root_node_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

impl Role {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
        }
    }
}

impl TryFrom<&str> for Role {
    type Error = UnknownRole;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "system" => Ok(Self::System),
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            "tool" => Ok(Self::Tool),
            _ => Err(UnknownRole),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownRole;

impl fmt::Display for UnknownRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("unknown persisted node role")
    }
}

impl std::error::Error for UnknownRole {}

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    pub model: Option<String>,
    pub created_at: i64,
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub conversation_id: String,
    pub role: Role,
    pub content: String,
    pub model: Option<String>,
    pub created_at: i64,
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConversationTree {
    pub conversation: Conversation,
    pub nodes: Vec<Node>,
}

/// One message-level search hit. `snippet` is a bounded window around the
/// first case-insensitive match, produced inside SQLite so a full (up to
/// 1 MiB) message content never crosses the repository boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub node_id: String,
    pub role: Role,
    pub created_at: i64,
    pub snippet: String,
}

/// Conversation-level search result. `hits` may be empty when only the
/// conversation title matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationSearchResult {
    pub conversation_id: String,
    pub title: String,
    pub is_archived: bool,
    pub title_matched: bool,
    pub updated_at: i64,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedPath(Vec<Node>);

impl ValidatedPath {
    pub fn as_slice(&self) -> &[Node] {
        &self.0
    }

    pub fn into_nodes(self) -> Vec<Node> {
        self.0
    }

    pub(crate) fn new(nodes: Vec<Node>) -> Self {
        Self(nodes)
    }
}

#[cfg(test)]
mod tests {
    use super::Role;

    #[test]
    fn role_decoding_is_closed() {
        assert_eq!(Role::try_from("system"), Ok(Role::System));
        assert_eq!(Role::try_from("user"), Ok(Role::User));
        assert_eq!(Role::try_from("assistant"), Ok(Role::Assistant));
        assert_eq!(Role::try_from("tool"), Ok(Role::Tool));
        assert!(Role::try_from("developer").is_err());
    }
}
