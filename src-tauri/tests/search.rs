mod support;

use serde_json::json;
use sqlx::SqlitePool;

use canopy_lib::conversations::{ConversationPersistenceService, NewConversation, NewNode, Role};
use support::{migrated_pool, run_async};

async fn create_conversation(
    pool: &SqlitePool,
    id: &str,
    title: &str,
    root_id: &str,
    content: &str,
    created_at: i64,
) {
    ConversationPersistenceService::new(pool.clone())
        .create_conversation(
            NewConversation {
                id: id.to_owned(),
                title: title.to_owned(),
                root_node_id: root_id.to_owned(),
            },
            NewNode {
                id: root_id.to_owned(),
                parent_id: None,
                conversation_id: id.to_owned(),
                role: Role::User,
                content: content.to_owned(),
                model: None,
                created_at,
                metadata: json!({}),
            },
        )
        .await
        .expect("conversation created");
}

async fn insert_node(
    pool: &SqlitePool,
    id: &str,
    parent_id: Option<&str>,
    conversation_id: &str,
    role: &str,
    content: &str,
    created_at: i64,
) {
    sqlx::query(
        "INSERT INTO nodes (id, parent_id, conversation_id, role, content, model, \
         created_at, metadata) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, '{}')",
    )
    .bind(id)
    .bind(parent_id)
    .bind(conversation_id)
    .bind(role)
    .bind(content)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("node {id} inserted: {error}"));
}

async fn seed(pool: &SqlitePool) {
    create_conversation(
        pool,
        "conv-alpha",
        "Alpha chat",
        "alpha-root",
        "你好世界 hello",
        1_000,
    )
    .await;
    insert_node(
        pool,
        "alpha-assistant",
        Some("alpha-root"),
        "conv-alpha",
        "assistant",
        "Response about Apples in C:\\orchard",
        2_000,
    )
    .await;
    insert_node(
        pool,
        "alpha-user",
        Some("alpha-assistant"),
        "conv-alpha",
        "user",
        "tell me about %apples%",
        3_000,
    )
    .await;

    create_conversation(
        pool,
        "conv-beta",
        "对话分支讨论",
        "beta-root",
        "讨论分支结构",
        1_500,
    )
    .await;
    insert_node(
        pool,
        "beta-assistant",
        Some("beta-root"),
        "conv-beta",
        "assistant",
        "分支回复内容",
        2_500,
    )
    .await;
    ConversationPersistenceService::new(pool.clone())
        .archive_conversation("conv-beta")
        .await
        .expect("conversation archived");

    create_conversation(
        pool,
        "conv-gamma",
        "Gamma notes",
        "gamma-root",
        "nothing relevant here",
        500,
    )
    .await;
    insert_node(
        pool,
        "gamma-tool",
        Some("gamma-root"),
        "conv-gamma",
        "tool",
        "SECRET_TOOL_MARKER payload",
        600,
    )
    .await;
    insert_node(
        pool,
        "gamma-system",
        Some("gamma-tool"),
        "conv-gamma",
        "system",
        "SECRET_SYSTEM_MARKER prompt",
        700,
    )
    .await;
}

#[test]
fn search_matches_content_case_insensitively_across_ascii_and_cjk() {
    run_async(async {
        let pool = migrated_pool().await;
        seed(&pool).await;
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service.search_conversations("HELLO").await.expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation_id, "conv-alpha");
        assert!(!results[0].title_matched);
        assert_eq!(results[0].hits.len(), 1);
        assert_eq!(results[0].hits[0].node_id, "alpha-root");
        assert_eq!(results[0].hits[0].role, Role::User);

        let results = service.search_conversations("分支").await.expect("search");
        assert_eq!(results.len(), 1);
        let beta = &results[0];
        assert_eq!(beta.conversation_id, "conv-beta");
        assert!(beta.title_matched);
        assert_eq!(beta.hits.len(), 2);
        assert_eq!(beta.hits[0].node_id, "beta-root");
        assert_eq!(beta.hits[1].node_id, "beta-assistant");
    });
}

#[test]
fn search_treats_like_wildcards_as_literal_characters() {
    run_async(async {
        let pool = migrated_pool().await;
        seed(&pool).await;
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service
            .search_conversations("%apples%")
            .await
            .expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation_id, "conv-alpha");
        assert_eq!(results[0].hits.len(), 1);
        assert_eq!(results[0].hits[0].node_id, "alpha-user");

        // A bare wildcard query matches only content containing the literal
        // character; it must not degenerate into match-everything.
        let results = service.search_conversations("%").await.expect("search");
        let ids: Vec<&str> = results
            .iter()
            .map(|result| result.conversation_id.as_str())
            .collect();
        assert_eq!(ids, vec!["conv-alpha"]);

        let results = service.search_conversations("_").await.expect("search");
        assert!(results.is_empty());

        let results = service.search_conversations("\\").await.expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation_id, "conv-alpha");
        assert_eq!(results[0].hits[0].node_id, "alpha-assistant");
    });
}

#[test]
fn search_includes_archived_conversations_and_orders_by_recency() {
    run_async(async {
        let pool = migrated_pool().await;
        seed(&pool).await;
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service.search_conversations("e").await.expect("search");
        let ids: Vec<&str> = results
            .iter()
            .map(|result| result.conversation_id.as_str())
            .collect();
        assert!(ids.contains(&"conv-alpha"));
        assert!(ids.contains(&"conv-gamma"));
        let alpha_index = ids.iter().position(|id| *id == "conv-alpha").unwrap();
        let gamma_index = ids.iter().position(|id| *id == "conv-gamma").unwrap();
        assert!(alpha_index < gamma_index, "updated_at DESC ordering");

        // Archived conversations stay searchable and carry the flag.
        let results = service.search_conversations("分支").await.expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation_id, "conv-beta");
        assert!(results[0].is_archived);
    });
}

