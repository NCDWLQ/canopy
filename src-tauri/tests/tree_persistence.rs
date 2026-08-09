use std::str::FromStr;

use canopy_lib::{
    conversations::{
        ConversationPersistenceService, NewConversation, NewNode, PersistenceError, Role,
    },
    database::{managed_sqlite_pool, DATABASE_URL, MIGRATION_CATALOG},
};
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tauri_plugin_sql::{DbInstances, DbPool};

fn run_async(test: impl std::future::Future<Output = ()>) {
    tauri::async_runtime::block_on(test);
}

async fn migrated_pool() -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("in-memory SQLite URL is valid")
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("test database connects");

    for migration in MIGRATION_CATALOG {
        sqlx::raw_sql(migration.sql)
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("migration {} failed: {error}", migration.version));
    }

    pool
}

fn conversation(id: &str, root_node_id: &str) -> NewConversation {
    NewConversation {
        id: id.to_owned(),
        title: format!("Conversation {id}"),
        root_node_id: root_node_id.to_owned(),
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
        is_archived: false,
    }
}

async fn create_branch_fixture(pool: &SqlitePool) -> ConversationPersistenceService {
    let service = ConversationPersistenceService::new(pool.clone());
    service
        .create_conversation(
            conversation("conversation-a", "root"),
            node(
                "root",
                None,
                "conversation-a",
                Role::System,
                "root sentinel",
                100,
            ),
        )
        .await
        .expect("conversation is created");
    service
        .append_node(node(
            "user-a",
            Some("root"),
            "conversation-a",
            Role::User,
            "shared user",
            200,
        ))
        .await
        .expect("user node is appended");
    service
        .append_node(node(
            "assistant-a",
            Some("user-a"),
            "conversation-a",
            Role::Assistant,
            "shared assistant",
            300,
        ))
        .await
        .expect("assistant node is appended");

    let mut left = node(
        "user-left",
        Some("assistant-a"),
        "conversation-a",
        Role::User,
        "LEFT_BRANCH_SENTINEL",
        400,
    );
    left.model = Some("model-left".to_owned());
    left.metadata = serde_json::from_str(
        r#"{"z_last":true,"nested":{"kept":true},"branch":"left","a_first":1}"#,
    )
    .expect("fixture metadata is valid JSON");
    service
        .append_node(left)
        .await
        .expect("left branch is appended");
    service
        .append_node(node(
            "user-right",
            Some("assistant-a"),
            "conversation-a",
            Role::User,
            "RIGHT_BRANCH_SENTINEL",
            400,
        ))
        .await
        .expect("right branch is appended");

    service
}

#[test]
fn ordered_migrations_create_the_expected_schema_and_managed_pool_is_reused() {
    run_async(async {
        assert_eq!(
            MIGRATION_CATALOG
                .iter()
                .map(|migration| (migration.version, migration.description))
                .collect::<Vec<_>>(),
            vec![(1, "bootstrap"), (2, "conversation_tree")]
        );

        let pool = migrated_pool().await;
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .expect("foreign key state is readable");
        assert_eq!(foreign_keys, 1);

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("tables are inspectable");
        assert_eq!(tables, vec!["_canopy_bootstrap", "conversations", "nodes"]);

        let indexes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_schema \
             WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("indexes are inspectable");
        assert_eq!(
            indexes,
            vec![
                "nodes_children_order",
                "nodes_conversation_order",
                "nodes_one_root_per_conversation",
            ]
        );

        let triggers: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .expect("triggers are inspectable");
        assert_eq!(
            triggers,
            vec![
                "conversations_immutable_identity_and_root",
                "nodes_immutable_history",
                "nodes_reject_delete",
                "nodes_reject_designated_root_archive",
                "nodes_reject_designated_root_archived_on_insert",
                "nodes_reject_designated_root_parent",
            ]
        );

        let conversation_sql: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'conversations'",
        )
        .fetch_one(&pool)
        .await
        .expect("conversation DDL is inspectable");
        assert!(conversation_sql.contains("DEFERRABLE INITIALLY DEFERRED"));

        let node_foreign_keys: i64 =
            sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_list('nodes')")
                .fetch_one(&pool)
                .await
                .expect("node foreign keys are inspectable");
        assert_eq!(node_foreign_keys, 3);

        let missing = DbInstances::default();
        assert!(matches!(
            managed_sqlite_pool(&missing).await,
            Err(PersistenceError::DatabaseUnavailable)
        ));

        let instances = DbInstances::default();
        instances
            .0
            .write()
            .await
            .insert(DATABASE_URL.to_owned(), DbPool::Sqlite(pool.clone()));
        let managed = managed_sqlite_pool(&instances)
            .await
            .expect("managed pool is extracted");
        sqlx::query("INSERT INTO _canopy_bootstrap (version) VALUES (?1)")
            .bind(2_i64)
            .execute(&managed)
            .await
            .expect("resolved handle writes through the managed pool");
        let version_count: i64 = sqlx::query_scalar("SELECT count(*) FROM _canopy_bootstrap")
            .fetch_one(&pool)
            .await
            .expect("original managed pool observes the write");
        assert_eq!(version_count, 2);
    });
}

