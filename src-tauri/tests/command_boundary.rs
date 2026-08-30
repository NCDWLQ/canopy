mod support;

use std::{
    collections::VecDeque,
    fs,
    sync::{Arc, Mutex},
    time::Duration,
};

use canopy_lib::{
    conversations::{
        commands::{ConversationCommandService, CONVERSATION_COMMAND_NAMES},
        dto::{
            ActivePathDto, AppendNodeRequest, ArchiveConversationRequest, ConversationDto,
            ConversationSearchResultDto, ConversationSummaryDto, ConversationTreeDto,
            CreateBranchRequest, CreateConversationRequest, DeleteConversationRequest,
            DeleteConversationSuccess, EditNodeAsBranchRequest, ListConversationsRequest,
            LoadActivePathRequest, LoadConversationTreeRequest, NodeDto, RenameConversationRequest,
            RoleDto, SearchConversationsRequest, SetConversationProviderRequest,
            SetConversationSystemPromptRequest, UnarchiveConversationRequest,
        },
        ConversationPersistenceService, NewConversation, NewNode, PersistenceError, Role,
    },
    error::{CommandError, CommandErrorCode},
    exports::{WriteExportFileRequest, WriteExportFileResponse},
    infra::identity::IdentityTimeSource,
};
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use uuid::Uuid;

use support::{migrated_pool, run_async};

#[derive(Debug, Clone)]
struct SequenceSource {
    ids: Arc<Mutex<VecDeque<String>>>,
    millis: i64,
}

impl SequenceSource {
    fn new(ids: &[&str], millis: i64) -> Self {
        Self {
            ids: Arc::new(Mutex::new(ids.iter().map(|id| (*id).to_owned()).collect())),
            millis,
        }
    }
}

impl IdentityTimeSource for SequenceSource {
    fn new_id(&self) -> String {
        self.ids
            .lock()
            .expect("sequence source lock is available")
            .pop_front()
            .expect("test supplied enough deterministic IDs")
    }

    fn now_millis(&self) -> i64 {
        self.millis
    }
}

fn node(
    id: &str,
    parent_id: Option<&str>,
    conversation_id: &str,
    role: Role,
    content: &str,
    created_at: i64,
) -> NewNode {
    NewNode {
        id: id.to_owned(),
        parent_id: parent_id.map(str::to_owned),
        conversation_id: conversation_id.to_owned(),
        role,
        content: content.to_owned(),
        model: None,
        created_at,
        metadata: json!({}),
    }
}

