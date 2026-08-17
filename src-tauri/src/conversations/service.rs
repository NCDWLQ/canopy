use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use super::{
    repository::ConversationRepository, Conversation, ConversationSummary, ConversationTree,
    NewConversation, NewNode, Node, PersistenceError, ReasoningEffort, Role, ValidatedPath,
};

const MAX_GENERATED_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_GENERATED_MODEL_BYTES: usize = 200;

#[derive(Debug, Clone)]
pub struct ConversationPersistenceService {
    pool: SqlitePool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AutoTitleContext {
    pub conversation: Conversation,
    pub first_user_content: String,
    pub assistant_content: String,
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
        Self::require_writable_conversation(&mut transaction, &node.conversation_id).await?;
        let stored_node =
            ConversationRepository::insert_node(&mut transaction, &node, "append_node").await?;
        transaction.commit().await?;
        Ok(stored_node)
    }

    pub async fn append_user_node(&self, node: NewNode) -> Result<Node, PersistenceError> {
        self.insert_user_child_with_policy(node, false).await
    }

    pub async fn create_branch(&self, node: NewNode) -> Result<Node, PersistenceError> {
        self.insert_user_child_with_policy(node, true).await
    }

    async fn insert_user_child_with_policy(
        &self,
        node: NewNode,
        requires_existing_child: bool,
    ) -> Result<Node, PersistenceError> {
        let parent_id = node
            .parent_id
            .as_deref()
            .ok_or_else(|| PersistenceError::invalid_input("write_user_node"))?;
        if node.role != Role::User {
            return Err(PersistenceError::invalid_input("write_user_node"));
        }

        let mut transaction = self.pool.begin().await?;
        Self::require_writable_conversation(&mut transaction, &node.conversation_id).await?;
        let parent =
            ConversationRepository::load_node(&mut transaction, &node.conversation_id, parent_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "parent node",
                })?;
        if parent.role != Role::Assistant {
            return Err(PersistenceError::invalid_input("write_user_node"));
        }

        let child_count = ConversationRepository::count_children(
            &mut transaction,
            &node.conversation_id,
            parent_id,
        )
        .await?;
        if (requires_existing_child && child_count == 0)
            || (!requires_existing_child && child_count != 0)
        {
            return Err(PersistenceError::invalid_input("write_user_node"));
        }

