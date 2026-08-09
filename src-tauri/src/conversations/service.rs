use sqlx::SqlitePool;

use super::{
    repository::ConversationRepository, ConversationTree, NewConversation, NewNode, Node,
    PersistenceError, ValidatedPath,
};

#[derive(Debug, Clone)]
pub struct ConversationPersistenceService {
    pool: SqlitePool,
}

impl ConversationPersistenceService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn create_conversation(
        &self,
        conversation: NewConversation,
        root: NewNode,
    ) -> Result<ConversationTree, PersistenceError> {
        if conversation.root_node_id != root.id
            || conversation.id != root.conversation_id
            || root.parent_id.is_some()
        {
            return Err(PersistenceError::invalid_input("create_conversation"));
        }

        let mut transaction = self.pool.begin().await?;
        let stored_conversation =
            ConversationRepository::insert_conversation(&mut transaction, &conversation).await?;
        let stored_root =
            ConversationRepository::insert_node(&mut transaction, &root, "create_conversation")
                .await?;

        if stored_root.id != stored_conversation.root_node_id
            || stored_root.conversation_id != stored_conversation.id
            || stored_root.parent_id.is_some()
        {
            return Err(PersistenceError::TreeIntegrity {
                reason: "created root does not match its conversation",
            });
        }

        transaction.commit().await?;
        Ok(ConversationTree {
            conversation: stored_conversation,
            nodes: vec![stored_root],
        })
    }

    pub async fn append_node(&self, node: NewNode) -> Result<Node, PersistenceError> {
        if node.parent_id.is_none() {
            return Err(PersistenceError::invalid_input("append_node"));
        }

        let mut transaction = self.pool.begin().await?;
        let stored_node =
            ConversationRepository::insert_node(&mut transaction, &node, "append_node").await?;
        transaction.commit().await?;
        Ok(stored_node)
    }

    pub async fn load_conversation_tree(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationTree, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversation =
            ConversationRepository::load_conversation(&mut transaction, conversation_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "conversation",
                })?;
        let nodes = ConversationRepository::load_nodes(&mut transaction, conversation_id).await?;
        transaction.commit().await?;

        Ok(ConversationTree {
            conversation,
            nodes,
        })
    }

    pub async fn load_active_path(
        &self,
        conversation_id: &str,
        active_node_id: &str,
    ) -> Result<ValidatedPath, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversation =
            ConversationRepository::load_conversation(&mut transaction, conversation_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "conversation",
                })?;
        let path = ConversationRepository::load_validated_path(
            &mut transaction,
            &conversation,
            active_node_id,
        )
        .await?;
        transaction.commit().await?;
        Ok(path)
    }

    pub async fn archive_node(
        &self,
        conversation_id: &str,
        node_id: &str,
    ) -> Result<Node, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let node = ConversationRepository::archive_node(&mut transaction, conversation_id, node_id)
            .await?;
        transaction.commit().await?;
        Ok(node)
    }
}
