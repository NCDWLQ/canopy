use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use super::{
    parse_title, Conversation, ConversationPersistenceService, ConversationSearchResult,
    ConversationSummary, ConversationTree, NewConversation, NewNode, Node, ReasoningEffort, Role,
    SearchHit, TitleParseError, ValidatedPath, MAX_TITLE_CHARS,
};
use crate::error::CommandError;
use crate::infra::database::managed_sqlite_pool;

pub use crate::infra::identity::{IdentityTimeSource, SystemIdentityTimeSource};

const MAX_CONTENT_BYTES: usize = 1024 * 1024;
// Exports aggregate many nodes (plus headings), so the cap keeps generous
// headroom above the 1 MiB per-node limit instead of reusing it.
const MAX_EXPORT_CONTENT_BYTES: usize = 16 * 1024 * 1024;

pub const CONVERSATION_COMMAND_NAMES: &[&str] = &[
    "create_conversation",
    "append_node",
    "create_branch",
    "edit_node_as_branch",
    "list_conversations",
    "load_conversation_tree",
    "load_active_path",
    "archive_conversation",
    "rename_conversation",
    "delete_conversation",
    "unarchive_conversation",
    "set_conversation_provider", // handler lives in generation::commands; name stays for the frozen conversation fixture
    "search_conversations",
    "write_export_file",
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

/// Path and content for a Markdown export. The path always originates from
/// the native save dialog; the webview never gains direct filesystem access.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct WriteExportFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct WriteExportFileResponse {
    pub bytes_written: u64,
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

    pub async fn rename_conversation(
        &self,
        request: RenameConversationRequest,
    ) -> Result<ConversationDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        let title = validate_title(&request.title)?;
        self.persistence
            .rename_conversation(&request.conversation_id, &title)
            .await
            .map(ConversationDto::from)
            .map_err(CommandError::from)
    }

    pub async fn delete_conversation(
        &self,
        request: DeleteConversationRequest,
    ) -> Result<DeleteConversationSuccess, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        self.persistence
            .delete_conversation(&request.conversation_id)
            .await
            .map_err(CommandError::from)?;
        Ok(DeleteConversationSuccess {
            conversation_id: request.conversation_id,
        })
    }

    pub async fn unarchive_conversation(
        &self,
        request: UnarchiveConversationRequest,
    ) -> Result<ConversationDto, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        self.persistence
            .unarchive_conversation(&request.conversation_id)
            .await
            .map(ConversationDto::from)
            .map_err(CommandError::from)
    }

    pub async fn search_conversations(
        &self,
        request: SearchConversationsRequest,
    ) -> Result<Vec<ConversationSearchResultDto>, CommandError> {
        let query = validate_query(&request.query)?;
        self.persistence
            .search_conversations(&query)
            .await
            .map(|results| {
                results
                    .into_iter()
                    .map(ConversationSearchResultDto::from)
                    .collect()
            })
            .map_err(CommandError::from)
    }

    pub async fn write_export_file(
        &self,
        request: WriteExportFileRequest,
    ) -> Result<WriteExportFileResponse, CommandError> {
        let bytes_written = write_export_file_bytes(&request.path, &request.content)?;
        Ok(WriteExportFileResponse { bytes_written })
    }
}

pub(crate) fn validate_title(title: &str) -> Result<String, CommandError> {
    parse_title(title).map_err(|error| match error {
        TitleParseError::Blank => CommandError::invalid_input("title", "blank"),
        TitleParseError::TooLong => CommandError::invalid_input("title", "too_long"),
    })
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

fn validate_query(query: &str) -> Result<String, CommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(CommandError::invalid_input("query", "blank"));
    }
    if query.chars().count() > MAX_TITLE_CHARS {
        return Err(CommandError::invalid_input("query", "too_long"));
    }
    Ok(query.to_owned())
}

fn validate_export_content(content: &str) -> Result<(), CommandError> {
    if content.trim().is_empty() {
        return Err(CommandError::invalid_input("content", "blank"));
    }
    if content.len() > MAX_EXPORT_CONTENT_BYTES {
        return Err(CommandError::invalid_input("content", "too_large"));
    }
    Ok(())
}

/// Validate and write one export file. Split from the service method so the
/// policy (rejections, IO error mapping) is unit-testable without a database
/// pool. Blocking by design: a single bounded write (16 MiB cap) performed on
/// the command task.
fn write_export_file_bytes(path: &str, content: &str) -> Result<u64, CommandError> {
    validate_id("path", path)?;
    validate_export_content(content)?;
    std::fs::write(path, content).map_err(|_| CommandError::export_file_write())?;
    Ok(u64::try_from(content.len()).unwrap_or(u64::MAX))
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
    production_service(instances.inner())
        .await?
        .create_conversation(request)
        .await
}

#[tauri::command]
pub async fn append_node(
    request: AppendNodeRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    production_service(instances.inner())
        .await?
        .append_node(request)
        .await
}

#[tauri::command]
pub async fn create_branch(
    request: CreateBranchRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    production_service(instances.inner())
        .await?
        .create_branch(request)
        .await
}

#[tauri::command]
pub async fn edit_node_as_branch(
    request: EditNodeAsBranchRequest,
    instances: State<'_, DbInstances>,
) -> Result<NodeDto, CommandError> {
    production_service(instances.inner())
        .await?
        .edit_node_as_branch(request)
        .await
}