        let operation = if requires_existing_child {
            "create_branch"
        } else {
            "append_node"
        };
        let stored =
            ConversationRepository::insert_node(&mut transaction, &node, operation).await?;
        transaction.commit().await?;
        Ok(stored)
    }

    pub async fn edit_node_as_branch(
        &self,
        source_node_id: &str,
        mut node: NewNode,
    ) -> Result<Node, PersistenceError> {
        if node.role != Role::User {
            return Err(PersistenceError::invalid_input("edit_node_as_branch"));
        }

        let mut transaction = self.pool.begin().await?;
        let conversation =
            Self::require_writable_conversation(&mut transaction, &node.conversation_id).await?;
        let source = ConversationRepository::load_node(
            &mut transaction,
            &node.conversation_id,
            source_node_id,
        )
        .await?
        .ok_or(PersistenceError::NotFound {
            entity: "source node",
        })?;
        if source.id == conversation.root_node_id || source.role != Role::User {
            return Err(PersistenceError::invalid_input("edit_node_as_branch"));
        }
        let source_parent_id = source
            .parent_id
            .as_deref()
            .ok_or_else(|| PersistenceError::invalid_input("edit_node_as_branch"))?;
        node.parent_id = Some(source_parent_id.to_owned());
        let source_parent = ConversationRepository::load_node(
            &mut transaction,
            &node.conversation_id,
            source_parent_id,
        )
        .await?
        .ok_or(PersistenceError::TreeIntegrity {
            reason: "edit source parent is missing",
        })?;
        if source_parent.role != Role::Assistant {
            return Err(PersistenceError::invalid_input("edit_node_as_branch"));
        }

        let stored =
            ConversationRepository::insert_node(&mut transaction, &node, "edit_node_as_branch")
                .await?;
        transaction.commit().await?;
        Ok(stored)
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
        validate_tree(&conversation, &nodes)?;
        transaction.commit().await?;

        Ok(ConversationTree {
            conversation,
            nodes,
        })
    }

    pub async fn list_conversations(&self) -> Result<Vec<ConversationSummary>, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversations = ConversationRepository::list_conversations(&mut transaction).await?;
        transaction.commit().await?;
        Ok(conversations)
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

    pub async fn load_generation_context(
        &self,
        conversation_id: &str,
        active_node_id: &str,
    ) -> Result<(Conversation, ValidatedPath), PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversation =
            ConversationRepository::load_conversation(&mut transaction, conversation_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "conversation",
                })?;
        if conversation.is_archived {
            return Err(PersistenceError::invalid_input(
                "archived_conversation_generation",
            ));
        }
        let path = ConversationRepository::load_validated_path(
            &mut transaction,
            &conversation,
            active_node_id,
        )
        .await?;
        if path.as_slice().last().map(|node| node.role) != Some(Role::User) {
            return Err(PersistenceError::invalid_input(
                "generation_requires_user_node",
            ));
        }
        transaction.commit().await?;
        Ok((conversation, path))
    }

    pub async fn set_provider_binding(
        &self,
        conversation_id: &str,
        provider_id: Option<String>,
        model: Option<String>,
        reasoning_effort: Option<ReasoningEffort>,
    ) -> Result<Conversation, PersistenceError> {
        if provider_id.is_some() != model.is_some() {
            return Err(PersistenceError::invalid_input("set_conversation_provider"));
        }
        let mut transaction = self.pool.begin().await?;
        Self::require_writable_conversation(&mut transaction, conversation_id).await?;
        if let Some(provider_id) = provider_id.as_deref() {
            if !ConversationRepository::provider_exists(&mut transaction, provider_id).await? {
                return Err(PersistenceError::NotFound { entity: "provider" });
            }
        }
        let conversation = ConversationRepository::set_provider_binding(
            &mut transaction,
            conversation_id,
            provider_id.as_deref(),
            model.as_deref(),
            reasoning_effort,
        )
        .await?;
        transaction.commit().await?;
        Ok(conversation)
    }

    pub async fn append_completed_assistant(
        &self,
        node: NewNode,
    ) -> Result<Node, PersistenceError> {
        let parent_id = node
            .parent_id
            .as_deref()
            .ok_or_else(|| PersistenceError::invalid_input("append_completed_assistant"))?;
        let valid_model = node.model.as_deref().is_some_and(|model| {
            !model.trim().is_empty() && model.len() <= MAX_GENERATED_MODEL_BYTES
        });
        if node.role != Role::Assistant
            || !valid_model
            || node.content.trim().is_empty()
            || node.content.len() > MAX_GENERATED_CONTENT_BYTES
        {
            return Err(PersistenceError::invalid_input(
                "append_completed_assistant",
            ));
        }

        let mut transaction = self.pool.begin().await?;
        Self::require_writable_conversation(&mut transaction, &node.conversation_id).await?;
        let parent =
            ConversationRepository::load_node(&mut transaction, &node.conversation_id, parent_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "parent node",
                })?;
        if parent.role != Role::User {
            return Err(PersistenceError::invalid_input(
                "append_completed_assistant",
            ));
        }
        let stored = ConversationRepository::insert_node(
            &mut transaction,
            &node,
            "append_completed_assistant",
        )
        .await?;
        transaction.commit().await?;
        Ok(stored)
    }

    pub async fn load_auto_title_context(
        &self,
        conversation_id: &str,
    ) -> Result<Option<AutoTitleContext>, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversation =
            ConversationRepository::load_conversation(&mut transaction, conversation_id)
                .await?
                .ok_or(PersistenceError::NotFound {
                    entity: "conversation",
                })?;
        let nodes = ConversationRepository::load_nodes(&mut transaction, conversation_id).await?;
        let mut users = nodes.iter().filter(|node| node.role == Role::User);
        let first_user_content = users.next().map(|node| node.content.clone());
        let assistants = nodes
            .iter()
            .filter(|node| node.role == Role::Assistant)
            .collect::<Vec<_>>();
        transaction.commit().await?;
        let Some(first_user_content) = first_user_content else {
            return Ok(None);
        };
        let [assistant] = assistants.as_slice() else {
            return Ok(None);
        };
        Ok(Some(AutoTitleContext {
            conversation,
            first_user_content,
            assistant_content: assistant.content.clone(),
        }))
    }

    pub async fn update_title(
        &self,
        conversation_id: &str,
        title: &str,
    ) -> Result<(), PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        if !ConversationRepository::update_title(&mut transaction, conversation_id, title).await? {
            return Err(PersistenceError::NotFound {
                entity: "conversation",
            });
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn archive_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Conversation, PersistenceError> {
        let mut transaction = self.pool.begin().await?;
        let conversation =
            ConversationRepository::archive_conversation(&mut transaction, conversation_id).await?;
        transaction.commit().await?;
        Ok(conversation)
    }

    async fn require_writable_conversation(
        connection: &mut sqlx::SqliteConnection,
        conversation_id: &str,
    ) -> Result<Conversation, PersistenceError> {
        let conversation = ConversationRepository::load_conversation(connection, conversation_id)
            .await?
            .ok_or(PersistenceError::NotFound {
                entity: "conversation",
            })?;
        if conversation.is_archived {
            return Err(PersistenceError::invalid_input(
                "archived_conversation_write",
            ));
        }
        Ok(conversation)
    }
}

fn validate_tree(conversation: &Conversation, nodes: &[Node]) -> Result<(), PersistenceError> {
    let mut node_ids = HashSet::with_capacity(nodes.len());
    let mut children_by_parent: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut structural_roots = Vec::new();

    for node in nodes {
        if node.conversation_id != conversation.id || !node_ids.insert(node.id.as_str()) {
            return Err(PersistenceError::TreeIntegrity {
                reason: "conversation tree contains a duplicate or foreign node",
            });
        }
        match node.parent_id.as_deref() {
            Some(parent_id) => children_by_parent
                .entry(parent_id)
                .or_default()
                .push(node.id.as_str()),
            None => structural_roots.push(node.id.as_str()),
        }
    }

    if structural_roots.as_slice() != [conversation.root_node_id.as_str()] {
        return Err(PersistenceError::TreeIntegrity {
            reason: "conversation tree does not have its designated structural root",
        });
    }
    if children_by_parent
        .keys()
        .any(|parent_id| !node_ids.contains(parent_id))
    {
        return Err(PersistenceError::TreeIntegrity {
            reason: "conversation tree contains a missing parent",
        });
    }

    let mut reachable_ids = HashSet::with_capacity(nodes.len());
    let mut pending_ids = vec![conversation.root_node_id.as_str()];
    while let Some(node_id) = pending_ids.pop() {
        if !reachable_ids.insert(node_id) {
            return Err(PersistenceError::TreeIntegrity {
                reason: "conversation tree contains a cycle",
            });
        }
        if let Some(child_ids) = children_by_parent.get(node_id) {
            pending_ids.extend(child_ids.iter().copied());
        }
    }
    if reachable_ids.len() != nodes.len() {
        return Err(PersistenceError::TreeIntegrity {
            reason: "conversation tree contains disconnected nodes",
        });
    }

    Ok(())
}