#[test]
fn shared_fixture_round_trips_rust_requests_dtos_errors_and_exact_command_names() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../contract-fixtures/conversation-ipc.json"
    ))
    .expect("shared fixture is valid JSON");

    assert_eq!(
        serde_json::to_value(CONVERSATION_COMMAND_NAMES).expect("command names serialize"),
        fixture["command_names"]
    );

    macro_rules! assert_request {
        ($name:literal, $request_type:ty) => {{
            let value = fixture["requests"][$name].clone();
            let request: $request_type =
                serde_json::from_value(value.clone()).expect("fixture request decodes");
            assert_eq!(
                serde_json::to_value(request).expect("fixture request reserializes"),
                value
            );
        }};
    }
    assert_request!("create_conversation", CreateConversationRequest);
    assert_request!("append_node", AppendNodeRequest);
    assert_request!("create_branch", CreateBranchRequest);
    assert_request!("edit_node_as_branch", EditNodeAsBranchRequest);
    assert_request!("list_conversations", ListConversationsRequest);
    assert_request!("load_conversation_tree", LoadConversationTreeRequest);
    assert_request!("load_active_path", LoadActivePathRequest);
    assert_request!("archive_conversation", ArchiveConversationRequest);
    assert_request!("rename_conversation", RenameConversationRequest);
    assert_request!("delete_conversation", DeleteConversationRequest);
    assert_request!("unarchive_conversation", UnarchiveConversationRequest);
    assert_request!("set_conversation_provider", SetConversationProviderRequest);
    assert_request!(
        "set_conversation_system_prompt",
        SetConversationSystemPromptRequest
    );
    assert_request!("search_conversations", SearchConversationsRequest);
    assert_request!("write_export_file", WriteExportFileRequest);

    let conversation: ConversationDto =
        serde_json::from_value(fixture["successes"]["conversation"].clone())
            .expect("conversation DTO decodes");
    assert_eq!(
        serde_json::to_value(conversation).expect("conversation DTO reserializes"),
        fixture["successes"]["conversation"]
    );
    let search_results: Vec<ConversationSearchResultDto> =
        serde_json::from_value(fixture["successes"]["search_results"].clone())
            .expect("search results decode");
    assert_eq!(
        serde_json::to_value(search_results).expect("search results reserialize"),
        fixture["successes"]["search_results"]
    );
    let summaries: Vec<ConversationSummaryDto> =
        serde_json::from_value(fixture["successes"]["conversation_summaries"].clone())
            .expect("conversation summaries decode");
    assert_eq!(
        serde_json::to_value(summaries).expect("conversation summaries reserialize"),
        fixture["successes"]["conversation_summaries"]
    );
    let tree: ConversationTreeDto =
        serde_json::from_value(fixture["successes"]["conversation_tree"].clone())
            .expect("tree DTO decodes");
    assert_eq!(
        serde_json::to_value(tree).expect("tree DTO reserializes"),
        fixture["successes"]["conversation_tree"]
    );
    let path: ActivePathDto = serde_json::from_value(fixture["successes"]["active_path"].clone())
        .expect("active path DTO decodes");
    assert_eq!(
        serde_json::to_value(path).expect("active path DTO reserializes"),
        fixture["successes"]["active_path"]
    );
    let renamed: ConversationDto =
        serde_json::from_value(fixture["successes"]["renamed_conversation"].clone())
            .expect("renamed conversation DTO decodes");
    assert_eq!(
        serde_json::to_value(renamed).expect("renamed conversation DTO reserializes"),
        fixture["successes"]["renamed_conversation"]
    );
    let deleted: DeleteConversationSuccess =
        serde_json::from_value(fixture["successes"]["deleted_conversation"].clone())
            .expect("deleted conversation DTO decodes");
    assert_eq!(
        serde_json::to_value(deleted).expect("deleted conversation DTO reserializes"),
        fixture["successes"]["deleted_conversation"]
    );
    let unarchived: ConversationDto =
        serde_json::from_value(fixture["successes"]["unarchived_conversation"].clone())
            .expect("unarchived conversation DTO decodes");
    assert_eq!(
        serde_json::to_value(unarchived).expect("unarchived conversation DTO reserializes"),
        fixture["successes"]["unarchived_conversation"]
    );
    let export: WriteExportFileResponse =
        serde_json::from_value(fixture["successes"]["write_export_file"].clone())
            .expect("export write DTO decodes");
    assert_eq!(
        serde_json::to_value(export).expect("export write DTO reserializes"),
        fixture["successes"]["write_export_file"]
    );

    let errors: Vec<CommandError> =
        serde_json::from_value(fixture["errors"].clone()).expect("all command errors decode");
    assert_eq!(errors.len(), 12);
    assert_eq!(
        serde_json::to_value(&errors).expect("all command errors reserialize"),
        fixture["errors"]
    );
    assert!(errors
        .iter()
        .any(|error| { error.code == CommandErrorCode::DatabaseUnavailable && error.retryable }));
    assert!(errors.iter().any(|error| {
        error.code == CommandErrorCode::RateLimited
            && error.details == Some(json!({ "retry_after_ms": 1000 }))
    }));
    assert!(errors
        .iter()
        .any(|error| { error.code == CommandErrorCode::ExportFileWrite && !error.retryable }));

    for malformed in fixture["malformed_successes"]
        .as_array()
        .expect("malformed success list is an array")
    {
        assert!(serde_json::from_value::<NodeDto>(malformed.clone()).is_err());
    }
    let malformed_commands = &fixture["malformed_command_successes"];
    assert!(serde_json::from_value::<ConversationDto>(
        malformed_commands["archive_conversation"].clone()
    )
    .is_err());
    assert!(serde_json::from_value::<ConversationTreeDto>(
        malformed_commands["load_conversation_tree"].clone()
    )
    .is_err());
    assert!(serde_json::from_value::<ActivePathDto>(
        malformed_commands["load_active_path"].clone()
    )
    .is_err());
    assert!(serde_json::from_value::<Vec<ConversationSearchResultDto>>(
        malformed_commands["search_conversations"].clone()
    )
    .is_err());
    assert!(serde_json::from_value::<WriteExportFileResponse>(
        malformed_commands["write_export_file"].clone()
    )
    .is_err());
}