#[test]
fn search_title_only_match_reports_flag_with_empty_hits() {
    run_async(async {
        let pool = migrated_pool().await;
        seed(&pool).await;
        let service = ConversationPersistenceService::new(pool.clone());

        // "Alpha" appears only in the title, never in seeded content.
        let results = service.search_conversations("Alpha").await.expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].conversation_id, "conv-alpha");
        assert!(results[0].title_matched);
        assert!(results[0].hits.is_empty());
    });
}

#[test]
fn search_excludes_tool_and_system_roles() {
    run_async(async {
        let pool = migrated_pool().await;
        seed(&pool).await;
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service
            .search_conversations("SECRET_TOOL_MARKER")
            .await
            .expect("search");
        assert!(results.is_empty());
        let results = service
            .search_conversations("SECRET_SYSTEM_MARKER")
            .await
            .expect("search");
        assert!(results.is_empty());
    });
}

#[test]
fn search_snippet_is_flattened_and_windowed() {
    run_async(async {
        let pool = migrated_pool().await;
        create_conversation(
            &pool,
            "conv-long",
            "Long",
            "long-root",
            &format!("{}needle{}", "x".repeat(60), "y".repeat(200)),
            1_000,
        )
        .await;
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service
            .search_conversations("needle")
            .await
            .expect("search");
        assert_eq!(results.len(), 1);
        let snippet = &results[0].hits[0].snippet;
        assert!(snippet.contains("needle"));
        assert!(!snippet.contains('\n'));
        assert!(snippet.chars().count() <= 126);
        // The window centers on the match: some leading context is trimmed
        // away instead of shipping the whole message.
        assert!(snippet.starts_with('x'));
        assert!(snippet.chars().count() < 260);
    });
}

#[test]
fn search_caps_hits_per_conversation_in_creation_order() {
    run_async(async {
        let pool = migrated_pool().await;
        create_conversation(
            &pool,
            "conv-bulk",
            "Bulk",
            "bulk-root",
            "bulk needle root",
            1_000,
        )
        .await;
        insert_node(
            &pool,
            "bulk-assistant",
            Some("bulk-root"),
            "conv-bulk",
            "assistant",
            "reply",
            1_100,
        )
        .await;
        for index in 0..7 {
            insert_node(
                &pool,
                &format!("bulk-user-{index}"),
                Some("bulk-assistant"),
                "conv-bulk",
                "user",
                &format!("bulk needle {index}"),
                2_000 + index,
            )
            .await;
        }
        let service = ConversationPersistenceService::new(pool.clone());

        let results = service
            .search_conversations("bulk needle")
            .await
            .expect("search");
        assert_eq!(results.len(), 1);
        let hits = &results[0].hits;
        assert_eq!(hits.len(), 5);
        // Chronological order: the root plus the first four siblings.
        assert_eq!(hits[0].node_id, "bulk-root");
        assert_eq!(hits[1].node_id, "bulk-user-0");
        assert_eq!(hits[4].node_id, "bulk-user-3");
    });
}

#[test]
fn search_caps_conversations_at_fifty_in_recency_order() {
    run_async(async {
        let pool = migrated_pool().await;
        for index in 0..51 {
            create_conversation(
                &pool,
                &format!("cap-conv-{index:02}"),
                "Cap",
                &format!("cap-root-{index:02}"),
                "CAP_NEEDLE",
                1_000 + index,
            )
            .await;
        }

        let results = ConversationPersistenceService::new(pool)
            .search_conversations("CAP_NEEDLE")
            .await
            .expect("search");
        assert_eq!(results.len(), 50);
        assert_eq!(results[0].conversation_id, "cap-conv-50");
        assert_eq!(results[49].conversation_id, "cap-conv-01");
        assert!(
            results
                .iter()
                .all(|result| result.conversation_id != "cap-conv-00"),
            "the oldest matching conversation must be excluded"
        );
    });
}

#[test]
fn high_volume_conversation_cannot_starve_other_results_of_hits() {
    run_async(async {
        let pool = migrated_pool().await;
        create_conversation(
            &pool,
            "aa-noise",
            "Noise",
            "noise-root",
            "needle noise root",
            1_000,
        )
        .await;
        insert_node(
            &pool,
            "noise-assistant",
            Some("noise-root"),
            "aa-noise",
            "assistant",
            "separator",
            1_001,
        )
        .await;
        let mut transaction = pool.begin().await.expect("bulk transaction");
        for index in 0..1_000 {
            sqlx::query(
                "INSERT INTO nodes (id, parent_id, conversation_id, role, content, model, \
                 created_at, metadata) VALUES (?1, 'noise-assistant', 'aa-noise', 'user', \
                 'needle noise', NULL, ?2, '{}')",
            )
            .bind(format!("noise-user-{index:04}"))
            .bind(2_000 + index)
            .execute(&mut *transaction)
            .await
            .expect("noise node inserted");
        }
        transaction.commit().await.expect("bulk commit");

        create_conversation(
            &pool,
            "zz-target",
            "Target",
            "target-root",
            "needle target",
            10_000,
        )
        .await;

        let results = ConversationPersistenceService::new(pool)
            .search_conversations("needle")
            .await
            .expect("search");
        let target = results
            .iter()
            .find(|result| result.conversation_id == "zz-target")
            .expect("target conversation remains in results");
        assert_eq!(target.hits.len(), 1);
        assert_eq!(target.hits[0].node_id, "target-root");
        let noise = results
            .iter()
            .find(|result| result.conversation_id == "aa-noise")
            .expect("noise conversation remains in results");
        assert_eq!(noise.hits.len(), 5);
    });
}
