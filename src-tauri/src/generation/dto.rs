//! Generation Channel, terminal, and binding wire types.
//!
//! `NodeDto` here is a wire-identical conversion from `conversations::Node`.
//! Phase 5 will own conversation/node DTOs in `conversations::dto`; until
//! then this is the only generation conversion site so protocol adapters
//! never import conversation types.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    conversations::{Node, Role},
    error::CommandError,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum RoleDto {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct NodeDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub conversation_id: String,
    pub role: RoleDto,
    pub content: String,
    pub model: Option<String>,
    pub created_at: i64,
    pub metadata: Value,
}

impl From<Role> for RoleDto {
    fn from(role: Role) -> Self {
        match role {
            Role::System => Self::System,
            Role::User => Self::User,
            Role::Assistant => Self::Assistant,
            Role::Tool => Self::Tool,
        }
    }
}

impl From<Node> for NodeDto {
    fn from(node: Node) -> Self {
        Self {
            id: node.id,
            parent_id: node.parent_id,
            conversation_id: node.conversation_id,
            role: node.role.into(),
            content: node.content,
            model: node.model,
            created_at: node.created_at,
            metadata: node.metadata,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GenerateFromActivePathRequest {
    pub conversation_id: String,
    pub active_node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CancelGenerationRequest {
    pub generation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CancelGenerationResult {
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationFailureStage {
    Generation,
    Persistence,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationEventDto {
    Started {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        conversation_id: String,
        active_node_id: String,
        model: String,
    },
    Delta {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        content: String,
    },
    ThinkingDelta {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        content: String,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationTerminalDto {
    Completed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        node: NodeDto,
    },
    Cancelled {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
    },
    Failed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        stage: GenerationFailureStage,
        error: CommandError,
    },
}

pub(crate) fn deserialize_uuid_v4<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if is_canonical_uuid_v4(&value) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom("expected canonical UUID v4"))
    }
}

pub(crate) fn is_canonical_uuid_v4(value: &str) -> bool {
    use uuid::Uuid;
    Uuid::parse_str(value)
        .ok()
        .filter(|parsed| parsed.get_version() == Some(uuid::Version::Random))
        .filter(|parsed| parsed.get_variant() == uuid::Variant::RFC4122)
        .is_some_and(|parsed| parsed.to_string() == value)
}