#[test]
fn deterministic_command_service_assigns_identity_time_and_preserves_content() {
    run_async(async {
        let pool = migrated_pool().await;
        let source =
            SequenceSource::new(&["conversation-created", "root-created"], 1_770_000_000_123);
        let service = ConversationCommandService::new(
            ConversationPersistenceService::new(pool.clone()),
            source,
        );
        let content = "  code block\n    indentation is preserved\n";
        let tree = service
            .create_conversation(CreateConversationRequest {
                title: "  Trimmed title  ".to_owned(),
                content: content.to_owned(),
            })
            .await
            .expect("valid conversation command succeeds");

        assert_eq!(tree.conversation.id, "conversation-created");
        assert_eq!(tree.conversation.title, "Trimmed title");
        assert_eq!(tree.conversation.root_node_id, "root-created");
        assert!(!tree.conversation.is_archived);
        assert_eq!(tree.nodes.len(), 1);
        assert_eq!(tree.nodes[0].id, "root-created");
        assert_eq!(tree.nodes[0].role, RoleDto::User);
        assert_eq!(tree.nodes[0].content, content);
        assert_eq!(tree.nodes[0].model, None);
        assert_eq!(tree.nodes[0].created_at, 1_770_000_000_123);
        assert_eq!(tree.nodes[0].metadata, json!({}));

        let summaries = service
            .list_conversations(ListConversationsRequest {})
            .await
            .expect("conversation discovery command succeeds");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "conversation-created");
        assert_eq!(summaries[0].root_node_id, "root-created");
        assert_eq!(summaries[0].updated_at, 1_770_000_000_123);
        assert!(!summaries[0].is_archived);

        let stored_content: String =
            sqlx::query_scalar("SELECT content FROM nodes WHERE id = 'root-created'")
                .fetch_one(&pool)
                .await
                .expect("stored content is readable");
        assert_eq!(stored_content, content);
    });
}

#[test]
fn append_branch_edit_and_archive_policies_are_transactional_and_non_destructive() {
    run_async(async {
        let pool = migrated_pool().await;
        let persistence = ConversationPersistenceService::new(pool.clone());
        persistence
            .create_conversation(
                NewConversation {
                    id: "conversation-policy".to_owned(),
                    title: "Policy".to_owned(),
                    root_node_id: "root".to_owned(),
                },
                node("root", None, "conversation-policy", Role::User, "root", 1),
            )
            .await
            .expect("policy conversation is created");
        persistence
            .append_node(node(
                "assistant-a",
                Some("root"),
                "conversation-policy",
                Role::Assistant,
                "assistant",
                2,
            ))
            .await
            .expect("assistant fixture is inserted by Rust-owned flow");

        let source = SequenceSource::new(
            &[
                "user-original",
                "append-rejected",
                "branch-role-rejected",
                "user-branch",
                "edit-role-rejected",
                "user-edited",
                "root-edit-rejected",
                "archive-append-rejected",
                "archive-branch-rejected",
                "archive-edit-rejected",
            ],
            100,
        );
        let commands = ConversationCommandService::new(persistence.clone(), source);
        let original = commands
            .append_node(AppendNodeRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "assistant-a".to_owned(),
                content: "original user".to_owned(),
            })
            .await
            .expect("append accepts an assistant leaf");
        assert_eq!(original.id, "user-original");

        let append_again = commands
            .append_node(AppendNodeRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "assistant-a".to_owned(),
                content: "not an append".to_owned(),
            })
            .await
            .expect_err("append rejects an assistant with an existing child");
        assert_eq!(append_again.code, CommandErrorCode::InvalidInput);

        let wrong_branch_role = commands
            .create_branch(CreateBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "root".to_owned(),
                content: "not below an assistant".to_owned(),
            })
            .await
            .expect_err("branch rejects a non-assistant parent");
        assert_eq!(wrong_branch_role.code, CommandErrorCode::InvalidInput);

        let branch = commands
            .create_branch(CreateBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "assistant-a".to_owned(),
                content: "branch user".to_owned(),
            })
            .await
            .expect("branch accepts an assistant with an existing child");
        assert_eq!(branch.id, "user-branch");

        persistence
            .append_node(node(
                "assistant-descendant",
                Some("user-original"),
                "conversation-policy",
                Role::Assistant,
                "descendant assistant",
                101,
            ))
            .await
            .expect("assistant descendant is inserted");
        persistence
            .append_node(node(
                "user-descendant",
                Some("assistant-descendant"),
                "conversation-policy",
                Role::User,
                "DESCENDANT_SENTINEL",
                102,
            ))
            .await
            .expect("user descendant is inserted");
        let before = persistence
            .load_conversation_tree("conversation-policy")
            .await
            .expect("tree loads before edit");
        let protected_before: Vec<_> = before
            .nodes
            .iter()
            .filter(|node| {
                ["user-original", "assistant-descendant", "user-descendant"]
                    .contains(&node.id.as_str())
            })
            .cloned()
            .collect();

        let wrong_edit_role = commands
            .edit_node_as_branch(EditNodeAsBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                source_node_id: "assistant-descendant".to_owned(),
                content: "not a user edit".to_owned(),
            })
            .await
            .expect_err("edit rejects a non-user source");
        assert_eq!(wrong_edit_role.code, CommandErrorCode::InvalidInput);

        let edited = commands
            .edit_node_as_branch(EditNodeAsBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                source_node_id: "user-original".to_owned(),
                content: "edited sibling".to_owned(),
            })
            .await
            .expect("eligible historical user node edits as a sibling");
        assert_eq!(edited.id, "user-edited");
        assert_eq!(edited.parent_id.as_deref(), Some("assistant-a"));
        assert_eq!(edited.content, "edited sibling");

        let after = persistence
            .load_conversation_tree("conversation-policy")
            .await
            .expect("tree loads after edit");
        let protected_after: Vec<_> = after
            .nodes
            .iter()
            .filter(|node| {
                ["user-original", "assistant-descendant", "user-descendant"]
                    .contains(&node.id.as_str())
            })
            .cloned()
            .collect();
        assert_eq!(protected_after, protected_before);

        let count_before_root_edit = after.nodes.len();
        let root_edit = commands
            .edit_node_as_branch(EditNodeAsBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                source_node_id: "root".to_owned(),
                content: "replacement root".to_owned(),
            })
            .await
            .expect_err("structural root cannot be edited");
        assert_eq!(root_edit.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            persistence
                .load_conversation_tree("conversation-policy")
                .await
                .expect("tree remains readable")
                .nodes
                .len(),
            count_before_root_edit
        );

        commands
            .archive_conversation(ArchiveConversationRequest {
                conversation_id: "conversation-policy".to_owned(),
            })
            .await
            .expect("conversation archives");
        let archived_append = commands
            .append_node(AppendNodeRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "assistant-a".to_owned(),
                content: "blocked append after archive".to_owned(),
            })
            .await
            .expect_err("archived conversation rejects append");
        assert_eq!(archived_append.code, CommandErrorCode::InvalidInput);
        let archived_branch = commands
            .create_branch(CreateBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                parent_node_id: "assistant-a".to_owned(),
                content: "blocked branch after archive".to_owned(),
            })
            .await
            .expect_err("archived conversation rejects branch");
        assert_eq!(archived_branch.code, CommandErrorCode::InvalidInput);
        let archived_edit = commands
            .edit_node_as_branch(EditNodeAsBranchRequest {
                conversation_id: "conversation-policy".to_owned(),
                source_node_id: "user-original".to_owned(),
                content: "blocked edit after archive".to_owned(),
            })
            .await
            .expect_err("archived conversation rejects edit");
        assert_eq!(archived_edit.code, CommandErrorCode::InvalidInput);
        let rejected_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM nodes WHERE id IN \
             ('append-rejected', 'branch-role-rejected', 'edit-role-rejected', \
              'root-edit-rejected', 'archive-append-rejected', \
              'archive-branch-rejected', 'archive-edit-rejected')",
        )
        .fetch_one(&pool)
        .await
        .expect("rejected node count is readable");
        assert_eq!(rejected_count, 0);
    });
}

