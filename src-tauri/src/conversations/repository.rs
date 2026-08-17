use std::collections::HashSet;

use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row, SqliteConnection};

use super::{
    Conversation, ConversationSummary, NewConversation, NewNode, Node, PersistenceError,
    ReasoningEffort, Role, ValidatedPath,
};

#[derive(Debug, Default)]
pub(crate) struct ConversationRepository;

impl ConversationRepository {
    pub(crate) async fn insert_conversation(
        connection: &mut SqliteConnection,
        new_conversation: &NewConversation,
    ) -> Result<Conversation, PersistenceError> {
        sqlx::query("INSERT INTO conversations (id, title, root_node_id) VALUES (?1, ?2, ?3)")
            .bind(&new_conversation.id)
            .bind(&new_conversation.title)
            .bind(&new_conversation.root_node_id)
            .execute(&mut *connection)
            .await
            .map_err(|error| PersistenceError::from_write("create_conversation", error))?;

        Self::load_conversation(connection, &new_conversation.id)
            .await?
            .ok_or(PersistenceError::TreeIntegrity {
                reason: "inserted conversation could not be read",
            })
    }

    pub(crate) async fn insert_node(
        connection: &mut SqliteConnection,
        new_node: &NewNode,
        operation: &'static str,
    ) -> Result<Node, PersistenceError> {
        let metadata = canonical_json(&new_node.metadata)?;
        sqlx::query(
            "INSERT INTO nodes (id, parent_id, conversation_id, role, content, model, \
             created_at, metadata) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&new_node.id)
        .bind(&new_node.parent_id)
        .bind(&new_node.conversation_id)
        .bind(new_node.role.as_str())
        .bind(&new_node.content)
        .bind(&new_node.model)
        .bind(new_node.created_at)
        .bind(metadata)
        .execute(&mut *connection)
        .await
        .map_err(|error| PersistenceError::from_write(operation, error))?;

        Self::load_node(connection, &new_node.conversation_id, &new_node.id)
            .await?
            .ok_or(PersistenceError::TreeIntegrity {
                reason: "inserted node could not be read",
            })
    }

    pub(crate) async fn load_conversation(
        connection: &mut SqliteConnection,
        conversation_id: &str,
    ) -> Result<Option<Conversation>, PersistenceError> {
        let row = sqlx::query(
            "SELECT id, title, root_node_id, is_archived, provider_id, model, reasoning_effort \
             FROM conversations WHERE id = ?1",
        )
        .bind(conversation_id)
        .fetch_optional(connection)
        .await?;

        row.map(decode_conversation).transpose()
    }

    pub(crate) async fn list_conversations(
        connection: &mut SqliteConnection,
    ) -> Result<Vec<ConversationSummary>, PersistenceError> {
        let rows = sqlx::query(
            "SELECT c.id, c.title, c.root_node_id, c.is_archived, c.provider_id, c.model, \
                    c.reasoning_effort, \
                    MAX(n.created_at) AS updated_at \
             FROM conversations AS c \
             JOIN nodes AS n ON n.conversation_id = c.id \
             GROUP BY c.id, c.title, c.root_node_id, c.is_archived, c.provider_id, c.model, \
                      c.reasoning_effort \
             ORDER BY updated_at DESC, c.id ASC",
        )
        .fetch_all(connection)
        .await?;

        rows.into_iter().map(decode_conversation_summary).collect()
    }

    pub(crate) async fn load_node(
        connection: &mut SqliteConnection,
        conversation_id: &str,
        node_id: &str,
    ) -> Result<Option<Node>, PersistenceError> {
        let row = sqlx::query(
            "SELECT id, parent_id, conversation_id, role, content, model, created_at, metadata \
             FROM nodes WHERE id = ?1 AND conversation_id = ?2",
        )
        .bind(node_id)
        .bind(conversation_id)
        .fetch_optional(connection)
        .await?;

        row.map(decode_node).transpose()
    }

    pub(crate) async fn load_nodes(
        connection: &mut SqliteConnection,
        conversation_id: &str,
    ) -> Result<Vec<Node>, PersistenceError> {
        let rows = sqlx::query(
            "SELECT id, parent_id, conversation_id, role, content, model, created_at, metadata \
             FROM nodes WHERE conversation_id = ?1 ORDER BY created_at ASC, id ASC",
        )
        .bind(conversation_id)
        .fetch_all(connection)
        .await?;

        rows.into_iter().map(decode_node).collect()
    }

    pub(crate) async fn load_validated_path(
        connection: &mut SqliteConnection,
        conversation: &Conversation,
        active_node_id: &str,
    ) -> Result<ValidatedPath, PersistenceError> {
        let rows = sqlx::query(
            "WITH RECURSIVE path AS ( \
               SELECT n.id, n.parent_id, n.conversation_id, n.role, n.content, n.model, \
                      n.created_at, n.metadata, 0 AS depth, \
                      json_array(n.id) AS visited_ids, 0 AS cycle_detected \
               FROM nodes AS n \
               WHERE n.id = ?1 AND n.conversation_id = ?2 \
               UNION ALL \
               SELECT parent.id, parent.parent_id, parent.conversation_id, parent.role, \
                      parent.content, parent.model, parent.created_at, parent.metadata, \
                      child.depth + 1, \
                      json_insert(child.visited_ids, '$[#]', parent.id), \
                      EXISTS (SELECT 1 FROM json_each(child.visited_ids) \
                              WHERE value = parent.id) \
               FROM nodes AS parent \
               JOIN path AS child \
                 ON child.parent_id = parent.id \
                AND child.conversation_id = parent.conversation_id \
               WHERE child.cycle_detected = 0 \
             ) \
             SELECT id, parent_id, conversation_id, role, content, model, created_at, \
                    metadata, depth, cycle_detected \
             FROM path ORDER BY depth DESC, id ASC",
        )
        .bind(active_node_id)
        .bind(&conversation.id)
        .fetch_all(connection)
        .await?;

        if rows.is_empty() {
            return Err(PersistenceError::NotFound {
                entity: "active node",
            });
        }

        let mut path_rows = Vec::with_capacity(rows.len());
        for row in rows {
            let cycle_detected = decode_boolean(&row, "cycle_detected").map_err(|_| {
                PersistenceError::TreeIntegrity {
                    reason: "invalid cycle marker",
                }
            })?;
            path_rows.push((decode_node(row)?, cycle_detected));
        }

        validate_path(conversation, active_node_id, path_rows)
    }

    pub(crate) async fn count_children(
        connection: &mut SqliteConnection,
        conversation_id: &str,
        parent_id: &str,
    ) -> Result<i64, PersistenceError> {
        Ok(sqlx::query_scalar(
            "SELECT count(*) FROM nodes WHERE conversation_id = ?1 AND parent_id = ?2",
        )
        .bind(conversation_id)
        .bind(parent_id)
        .fetch_one(connection)
        .await?)
    }

    pub(crate) async fn update_title(
        connection: &mut SqliteConnection,
        conversation_id: &str,
        title: &str,
    ) -> Result<bool, PersistenceError> {
        Ok(
            sqlx::query("UPDATE conversations SET title = ?1 WHERE id = ?2")
                .bind(title)
                .bind(conversation_id)
                .execute(connection)
                .await
                .map_err(|error| PersistenceError::from_write("update_conversation_title", error))?
                .rows_affected()
                > 0,
        )
    }

    pub(crate) async fn archive_conversation(
        connection: &mut SqliteConnection,
        conversation_id: &str,
    ) -> Result<Conversation, PersistenceError> {
        let result = sqlx::query(
            "UPDATE conversations SET is_archived = 1 WHERE id = ?1 AND is_archived = 0",
        )
        .bind(conversation_id)
        .execute(&mut *connection)
        .await
        .map_err(|error| PersistenceError::from_write("archive_conversation", error))?;

        if result.rows_affected() == 0 {
            let conversation = Self::load_conversation(connection, conversation_id).await?;
            return conversation.ok_or(PersistenceError::NotFound {
                entity: "conversation",
            });
        }

        Self::load_conversation(connection, conversation_id)
            .await?
            .ok_or(PersistenceError::TreeIntegrity {
                reason: "archived conversation could not be read",
            })
    }

    pub(crate) async fn provider_exists(
        connection: &mut SqliteConnection,
        provider_id: &str,
    ) -> Result<bool, PersistenceError> {
        Ok(
            sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM providers WHERE id = ?1)")
                .bind(provider_id)
                .fetch_one(connection)
                .await?
                != 0,
        )
    }

