use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use super::{
    Conversation, ConversationPersistenceService, ConversationSummary, ConversationTree,
    NewConversation, NewNode, Node, ReasoningEffort, Role, ValidatedPath,
};
use crate::database::managed_sqlite_pool;
use crate::diagnostics::logging::log_command;
use crate::error::CommandError;
use crate::providers::domain::validate_model;

const MAX_TITLE_CHARS: usize = 200;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;

pub const CONVERSATION_COMMAND_NAMES: &[&str] = &[
    "create_conversation",
    "append_node",
    "create_branch",
    "edit_node_as_branch",
    "list_conversations",
    "load_conversation_tree",
    "load_active_path",
    "archive_conversation",
    "set_conversation_provider",
];

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

pub trait IdentityTimeSource: Clone + Send + Sync + 'static {
    fn new_id(&self) -> String;
    fn now_millis(&self) -> i64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemIdentityTimeSource;

impl IdentityTimeSource for SystemIdentityTimeSource {
    fn new_id(&self) -> String {
        Uuid::new_v4().to_string()
    }

    fn now_millis(&self) -> i64 {
        let milliseconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        i64::try_from(milliseconds).unwrap_or(i64::MAX)
    }
}

#[derive(Debug, Clone)]
pub struct ConversationCommandService<S> {
    persistence: ConversationPersistenceService,
    source: S,
}

impl<S: IdentityTimeSource> ConversationCommandService<S> {
    pub fn new(persistence: ConversationPersistenceService, source: S) -> Self {
        Self {
            persistence,
            source,
        }
    }

    pub async fn create_conversation(
        &self,
        request: CreateConversationRequest,
    ) -> Result<ConversationTreeDto, CommandError> {
        let title = validate_title(&request.title)?;
        validate_content(&request.content)?;
        let conversation_id = self.source.new_id();
        let root_node_id = self.source.new_id();
        let created_at = self.source.now_millis();
        let tree = self
            .persistence
            .create_conversation(
                NewConversation {
                    id: conversation_id.clone(),
                    title,
                    root_node_id: root_node_id.clone(),
                },
                user_node(
                    root_node_id,
                    None,
                    conversation_id,
                    request.content,
                    created_at,
                ),
            )
            .await
            .map_err(CommandError::from)?;
        Ok(tree.into())
    }

    pub async fn append_node(&self, request: AppendNodeRequest) -> Result<NodeDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        validate_id("parent_node_id", &request.parent_node_id)?;
        validate_content(&request.content)?;
        let node = user_node(
            self.source.new_id(),
            Some(request.parent_node_id),
            request.conversation_id,
            request.content,
            self.source.now_millis(),
        );
        self.persistence
            .append_user_node(node)
            .await
            .map(NodeDto::from)
            .map_err(CommandError::from)
    }

    pub async fn create_branch(
        &self,
        request: CreateBranchRequest,
    ) -> Result<NodeDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        validate_id("parent_node_id", &request.parent_node_id)?;
        validate_content(&request.content)?;
        let node = user_node(
            self.source.new_id(),
            Some(request.parent_node_id),
            request.conversation_id,
            request.content,
            self.source.now_millis(),
        );
        self.persistence
            .create_branch(node)
            .await
            .map(NodeDto::from)
            .map_err(CommandError::from)
    }

    pub async fn edit_node_as_branch(
        &self,
        request: EditNodeAsBranchRequest,
    ) -> Result<NodeDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        validate_id("source_node_id", &request.source_node_id)?;
        validate_content(&request.content)?;
        let node = user_node(
            self.source.new_id(),
            None,
            request.conversation_id,
            request.content,
            self.source.now_millis(),
        );
        self.persistence
            .edit_node_as_branch(&request.source_node_id, node)
            .await
            .map(NodeDto::from)
            .map_err(CommandError::from)
    }

    pub async fn load_conversation_tree(
        &self,
        request: LoadConversationTreeRequest,
    ) -> Result<ConversationTreeDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        self.persistence
            .load_conversation_tree(&request.conversation_id)
            .await
            .map(ConversationTreeDto::from)
            .map_err(CommandError::from)
    }

    pub async fn list_conversations(
        &self,
        _request: ListConversationsRequest,
    ) -> Result<Vec<ConversationSummaryDto>, CommandError> {
        self.persistence
            .list_conversations()
            .await
            .map(|summaries| {
                summaries
                    .into_iter()
                    .map(ConversationSummaryDto::from)
                    .collect()
            })
            .map_err(CommandError::from)
    }

    pub async fn load_active_path(
        &self,
        request: LoadActivePathRequest,
    ) -> Result<ActivePathDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        validate_id("active_node_id", &request.active_node_id)?;
        let conversation_id = request.conversation_id;
        let active_node_id = request.active_node_id;
        self.persistence
            .load_active_path(&conversation_id, &active_node_id)
            .await
            .map(|path| ActivePathDto::from_path(conversation_id, active_node_id, path))
            .map_err(CommandError::from)
    }

    pub async fn archive_conversation(
        &self,
        request: ArchiveConversationRequest,
    ) -> Result<ConversationDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        self.persistence
            .archive_conversation(&request.conversation_id)
            .await
            .map(ConversationDto::from)
            .map_err(CommandError::from)
    }

    pub async fn set_conversation_provider(
        &self,
        request: SetConversationProviderRequest,
    ) -> Result<ConversationProviderBindingResult, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        let (provider_id, model) = match request.binding {
            Some(binding) => {
                validate_id("provider_id", &binding.provider_id)?;
                let model = validate_model(&binding.model).map_err(CommandError::from)?;
                (Some(binding.provider_id), Some(model))
            }
            None => (None, None),
        };
        self.persistence
            .set_provider_binding(
                &request.conversation_id,
                provider_id,
                model,
                request.reasoning_effort.map(Into::into),
            )
            .await
            .map(ConversationProviderBindingResult::from)
            .map_err(CommandError::from)
    }
}

