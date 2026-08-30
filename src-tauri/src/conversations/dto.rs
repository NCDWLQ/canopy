use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    Conversation, ConversationSearchResult, ConversationSummary, ConversationTree, Node,
    ReasoningEffort, Role, SearchHit, ValidatedPath,
};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CreateConversationRequest {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct AppendNodeRequest {
    pub conversation_id: String,
    pub parent_node_id: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CreateBranchRequest {
    pub conversation_id: String,
    pub parent_node_id: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct EditNodeAsBranchRequest {
    pub conversation_id: String,
    pub source_node_id: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoadConversationTreeRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ListConversationsRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoadActivePathRequest {
    pub conversation_id: String,
    pub active_node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ArchiveConversationRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct RenameConversationRequest {
    pub conversation_id: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteConversationRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UnarchiveConversationRequest {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteConversationSuccess {
    pub conversation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ConversationProviderBindingDto {
    pub provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningEffortDto {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetConversationProviderRequest {
    pub conversation_id: String,
    pub binding: Option<ConversationProviderBindingDto>,
    pub reasoning_effort: Option<ReasoningEffortDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SearchConversationsRequest {
    pub query: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetConversationSystemPromptRequest {
    pub conversation_id: String,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetConversationSystemPromptResult {
    pub conversation_id: String,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SearchHitDto {
    pub node_id: String,
    pub role: RoleDto,
    pub created_at: i64,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ConversationSearchResultDto {
    pub conversation_id: String,
    pub title: String,
    pub is_archived: bool,
    pub title_matched: bool,
    pub updated_at: i64,
    pub hits: Vec<SearchHitDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ConversationProviderBindingResult {
    pub conversation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffortDto>,
}

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
pub struct ConversationDto {
    pub id: String,
    pub title: String,
    pub root_node_id: String,
    pub is_archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffortDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ConversationSummaryDto {
    pub id: String,
    pub title: String,
    pub root_node_id: String,
    pub is_archived: bool,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffortDto>,
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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ConversationTreeDto {
    pub conversation: ConversationDto,
    pub nodes: Vec<NodeDto>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ActivePathDto {
    pub conversation_id: String,
    pub active_node_id: String,
    pub nodes: Vec<NodeDto>,
}

/// Binding model as exposed over IPC. A provider deletion nulls
/// `conversations.provider_id` (FK SET NULL) but leaves the bound `model`
/// column behind; the leftover belongs to the deleted provider, so it must
/// not surface as a conversation binding value.
fn binding_model(provider_id: &Option<String>, model: &Option<String>) -> Option<String> {
    model.clone().filter(|_| provider_id.is_some())
}

impl From<Conversation> for ConversationDto {
    fn from(conversation: Conversation) -> Self {
        Self {
            id: conversation.id,
            title: conversation.title,
            root_node_id: conversation.root_node_id,
            is_archived: conversation.is_archived,
            provider_id: conversation.provider_id.clone(),
            model: binding_model(&conversation.provider_id, &conversation.model),
            reasoning_effort: conversation.reasoning_effort.map(Into::into),
            system_prompt: conversation.system_prompt,
        }
    }
}

impl From<ConversationSummary> for ConversationSummaryDto {
    fn from(summary: ConversationSummary) -> Self {
        Self {
            id: summary.id,
            title: summary.title,
            root_node_id: summary.root_node_id,
            is_archived: summary.is_archived,
            updated_at: summary.updated_at,
            provider_id: summary.provider_id.clone(),
            model: binding_model(&summary.provider_id, &summary.model),
            reasoning_effort: summary.reasoning_effort.map(Into::into),
        }
    }
}

impl From<ReasoningEffort> for ReasoningEffortDto {
    fn from(effort: ReasoningEffort) -> Self {
        match effort {
            ReasoningEffort::Low => Self::Low,
            ReasoningEffort::Medium => Self::Medium,
            ReasoningEffort::High => Self::High,
        }
    }
}

impl From<ReasoningEffortDto> for ReasoningEffort {
    fn from(effort: ReasoningEffortDto) -> Self {
        match effort {
            ReasoningEffortDto::Low => Self::Low,
            ReasoningEffortDto::Medium => Self::Medium,
            ReasoningEffortDto::High => Self::High,
        }
    }
}

impl From<Conversation> for ConversationProviderBindingResult {
    fn from(conversation: Conversation) -> Self {
        Self {
            conversation_id: conversation.id,
            provider_id: conversation.provider_id.clone(),
            model: binding_model(&conversation.provider_id, &conversation.model),
            reasoning_effort: conversation.reasoning_effort.map(Into::into),
        }
    }
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

impl From<SearchHit> for SearchHitDto {
    fn from(hit: SearchHit) -> Self {
        Self {
            node_id: hit.node_id,
            role: hit.role.into(),
            created_at: hit.created_at,
            snippet: hit.snippet,
        }
    }
}

impl From<ConversationSearchResult> for ConversationSearchResultDto {
    fn from(result: ConversationSearchResult) -> Self {
        Self {
            conversation_id: result.conversation_id,
            title: result.title,
            is_archived: result.is_archived,
            title_matched: result.title_matched,
            updated_at: result.updated_at,
            hits: result.hits.into_iter().map(SearchHitDto::from).collect(),
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

impl From<ConversationTree> for ConversationTreeDto {
    fn from(tree: ConversationTree) -> Self {
        Self {
            conversation: tree.conversation.into(),
            nodes: tree.nodes.into_iter().map(NodeDto::from).collect(),
        }
    }
}

impl ActivePathDto {
    pub(crate) fn from_path(
        conversation_id: String,
        active_node_id: String,
        path: ValidatedPath,
    ) -> Self {
        Self {
            conversation_id,
            active_node_id,
            nodes: path.into_nodes().into_iter().map(NodeDto::from).collect(),
        }
    }
}