    pub(crate) async fn set_provider_binding(
        connection: &mut SqliteConnection,
        conversation_id: &str,
        provider_id: Option<&str>,
        model: Option<&str>,
        reasoning_effort: Option<ReasoningEffort>,
    ) -> Result<Conversation, PersistenceError> {
        sqlx::query(
            "UPDATE conversations \
             SET provider_id = ?1, model = ?2, reasoning_effort = ?3 \
             WHERE id = ?4",
        )
        .bind(provider_id)
        .bind(model)
        .bind(reasoning_effort.map(ReasoningEffort::as_str))
        .bind(conversation_id)
        .execute(&mut *connection)
        .await
        .map_err(|error| PersistenceError::from_write("set_conversation_provider", error))?;
        Self::load_conversation(connection, conversation_id)
            .await?
            .ok_or(PersistenceError::NotFound {
                entity: "conversation",
            })
    }
}

fn canonical_json(value: &Value) -> Result<String, PersistenceError> {
    serde_json::to_string(value).map_err(|_| PersistenceError::InvalidInput {
        operation: "encode_metadata",
        source: None,
    })
}

fn decode_conversation(row: SqliteRow) -> Result<Conversation, PersistenceError> {
    Ok(Conversation {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        root_node_id: row.try_get("root_node_id")?,
        is_archived: decode_boolean(&row, "is_archived")?,
        provider_id: row.try_get("provider_id")?,
        model: row.try_get("model")?,
        reasoning_effort: decode_reasoning_effort(&row)?,
    })
}