pub(crate) fn validate_title(title: &str) -> Result<String, CommandError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(CommandError::invalid_input("title", "blank"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(CommandError::invalid_input("title", "too_long"));
    }
    Ok(title.to_owned())
}

fn validate_content(content: &str) -> Result<(), CommandError> {
    if content.trim().is_empty() {
        return Err(CommandError::invalid_input("content", "blank"));
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(CommandError::invalid_input("content", "too_large"));
    }
    Ok(())
}

fn validate_id(field: &'static str, id: &str) -> Result<(), CommandError> {
    if id.trim().is_empty() {
        Err(CommandError::invalid_input(field, "blank"))
    } else {
        Ok(())
    }
}

fn user_node(
    id: String,
    parent_id: Option<String>,
    conversation_id: String,
    content: String,
    created_at: i64,
) -> NewNode {
    NewNode {
        id,
        parent_id,
        conversation_id,
        role: Role::User,
        content,
        model: None,
        created_at,
        metadata: json!({}),
    }
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
    fn from_path(conversation_id: String, active_node_id: String, path: ValidatedPath) -> Self {
        Self {
            conversation_id,
            active_node_id,
            nodes: path.into_nodes().into_iter().map(NodeDto::from).collect(),
        }
    }
}

async fn production_service(
    instances: &DbInstances,
) -> Result<ConversationCommandService<SystemIdentityTimeSource>, CommandError> {
    let pool = managed_sqlite_pool(instances)
        .await
        .map_err(CommandError::from)?;
    Ok(ConversationCommandService::new(
        ConversationPersistenceService::new(pool),
        SystemIdentityTimeSource,
    ))
}

#[tauri::command]
pub async fn create_conversation(
    request: CreateConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationTreeDto, CommandError> {
    log_command("create_conversation", Some("completed"), None, async {
        production_service(instances.inner())
            .await?
            .create_conversation(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn append_node(
    request: AppendNodeRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    log_command("append_node", Some("completed"), None, async {
        production_service(instances.inner())
            .await?
            .append_node(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn create_branch(
    request: CreateBranchRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    log_command("create_branch", Some("completed"), None, async {
        production_service(instances.inner())
            .await?
            .create_branch(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn edit_node_as_branch(
    request: EditNodeAsBranchRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    log_command("edit_node_as_branch", Some("completed"), None, async {
        production_service(instances.inner())
            .await?
            .edit_node_as_branch(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn load_conversation_tree(
    request: LoadConversationTreeRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationTreeDto, CommandError> {
    log_command("load_conversation_tree", None, None, async {
        production_service(instances.inner())
            .await?
            .load_conversation_tree(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn list_conversations(
    request: ListConversationsRequest,
    instances: State<'_, DbInstances>,
) -> Result<Vec<ConversationSummaryDto>, CommandError> {
    log_command("list_conversations", None, None, async {
        production_service(instances.inner())
            .await?
            .list_conversations(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn load_active_path(
    request: LoadActivePathRequest,
    instances: State<'_, DbInstances>,
) -> Result<ActivePathDto, CommandError> {
    log_command("load_active_path", None, None, async {
        production_service(instances.inner())
            .await?
            .load_active_path(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn archive_conversation(
    request: ArchiveConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationDto, CommandError> {
    log_command("archive_conversation", Some("completed"), None, async {
        production_service(instances.inner())
            .await?
            .archive_conversation(request)
            .await
    })
    .await
}

#[tauri::command]
pub async fn set_conversation_provider(
    request: SetConversationProviderRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationProviderBindingResult, CommandError> {
    log_command(
        "set_conversation_provider",
        Some("completed"),
        None,
        async {
            production_service(instances.inner())
                .await?
                .set_conversation_provider(request)
                .await
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{validate_content, validate_title, CONVERSATION_COMMAND_NAMES};
    use crate::error::CommandErrorCode;

    #[test]
    fn command_names_are_frozen() {
        assert_eq!(CONVERSATION_COMMAND_NAMES.len(), 9);
        assert_eq!(CONVERSATION_COMMAND_NAMES[0], "create_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[8], "set_conversation_provider");
    }

    #[test]
    fn input_validation_trims_only_titles_and_uses_utf8_content_limit() {
        assert_eq!(validate_title("  kept title  ").unwrap(), "kept title");
        assert_eq!(
            validate_title(&"界".repeat(201)).unwrap_err().code,
            CommandErrorCode::InvalidInput
        );
        assert!(validate_title(&"界".repeat(200)).is_ok());
        assert_eq!(
            validate_content(" \n\t ").unwrap_err().code,
            CommandErrorCode::InvalidInput
        );
        assert_eq!(
            validate_content("\u{0085}").unwrap_err().code,
            CommandErrorCode::InvalidInput
        );
        assert_eq!(
            validate_title("\u{0085}").unwrap_err().code,
            CommandErrorCode::InvalidInput
        );
        assert_eq!(
            validate_title("\u{0085}  Rust whitespace  \u{0085}").unwrap(),
            "Rust whitespace"
        );
        assert!(validate_content("\u{feff}").is_ok());
        assert!(validate_content(&"a".repeat(1024 * 1024)).is_ok());
        assert_eq!(
            validate_content(&"a".repeat(1024 * 1024 + 1))
                .unwrap_err()
                .code,
            CommandErrorCode::InvalidInput
        );
    }
}