#[test]
fn invalid_root_rolls_back_conversation_and_node_atomically() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = ConversationPersistenceService::new(pool.clone());
        let mut archived_root = node(
            "invalid-root",
            None,
            "invalid-conversation",
            Role::System,
            "invalid root",
            100,
        );
        archived_root.is_archived = true;

        assert!(matches!(
            service
                .create_conversation(
                    conversation("invalid-conversation", "invalid-root"),
                    archived_root,
                )
                .await,
            Err(PersistenceError::InvalidInput { .. })
        ));

        let conversations: i64 =
            sqlx::query_scalar("SELECT count(*) FROM conversations WHERE id = ?1")
                .bind("invalid-conversation")
                .fetch_one(&pool)
                .await
                .expect("conversation count is readable");
        let nodes: i64 = sqlx::query_scalar("SELECT count(*) FROM nodes WHERE id = ?1")
            .bind("invalid-root")
            .fetch_one(&pool)
            .await
            .expect("node count is readable");
        assert_eq!((conversations, nodes), (0, 0));
    });
}

#[test]
fn sibling_branches_round_trip_deterministically_and_paths_are_isolated() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = create_branch_fixture(&pool).await;

        let tree = service
            .load_conversation_tree("conversation-a")
            .await
            .expect("tree loads");
        let tree_ids: Vec<&str> = tree.nodes.iter().map(|node| node.id.as_str()).collect();
        assert_eq!(
            tree_ids,
            vec!["root", "user-a", "assistant-a", "user-left", "user-right"]
        );
        let left = tree
            .nodes
            .iter()
            .find(|node| node.id == "user-left")
            .expect("left branch exists");
        assert_eq!(left.parent_id.as_deref(), Some("assistant-a"));
        assert_eq!(left.model.as_deref(), Some("model-left"));
        assert_eq!(
            left.metadata,
            json!({
                "a_first": 1,
                "branch": "left",
                "nested": {"kept": true},
                "z_last": true
            })
        );
        assert!(!left.is_archived);
        let stored_metadata: String =
            sqlx::query_scalar("SELECT metadata FROM nodes WHERE id = ?1")
                .bind("user-left")
                .fetch_one(&pool)
                .await
                .expect("stored metadata is readable");
        assert_eq!(
            stored_metadata,
            r#"{"a_first":1,"branch":"left","nested":{"kept":true},"z_last":true}"#
        );

        let left_path = service
            .load_active_path("conversation-a", "user-left")
            .await
            .expect("left path validates");
        let left_ids: Vec<&str> = left_path
            .as_slice()
            .iter()
            .map(|node| node.id.as_str())
            .collect();
        assert_eq!(left_ids, vec!["root", "user-a", "assistant-a", "user-left"]);
        assert!(left_path
            .as_slice()
            .iter()
            .all(|node| node.content != "RIGHT_BRANCH_SENTINEL"));

        let right_path = service
            .load_active_path("conversation-a", "user-right")
            .await
            .expect("right path validates");
        let right_ids: Vec<&str> = right_path
            .as_slice()
            .iter()
            .map(|node| node.id.as_str())
            .collect();
        assert_eq!(
            right_ids,
            vec!["root", "user-a", "assistant-a", "user-right"]
        );
        assert!(right_path
            .as_slice()
            .iter()
            .all(|node| node.content != "LEFT_BRANCH_SENTINEL"));

        assert!(matches!(
            service
                .load_active_path("conversation-a", "missing-node")
                .await,
            Err(PersistenceError::NotFound { .. })
        ));

        let before_archive = left.clone();
        let archived = service
            .archive_node("conversation-a", "user-left")
            .await
            .expect("eligible node archives");
        assert!(archived.is_archived);
        assert_eq!(archived.id, before_archive.id);
        assert_eq!(archived.parent_id, before_archive.parent_id);
        assert_eq!(archived.role, before_archive.role);
        assert_eq!(archived.content, before_archive.content);
        assert_eq!(archived.model, before_archive.model);
        assert_eq!(archived.created_at, before_archive.created_at);
        assert_eq!(archived.metadata, before_archive.metadata);
        assert!(matches!(
            service
                .load_active_path("conversation-a", "user-left")
                .await,
            Err(PersistenceError::NotFound { .. })
        ));

        let archived_tree = service
            .load_conversation_tree("conversation-a")
            .await
            .expect("archived nodes remain in history");
        assert!(
            archived_tree
                .nodes
                .iter()
                .find(|node| node.id == "user-left")
                .expect("archived node remains")
                .is_archived
        );
        assert!(matches!(
            service.archive_node("conversation-a", "root").await,
            Err(PersistenceError::InvalidInput { .. })
        ));
    });
}