#[test]
fn sqlite_lock_errors_map_to_retryable_database_unavailable() {
    run_async(async {
        let database_path = std::env::temp_dir().join(format!(
            "canopy-command-error-lock-{}.sqlite",
            Uuid::new_v4()
        ));
        let options = SqliteConnectOptions::new()
            .filename(&database_path)
            .create_if_missing(true)
            .busy_timeout(Duration::ZERO);
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .expect("lock test database connects");
        sqlx::query("CREATE TABLE lock_test (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .expect("lock test table is created");

        let mut blocker = pool
            .acquire()
            .await
            .expect("blocking connection is acquired");
        let mut writer = pool
            .acquire()
            .await
            .expect("second writer connection is acquired");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *blocker)
            .await
            .expect("blocking write transaction starts");
        let lock_error = sqlx::query("INSERT INTO lock_test (id) VALUES (1)")
            .execute(&mut *writer)
            .await
            .expect_err("second writer is rejected while the lock is held");

        let mapped = CommandError::from(PersistenceError::Storage(lock_error));
        assert_eq!(mapped.code, CommandErrorCode::DatabaseUnavailable);
        assert!(mapped.retryable);
        assert_eq!(mapped.details, None);

        sqlx::query("ROLLBACK")
            .execute(&mut *blocker)
            .await
            .expect("blocking transaction rolls back");
        drop(writer);
        drop(blocker);
        pool.close().await;
        fs::remove_file(database_path).expect("lock test database is removed");
    });
}
