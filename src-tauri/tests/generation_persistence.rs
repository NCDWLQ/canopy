mod support;

use canopy_lib::conversations::{ConversationPersistenceService, NewConversation, NewNode, Role};
use serde_json::json;

use support::{migrated_pool, run_async};

fn node(
    id: &str,
    parent_id: Option<&str>,
    role: Role,
    content: String,
    model: Option<String>,
) -> NewNode {
    NewNode {
        id: id.to_owned(),
        parent_id: parent_id.map(str::to_owned),
        conversation_id: "generation-conversation".to_owned(),
        role,
        content,
        model,
        created_at: 1,
        metadata: json!({}),
    }
}

#[test]
fn completed_assistant_append_creates_siblings_and_enforces_bounds() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = ConversationPersistenceService::new(pool.clone());
        service
            .create_conversation(
                NewConversation {
                    id: "generation-conversation".to_owned(),
                    title: "Generation".to_owned(),
                    root_node_id: "user-root".to_owned(),
                },
                node("user-root", None, Role::User, "question".to_owned(), None),
            )
            .await
            .unwrap();

        service
            .append_completed_assistant(node(
                "assistant-first",
                Some("user-root"),
                Role::Assistant,
                "first answer".to_owned(),
                Some("model-a".to_owned()),
            ))
            .await
            .unwrap();
        service
            .append_completed_assistant(node(
                "assistant-regenerated",
                Some("user-root"),
                Role::Assistant,
                "second answer".to_owned(),
                Some("model-b".to_owned()),
            ))
            .await
            .unwrap();

        for invalid in [
            node(
                "blank-content",
                Some("user-root"),
                Role::Assistant,
                " \n".to_owned(),
                Some("model".to_owned()),
            ),
            node(
                "oversized-content",
                Some("user-root"),
                Role::Assistant,
                "x".repeat(1024 * 1024 + 1),
                Some("model".to_owned()),
            ),
            node(
                "blank-model",
                Some("user-root"),
                Role::Assistant,
                "answer".to_owned(),
                Some(" ".to_owned()),
            ),
            node(
                "oversized-model",
                Some("user-root"),
                Role::Assistant,
                "answer".to_owned(),
                Some("m".repeat(201)),
            ),
        ] {
            assert!(service.append_completed_assistant(invalid).await.is_err());
        }

        let stored: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id, content, model FROM nodes WHERE role = 'assistant' ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            stored,
            vec![
                (
                    "assistant-first".to_owned(),
                    "first answer".to_owned(),
                    "model-a".to_owned()
                ),
                (
                    "assistant-regenerated".to_owned(),
                    "second answer".to_owned(),
                    "model-b".to_owned()
                )
            ]
        );
    });
}

#[test]
fn generation_context_and_completion_recheck_archive_and_terminal_role() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = ConversationPersistenceService::new(pool.clone());
        service
            .create_conversation(
                NewConversation {
                    id: "generation-conversation".to_owned(),
                    title: "Generation".to_owned(),
                    root_node_id: "assistant-root".to_owned(),
                },
                node(
                    "assistant-root",
                    None,
                    Role::Assistant,
                    "answer".to_owned(),
                    Some("model".to_owned()),
                ),
            )
            .await
            .unwrap();
        assert!(service
            .load_generation_context("generation-conversation", "assistant-root")
            .await
            .is_err());

        sqlx::query("DELETE FROM conversations WHERE id = 'generation-conversation'")
            .execute(&pool)
            .await
            .unwrap_err();
        service
            .archive_conversation("generation-conversation")
            .await
            .unwrap();
        assert!(service
            .load_generation_context("generation-conversation", "assistant-root")
            .await
            .is_err());
        assert!(service
            .append_completed_assistant(node(
                "late-assistant",
                Some("assistant-root"),
                Role::Assistant,
                "late".to_owned(),
                Some("model".to_owned()),
            ))
            .await
            .is_err());
        let node_count: i64 = sqlx::query_scalar("SELECT count(*) FROM nodes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(node_count, 1);
    });
}