#[test]
fn sqlite_constraints_and_triggers_protect_tree_history() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = create_branch_fixture(&pool).await;
        service
            .create_conversation(
                conversation("conversation-b", "root-b"),
                node(
                    "root-b",
                    None,
                    "conversation-b",
                    Role::System,
                    "root b",
                    100,
                ),
            )
            .await
            .expect("second conversation is created");

        assert!(matches!(
            service
                .append_node(node(
                    "cross-child",
                    Some("root"),
                    "conversation-b",
                    Role::User,
                    "cross",
                    200,
                ))
                .await,
            Err(PersistenceError::InvalidInput { .. })
        ));

        let self_parent = sqlx::query(
            "INSERT INTO nodes \
             (id, parent_id, conversation_id, role, content, created_at, metadata, is_archived) \
             VALUES (?1, ?1, ?2, 'user', 'self', 500, '{}', 0)",
        )
        .bind("self-parent")
        .bind("conversation-a")
        .execute(&pool)
        .await;
        assert!(self_parent.is_err());

        let second_root = sqlx::query(
            "INSERT INTO nodes \
             (id, parent_id, conversation_id, role, content, created_at, metadata, is_archived) \
             VALUES ('second-root', NULL, 'conversation-a', 'system', 'root', 500, '{}', 0)",
        )
        .execute(&pool)
        .await;
        assert!(second_root.is_err());

        let immutable_content =
            sqlx::query("UPDATE nodes SET content = 'changed' WHERE id = 'user-a'")
                .execute(&pool)
                .await;
        assert!(immutable_content.is_err());
        let immutable_parent =
            sqlx::query("UPDATE nodes SET parent_id = 'user-right' WHERE id = 'user-left'")
                .execute(&pool)
                .await;
        assert!(immutable_parent.is_err());
        let immutable_root = sqlx::query(
            "UPDATE conversations SET root_node_id = 'user-a' WHERE id = 'conversation-a'",
        )
        .execute(&pool)
        .await;
        assert!(immutable_root.is_err());
        let delete_node = sqlx::query("DELETE FROM nodes WHERE id = 'user-right'")
            .execute(&pool)
            .await;
        assert!(delete_node.is_err());

        let mut parented_root_transaction = pool.begin().await.expect("transaction starts");
        sqlx::query(
            "INSERT INTO conversations (id, title, root_node_id) \
             VALUES ('parented-conversation', 'parented', 'designated-child')",
        )
        .execute(&mut *parented_root_transaction)
        .await
        .expect("future root reference is deferred");
        sqlx::query(
            "INSERT INTO nodes \
             (id, parent_id, conversation_id, role, content, created_at, metadata, is_archived) \
             VALUES ('structural-root', NULL, 'parented-conversation', 'system', 'root', 1, '{}', 0)",
        )
        .execute(&mut *parented_root_transaction)
        .await
        .expect("structural root is inserted");
        let parented_designated_root = sqlx::query(
            "INSERT INTO nodes \
             (id, parent_id, conversation_id, role, content, created_at, metadata, is_archived) \
             VALUES ('designated-child', 'structural-root', 'parented-conversation', \
                     'system', 'bad root', 2, '{}', 0)",
        )
        .execute(&mut *parented_root_transaction)
        .await;
        assert!(parented_designated_root.is_err());
        parented_root_transaction
            .rollback()
            .await
            .expect("fixture rolls back");

        let mut archived_root_transaction = pool.begin().await.expect("transaction starts");
        sqlx::query(
            "INSERT INTO conversations (id, title, root_node_id) \
             VALUES ('archived-conversation', 'archived', 'archived-root')",
        )
        .execute(&mut *archived_root_transaction)
        .await
        .expect("future root reference is deferred");
        let archived_designated_root = sqlx::query(
            "INSERT INTO nodes \
             (id, parent_id, conversation_id, role, content, created_at, metadata, is_archived) \
             VALUES ('archived-root', NULL, 'archived-conversation', \
                     'system', 'bad root', 1, '{}', 1)",
        )
        .execute(&mut *archived_root_transaction)
        .await;
        assert!(archived_designated_root.is_err());
        archived_root_transaction
            .rollback()
            .await
            .expect("fixture rolls back");
    });
}