#[tauri::command]
pub async fn load_conversation_tree(
    request: LoadConversationTreeRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationTreeDto, CommandError> {
    production_service(instances.inner())
        .await?
        .load_conversation_tree(request)
        .await
}

#[tauri::command]
pub async fn list_conversations(
    request: ListConversationsRequest,
    instances: State<'_, DbInstances>,
) -> Result<Vec<ConversationSummaryDto>, CommandError> {
    production_service(instances.inner())
        .await?
        .list_conversations(request)
        .await
}

#[tauri::command]
pub async fn load_active_path(
    request: LoadActivePathRequest,
    instances: State<'_, DbInstances>,
) -> Result<ActivePathDto, CommandError> {
    production_service(instances.inner())
        .await?
        .load_active_path(request)
        .await
}

#[tauri::command]
pub async fn archive_conversation(
    request: ArchiveConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationDto, CommandError> {
    production_service(instances.inner())
        .await?
        .archive_conversation(request)
        .await
}

#[tauri::command]
pub async fn rename_conversation(
    request: RenameConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationDto, CommandError> {
    production_service(instances.inner())
        .await?
        .rename_conversation(request)
        .await
}

#[tauri::command]
pub async fn delete_conversation(
    request: DeleteConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<DeleteConversationSuccess, CommandError> {
    production_service(instances.inner())
        .await?
        .delete_conversation(request)
        .await
}

#[tauri::command]
pub async fn unarchive_conversation(
    request: UnarchiveConversationRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationDto, CommandError> {
    production_service(instances.inner())
        .await?
        .unarchive_conversation(request)
        .await
}

#[tauri::command]
pub async fn search_conversations(
    request: SearchConversationsRequest,
    instances: State<'_, DbInstances>,
) -> Result<Vec<ConversationSearchResultDto>, CommandError> {
    production_service(instances.inner())
        .await?
        .search_conversations(request)
        .await
}

#[tauri::command]
pub async fn write_export_file(
    request: WriteExportFileRequest,
    instances: State<'_, DbInstances>,
) -> Result<WriteExportFileResponse, CommandError> {
    production_service(instances.inner())
        .await?
        .write_export_file(request)
        .await
}

#[cfg(test)]
mod tests {
    use super::{
        validate_content, validate_query, validate_title, write_export_file_bytes,
        CONVERSATION_COMMAND_NAMES,
    };
    use crate::error::CommandErrorCode;

    #[test]
    fn command_names_are_frozen() {
        assert_eq!(CONVERSATION_COMMAND_NAMES.len(), 14);
        assert_eq!(CONVERSATION_COMMAND_NAMES[0], "create_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[8], "rename_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[9], "delete_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[10], "unarchive_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[11], "set_conversation_provider");
        assert_eq!(CONVERSATION_COMMAND_NAMES[12], "search_conversations");
        assert_eq!(CONVERSATION_COMMAND_NAMES[13], "write_export_file");
    }

    #[test]
    fn search_query_is_trimmed_and_bounded() {
        assert_eq!(validate_query("  团结  ").unwrap(), "团结");
        let blank = validate_query(" \n\t ").unwrap_err();
        assert_eq!(blank.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            blank.details,
            Some(serde_json::json!({ "field": "query", "reason": "blank" }))
        );
        let oversized = validate_query(&"词".repeat(201)).unwrap_err();
        assert_eq!(oversized.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            oversized.details,
            Some(serde_json::json!({ "field": "query", "reason": "too_long" }))
        );
        assert!(validate_query(&"词".repeat(200)).is_ok());
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

    #[test]
    fn export_write_rejects_blank_and_oversized_requests() {
        let blank_path = write_export_file_bytes("  ", "# title").unwrap_err();
        assert_eq!(blank_path.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            blank_path.details,
            Some(serde_json::json!({ "field": "path", "reason": "blank" }))
        );

        let blank_content = write_export_file_bytes("/tmp/canopy-export.md", " \n\t ").unwrap_err();
        assert_eq!(blank_content.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            blank_content.details,
            Some(serde_json::json!({ "field": "content", "reason": "blank" }))
        );

        let oversized =
            write_export_file_bytes("/tmp/canopy-export.md", &"a".repeat(16 * 1024 * 1024 + 1))
                .unwrap_err();
        assert_eq!(oversized.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            oversized.details,
            Some(serde_json::json!({ "field": "content", "reason": "too_large" }))
        );
    }

    #[test]
    fn export_write_maps_io_failure_to_export_file_write_envelope() {
        // A missing parent directory fails with ENOENT for every user,
        // including a root test runner, without touching the filesystem.
        let error =
            write_export_file_bytes("/canopy-export-missing-parent-dir/export.md", "# title")
                .unwrap_err();
        assert_eq!(error.code, CommandErrorCode::ExportFileWrite);
        assert_eq!(error.message, "写入导出文件失败。");
        assert!(!error.retryable);
        assert_eq!(error.details, None);
    }

    #[test]
    fn export_write_reports_byte_length_and_stores_content_verbatim() {
        let path = std::env::temp_dir().join(format!("canopy-export-{}.md", uuid::Uuid::new_v4()));
        let path = path.to_str().expect("temp path is valid UTF-8");
        let content = "# 标题\n\n## 用户\n\n  preserved 内容\n";

        let bytes_written = write_export_file_bytes(path, content).expect("export writes");
        assert_eq!(bytes_written, content.len() as u64);

        let stored = std::fs::read_to_string(path).expect("exported file is readable");
        assert_eq!(stored, content);
        std::fs::remove_file(path).expect("exported file is removed");
    }
}
