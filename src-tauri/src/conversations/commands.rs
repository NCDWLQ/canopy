use serde_json::json;
use tauri::State;
use tauri_plugin_sql::DbInstances;

use super::{
    parse_title, ConversationPersistenceService, NewConversation, NewNode, Role, TitleParseError,
    MAX_TITLE_CHARS,
};
use crate::error::CommandError;
use crate::infra::database::managed_sqlite_pool;
use crate::infra::identity::{IdentityTimeSource, SystemIdentityTimeSource};

use super::dto::{
    ActivePathDto, AppendNodeRequest, ArchiveConversationRequest, ConversationDto,
    ConversationSearchResultDto, ConversationSummaryDto, ConversationTreeDto, CreateBranchRequest,
    CreateConversationRequest, DeleteConversationRequest, DeleteConversationSuccess,
    EditNodeAsBranchRequest, ListConversationsRequest, LoadActivePathRequest,
    LoadConversationTreeRequest, NodeDto, RenameConversationRequest, SearchConversationsRequest,
    SetConversationSystemPromptRequest, SetConversationSystemPromptResult,
    UnarchiveConversationRequest,
};

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
    "rename_conversation",
    "delete_conversation",
    "unarchive_conversation",
    "set_conversation_provider", // handler lives in generation::commands; name stays for the frozen conversation fixture
    "set_conversation_system_prompt",
    "search_conversations",
    "write_export_file", // handler lives in exports::commands; name stays for the frozen conversation fixture
];

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

    pub async fn set_conversation_system_prompt(
        &self,
        request: SetConversationSystemPromptRequest,
    ) -> Result<SetConversationSystemPromptResult, CommandError> {
        validate_id("conversation_id", &request.conversation_id)?;
        let system_prompt = normalize_system_prompt(request.system_prompt.as_deref())?;
        let conversation = self
            .persistence
            .set_system_prompt(&request.conversation_id, system_prompt)
            .await
            .map_err(CommandError::from)?;
        Ok(SetConversationSystemPromptResult {
            conversation_id: conversation.id,
            system_prompt: conversation.system_prompt,
        })
    }
}

pub(crate) fn validate_title(title: &str) -> Result<String, CommandError> {
    parse_title(title).map_err(|error| match error {
        TitleParseError::Blank => CommandError::invalid_input("title", "blank"),
        TitleParseError::TooLong => CommandError::invalid_input("title", "too_long"),
    })
}

fn normalize_system_prompt(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_CONTENT_BYTES {
        return Err(CommandError::invalid_input("system_prompt", "too_large"));
    }
    Ok(Some(trimmed.to_owned()))
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
pub async fn set_conversation_system_prompt(
    request: SetConversationSystemPromptRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetConversationSystemPromptResult, CommandError> {
    production_service(instances.inner())
        .await?
        .set_conversation_system_prompt(request)
        .await
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_system_prompt, validate_content, validate_query, validate_title,
        CONVERSATION_COMMAND_NAMES,
    };
    use crate::error::CommandErrorCode;

    #[test]
    fn command_names_are_frozen() {
        assert_eq!(CONVERSATION_COMMAND_NAMES.len(), 15);
        assert_eq!(CONVERSATION_COMMAND_NAMES[0], "create_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[8], "rename_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[9], "delete_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[10], "unarchive_conversation");
        assert_eq!(CONVERSATION_COMMAND_NAMES[11], "set_conversation_provider");
        assert_eq!(
            CONVERSATION_COMMAND_NAMES[12],
            "set_conversation_system_prompt"
        );
        assert_eq!(CONVERSATION_COMMAND_NAMES[13], "search_conversations");
        assert_eq!(CONVERSATION_COMMAND_NAMES[14], "write_export_file");
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
    fn system_prompt_trims_blank_to_none_and_enforces_utf8_limit() {
        assert_eq!(normalize_system_prompt(None).unwrap(), None);
        assert_eq!(normalize_system_prompt(Some(" \n\t ")).unwrap(), None);
        assert_eq!(
            normalize_system_prompt(Some("\u{0085}  Be concise  \u{0085}")).unwrap(),
            Some("Be concise".to_owned())
        );
        assert!(normalize_system_prompt(Some(&"a".repeat(1024 * 1024))).is_ok());
        assert_eq!(
            normalize_system_prompt(Some(&"a".repeat(1024 * 1024 + 1)))
                .unwrap_err()
                .code,
            CommandErrorCode::InvalidInput
        );
    }
}