#[test]
fn corrupt_active_paths_fail_closed() {
    run_async(async {
        let archived_pool = migrated_pool().await;
        let archived_service = create_branch_fixture(&archived_pool).await;
        archived_service
            .archive_node("conversation-a", "assistant-a")
            .await
            .expect("non-root ancestor archives");
        assert!(matches!(
            archived_service
                .load_active_path("conversation-a", "user-right")
                .await,
            Err(PersistenceError::TreeIntegrity { .. })
        ));

        let wrong_root_pool = migrated_pool().await;
        let wrong_root_service = create_branch_fixture(&wrong_root_pool).await;
        sqlx::query("DROP TRIGGER conversations_immutable_identity_and_root")
            .execute(&wrong_root_pool)
            .await
            .expect("test-only corruption trigger is removed");
        sqlx::query("UPDATE conversations SET root_node_id = 'user-a' WHERE id = 'conversation-a'")
            .execute(&wrong_root_pool)
            .await
            .expect("test-only wrong root is installed");
        assert!(matches!(
            wrong_root_service
                .load_active_path("conversation-a", "user-right")
                .await,
            Err(PersistenceError::TreeIntegrity { .. })
        ));

        let cycle_pool = migrated_pool().await;
        let cycle_service = create_branch_fixture(&cycle_pool).await;
        sqlx::query("DROP TRIGGER nodes_immutable_history")
            .execute(&cycle_pool)
            .await
            .expect("test-only corruption trigger is removed");
        sqlx::query("UPDATE nodes SET parent_id = 'user-right' WHERE id = 'root'")
            .execute(&cycle_pool)
            .await
            .expect("test-only cycle is installed");
        assert!(matches!(
            cycle_service
                .load_active_path("conversation-a", "user-right")
                .await,
            Err(PersistenceError::TreeIntegrity { .. })
        ));

        let broken_chain_pool = migrated_pool().await;
        let broken_chain_service = create_branch_fixture(&broken_chain_pool).await;
        sqlx::query("DROP TRIGGER nodes_immutable_history")
            .execute(&broken_chain_pool)
            .await
            .expect("test-only corruption trigger is removed");
        let mut connection = broken_chain_pool
            .acquire()
            .await
            .expect("test corruption connection is acquired");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *connection)
            .await
            .expect("test-only foreign keys are disabled");
        sqlx::query("UPDATE nodes SET parent_id = 'missing-parent' WHERE id = 'user-right'")
            .execute(&mut *connection)
            .await
            .expect("test-only broken chain is installed");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await
            .expect("foreign keys are restored");
        drop(connection);
        assert!(matches!(
            broken_chain_service
                .load_active_path("conversation-a", "user-right")
                .await,
            Err(PersistenceError::TreeIntegrity { .. })
        ));

        let cross_conversation_pool = migrated_pool().await;
        let cross_conversation_service = create_branch_fixture(&cross_conversation_pool).await;
        cross_conversation_service
            .create_conversation(
                conversation("conversation-b", "root-b"),
                node(
                    "root-b",
                    None,
                    "conversation-b",
                    Role::System,
                    "root b",
                    100,
                ),
            )
            .await
            .expect("second conversation is created");
        assert!(matches!(
            cross_conversation_service
                .load_active_path("conversation-b", "user-right")
                .await,
            Err(PersistenceError::NotFound { .. })
        ));
        sqlx::query("DROP TRIGGER nodes_immutable_history")
            .execute(&cross_conversation_pool)
            .await
            .expect("test-only corruption trigger is removed");
        let mut connection = cross_conversation_pool
            .acquire()
            .await
            .expect("test corruption connection is acquired");
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *connection)
            .await
            .expect("test-only foreign keys are disabled");
        sqlx::query("UPDATE nodes SET parent_id = 'root-b' WHERE id = 'user-right'")
            .execute(&mut *connection)
            .await
            .expect("test-only cross-conversation parent is installed");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await
            .expect("foreign keys are restored");
        drop(connection);
        assert!(matches!(
            cross_conversation_service
                .load_active_path("conversation-a", "user-right")
                .await,
            Err(PersistenceError::TreeIntegrity { .. })
        ));
    });
}