fn decode_conversation_summary(row: SqliteRow) -> Result<ConversationSummary, PersistenceError> {
    Ok(ConversationSummary {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        root_node_id: row.try_get("root_node_id")?,
        is_archived: decode_boolean(&row, "is_archived")?,
        updated_at: row.try_get("updated_at")?,
        provider_id: row.try_get("provider_id")?,
        model: row.try_get("model")?,
        reasoning_effort: decode_reasoning_effort(&row)?,
    })
}

fn decode_reasoning_effort(row: &SqliteRow) -> Result<Option<ReasoningEffort>, PersistenceError> {
    row.try_get::<Option<String>, _>("reasoning_effort")?
        .map(|value| {
            ReasoningEffort::try_from(value.as_str()).map_err(|_| {
                PersistenceError::InvalidStoredData {
                    field: "reasoning_effort",
                }
            })
        })
        .transpose()
}

fn decode_node(row: SqliteRow) -> Result<Node, PersistenceError> {
    let role: String = row.try_get("role")?;
    let metadata: String = row.try_get("metadata")?;

    Ok(Node {
        id: row.try_get("id")?,
        parent_id: row.try_get("parent_id")?,
        conversation_id: row.try_get("conversation_id")?,
        role: Role::try_from(role.as_str())
            .map_err(|_| PersistenceError::InvalidStoredData { field: "role" })?,
        content: row.try_get("content")?,
        model: row.try_get("model")?,
        created_at: row.try_get("created_at")?,
        metadata: serde_json::from_str(&metadata)
            .map_err(|_| PersistenceError::InvalidStoredData { field: "metadata" })?,
    })
}

fn decode_boolean(row: &SqliteRow, column: &'static str) -> Result<bool, PersistenceError> {
    match row.try_get::<i64, _>(column)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(PersistenceError::InvalidStoredData { field: column }),
    }
}

fn validate_path(
    conversation: &Conversation,
    active_node_id: &str,
    path_rows: Vec<(Node, bool)>,
) -> Result<ValidatedPath, PersistenceError> {
    if path_rows.iter().any(|(_, cycle_detected)| *cycle_detected) {
        return Err(PersistenceError::TreeIntegrity {
            reason: "cycle detected in active path",
        });
    }

    let nodes: Vec<Node> = path_rows.into_iter().map(|(node, _)| node).collect();
    if nodes.iter().filter(|node| node.parent_id.is_none()).count() != 1 {
        return Err(PersistenceError::TreeIntegrity {
            reason: "active path does not reach exactly one structural root",
        });
    }

    let first = nodes.first().ok_or(PersistenceError::TreeIntegrity {
        reason: "active path is empty",
    })?;
    if first.id != conversation.root_node_id || first.parent_id.is_some() {
        return Err(PersistenceError::TreeIntegrity {
            reason: "active path does not begin at the designated root",
        });
    }

    let mut ids = HashSet::with_capacity(nodes.len());
    for node in &nodes {
        if node.conversation_id != conversation.id || !ids.insert(&node.id) {
            return Err(PersistenceError::TreeIntegrity {
                reason: "active path contains a duplicate or foreign node",
            });
        }
    }

    if nodes
        .windows(2)
        .any(|pair| pair[1].parent_id.as_deref() != Some(pair[0].id.as_str()))
    {
        return Err(PersistenceError::TreeIntegrity {
            reason: "active path adjacency is broken",
        });
    }

    if nodes.last().map(|node| node.id.as_str()) != Some(active_node_id) {
        return Err(PersistenceError::TreeIntegrity {
            reason: "active path does not end at the requested node",
        });
    }

    Ok(ValidatedPath::new(nodes))
}
