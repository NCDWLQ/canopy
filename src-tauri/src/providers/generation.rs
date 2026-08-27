use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use secrecy::SecretString;
use serde_json::json;
use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

use crate::conversations::{
    ConversationPersistenceService, NewNode, Node, ReasoningEffort, Role, ValidatedPath,
};
use crate::platform::identity::{IdentityTimeSource, SystemIdentityTimeSource};

use super::{
    anthropic,
    openai_compatible::{self, GeneratedContent, OpenAiCompatibleClient, StreamingRequest},
    Protocol, ProviderError, ProviderService, ValidatedEndpoint,
};

struct GenerationEntry {
    generation_id: String,
    cancellation: CancellationToken,
    phase: GenerationPhase,
}

enum GenerationPhase {
    Running,
    Finalizing,
    Cancelling,
}

#[derive(Clone)]
pub struct GenerationRuntime {
    entries: Arc<Mutex<HashMap<String, GenerationEntry>>>,
}

impl Default for GenerationRuntime {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl GenerationRuntime {
    pub fn reserve(
        &self,
        conversation_id: String,
        generation_id: String,
    ) -> Result<GenerationLease, ProviderError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ProviderError::RuntimeInvariant)?;
        if entries.contains_key(&conversation_id) {
            return Err(ProviderError::GenerationAlreadyActive);
        }
        if entries
            .values()
            .any(|entry| entry.generation_id == generation_id)
        {
            return Err(ProviderError::RuntimeInvariant);
        }

        let cancellation = CancellationToken::new();
        entries.insert(
            conversation_id.clone(),
            GenerationEntry {
                generation_id: generation_id.clone(),
                cancellation: cancellation.clone(),
                phase: GenerationPhase::Running,
            },
        );
        Ok(GenerationLease {
            runtime: self.clone(),
            conversation_id,
            generation_id,
            cancellation,
        })
    }

    pub fn cancel(&self, generation_id: &str) -> Result<bool, ProviderError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ProviderError::RuntimeInvariant)?;
        let Some(entry) = entries
            .values_mut()
            .find(|entry| entry.generation_id == generation_id)
        else {
            return Ok(false);
        };
        if !matches!(entry.phase, GenerationPhase::Running) {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Cancelling;
        entry.cancellation.cancel();
        Ok(true)
    }

    pub fn begin_finalizing(&self, generation_id: &str) -> Result<bool, ProviderError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ProviderError::RuntimeInvariant)?;
        let Some(entry) = entries
            .values_mut()
            .find(|entry| entry.generation_id == generation_id)
        else {
            return Ok(false);
        };
        if !matches!(entry.phase, GenerationPhase::Running) || entry.cancellation.is_cancelled() {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Finalizing;
        Ok(true)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.entries.lock().map_or(0, |entries| entries.len())
    }

    #[cfg(test)]
    fn is_finalizing(&self, generation_id: &str) -> bool {
        self.entries.lock().is_ok_and(|entries| {
            entries.values().any(|entry| {
                entry.generation_id == generation_id
                    && matches!(entry.phase, GenerationPhase::Finalizing)
            })
        })
    }
}

pub struct GenerationLease {
    runtime: GenerationRuntime,
    conversation_id: String,
    generation_id: String,
    cancellation: CancellationToken,
}

impl GenerationLease {
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }

    fn begin_finalizing(&self) -> Result<bool, ProviderError> {
        self.runtime.begin_finalizing(&self.generation_id)
    }
}

impl Drop for GenerationLease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.runtime.entries.lock() {
            if entries
                .get(&self.conversation_id)
                .is_some_and(|entry| entry.generation_id == self.generation_id)
            {
                entries.remove(&self.conversation_id);
            }
        }
    }
}

pub(crate) struct PreparedGeneration {
    conversation_id: String,
    active_node_id: String,
    model: String,
    endpoint: ValidatedEndpoint,
    path: ValidatedPath,
    secret: Option<SecretString>,
    protocol: Protocol,
    reasoning_effort: Option<ReasoningEffort>,
    client: OpenAiCompatibleClient,
    persistence: ConversationPersistenceService,
    lease: GenerationLease,
}

impl PreparedGeneration {
    pub(crate) fn conversation_id(&self) -> &str {
        &self.conversation_id
    }

    pub(crate) fn active_node_id(&self) -> &str {
        &self.active_node_id
    }

    pub(crate) fn model(&self) -> &str {
        &self.model
    }

    pub(crate) async fn run<F, T>(self, on_delta: F, on_thinking: T) -> GenerationRunResult
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
        T: FnMut(&str) -> Result<(), ProviderError>,
    {
        let cancellation = self.lease.cancellation().clone();
        let request = StreamingRequest {
            endpoint: &self.endpoint,
            path: &self.path,
            model: &self.model,
            secret: self.secret.as_ref(),
            cancellation: &cancellation,
            reasoning_effort: self.reasoning_effort,
        };
        let streamed = match self.protocol {
            Protocol::OpenAiCompatible => {
                self.client
                    .stream_with_thinking(request, on_delta, on_thinking)
                    .await
            }
            Protocol::Anthropic => {
                anthropic::stream(&self.client, request, on_delta, on_thinking).await
            }
        };
        let outcome = finish_generation(
            &self.persistence,
            &self.lease,
            streamed,
            PendingAssistant {
                parent_id: self.active_node_id,
                conversation_id: self.conversation_id,
                model: self.model,
            },
        )
        .await;
        GenerationRunResult {
            outcome,
            _lease: self.lease,
        }
    }
}

struct PendingAssistant {
    parent_id: String,
    conversation_id: String,
    model: String,
}

pub(crate) enum GenerationOutcome {
    Completed(Node),
    Failed {
        stage: GenerationStage,
        error: ProviderError,
    },
    Cancelled,
}

pub(crate) struct GenerationRunResult {
    pub(crate) outcome: GenerationOutcome,
    _lease: GenerationLease,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GenerationStage {
    Generation,
    Persistence,
}

async fn finish_generation(
    persistence: &ConversationPersistenceService,
    lease: &GenerationLease,
    streamed: Result<GeneratedContent, ProviderError>,
    pending: PendingAssistant,
) -> GenerationOutcome {
    match streamed {
        Ok(generated) => match lease.begin_finalizing() {
            Ok(true) => {
                let source = SystemIdentityTimeSource;
                match persistence
                    .append_completed_assistant(NewNode {
                        id: source.new_id(),
                        parent_id: Some(pending.parent_id),
                        conversation_id: pending.conversation_id,
                        role: Role::Assistant,
                        content: generated.content,
                        model: Some(pending.model),
                        created_at: source.now_millis(),
                        metadata: generated
                            .thinking
                            .map_or_else(|| json!({}), |thinking| json!({ "thinking": thinking })),
                    })
                    .await
                {
                    Ok(node) => GenerationOutcome::Completed(node),
                    Err(error) => GenerationOutcome::Failed {
                        stage: GenerationStage::Persistence,
                        error: error.into(),
                    },
                }
            }
            Ok(false) => GenerationOutcome::Cancelled,
            Err(error) => GenerationOutcome::Failed {
                stage: GenerationStage::Persistence,
                error,
            },
        },
        Err(ProviderError::Cancelled) => GenerationOutcome::Cancelled,
        Err(error) => GenerationOutcome::Failed {
            stage: GenerationStage::Generation,
            error,
        },
    }
}

pub(crate) async fn prepare_generation(
    pool: SqlitePool,
    profile_service: &ProviderService,
    runtime: &GenerationRuntime,
    conversation_id: String,
    active_node_id: String,
    generation_id: String,
) -> Result<PreparedGeneration, ProviderError> {
    let persistence = ConversationPersistenceService::new(pool);
    let (conversation, path) = persistence
        .load_generation_context(&conversation_id, &active_node_id)
        .await?;
    let (provider, secret) = match conversation.provider_id.as_deref() {
        Some(provider_id) => profile_service.load_by_id_with_secret(provider_id).await?,
        None => profile_service.load_active_with_secret().await?,
    };
    // A provider deletion nulls `conversations.provider_id` (FK SET NULL) but
    // leaves the bound model column behind. The leftover value belongs to the
    // deleted provider, so it must be ignored while the binding is empty.
    let model = match conversation.provider_id.as_deref() {
        Some(_) => conversation.model.unwrap_or_else(|| provider.model.clone()),
        None => provider.model.clone(),
    };
    let endpoint = ValidatedEndpoint::parse(&provider.base_endpoint, provider.protocol)?;
    match provider.protocol {
        Protocol::OpenAiCompatible => {
            openai_compatible::build_request(&path, &model, conversation.reasoning_effort)?;
        }
        Protocol::Anthropic => {
            anthropic::build_request(&path, &model, conversation.reasoning_effort)?;
        }
    }
    let client = OpenAiCompatibleClient::new()?;
    let lease = runtime.reserve(conversation_id.clone(), generation_id)?;

    Ok(PreparedGeneration {
        conversation_id,
        active_node_id,
        model,
        endpoint,
        path,
        secret,
        protocol: provider.protocol,
        reasoning_effort: conversation.reasoning_effort,
        client,
        persistence,
        lease,
    })
}

#[cfg(test)]
mod tests {
    use std::{str::FromStr, sync::Arc};

    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use crate::{
        conversations::{
            ConversationPersistenceService, NewConversation, NewNode, ReasoningEffort, Role,
        },
        database::MIGRATION_CATALOG,
        providers::{NativeCredentialStore, Protocol, ProviderService},
    };

    use super::{
        finish_generation, prepare_generation, GeneratedContent, GenerationOutcome,
        GenerationRuntime, PendingAssistant,
    };

    const GENERATION_A: &str = "11111111-1111-4111-8111-111111111111";
    const GENERATION_B: &str = "33333333-3333-4333-8333-333333333333";

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    async fn seeded_persistence() -> (sqlx::SqlitePool, ConversationPersistenceService) {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        for migration in MIGRATION_CATALOG {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
        }
        let persistence = ConversationPersistenceService::new(pool.clone());
        persistence
            .create_conversation(
                NewConversation {
                    id: "conversation".to_owned(),
                    title: "Generation".to_owned(),
                    root_node_id: "user".to_owned(),
                },
                NewNode {
                    id: "user".to_owned(),
                    parent_id: None,
                    conversation_id: "conversation".to_owned(),
                    role: Role::User,
                    content: "question".to_owned(),
                    model: None,
                    created_at: 1,
                    metadata: json!({}),
                },
            )
            .await
            .unwrap();
        (pool, persistence)
    }

    fn pending() -> PendingAssistant {
        PendingAssistant {
            parent_id: "user".to_owned(),
            conversation_id: "conversation".to_owned(),
            model: "model".to_owned(),
        }
    }

    fn generated(content: &str) -> GeneratedContent {
        GeneratedContent {
            content: content.to_owned(),
            thinking: None,
        }
    }

    async fn insert_provider(pool: &sqlx::SqlitePool, id: &str, protocol: Protocol, model: &str) {
        sqlx::query(
            "INSERT INTO providers \
               (id, name, protocol, base_endpoint, model, credential_ref, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 'https://provider.example/v1', ?4, NULL, 1, 1)",
        )
        .bind(id)
        .bind(id)
        .bind(protocol.as_str())
        .bind(model)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn assistant_count(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM nodes WHERE role = 'assistant'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn runtime_is_per_conversation_and_cancel_is_exact_and_one_shot() {
        let runtime = GenerationRuntime::default();
        let first = runtime
            .reserve("conversation-a".to_owned(), GENERATION_A.to_owned())
            .unwrap();
        let second = runtime
            .reserve("conversation-b".to_owned(), GENERATION_B.to_owned())
            .unwrap();
        assert!(runtime
            .reserve("conversation-a".to_owned(), GENERATION_B.to_owned())
            .is_err());
        assert!(runtime
            .reserve("conversation-c".to_owned(), GENERATION_B.to_owned())
            .is_err());
        assert!(!runtime.cancel("unknown").unwrap());
        assert!(runtime.cancel(GENERATION_A).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(first.cancellation().is_cancelled());
        assert!(!second.cancellation().is_cancelled());
        drop(first);
        drop(second);
        assert_eq!(runtime.active_count(), 0);
    }

    #[test]
    fn finalization_wins_cancel_race_and_holds_the_slot() {
        let runtime = GenerationRuntime::default();
        let lease = runtime
            .reserve("conversation".to_owned(), GENERATION_A.to_owned())
            .unwrap();
        assert!(runtime.begin_finalizing(GENERATION_A).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(runtime
            .reserve("conversation".to_owned(), GENERATION_B.to_owned())
            .is_err());
        drop(lease);
        assert!(runtime
            .reserve("conversation".to_owned(), GENERATION_B.to_owned())
            .is_ok());
    }

    #[test]
    fn successful_provider_result_is_persisted_once_after_finalization() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let outcome = finish_generation(
                &persistence,
                &lease,
                Ok(generated("persisted answer")),
                pending(),
            )
            .await;
            let GenerationOutcome::Completed(node) = outcome else {
                panic!("completed provider result must persist");
            };
            assert_eq!(node.content, "persisted answer");
            assert_eq!(node.metadata, json!({}));
            assert_eq!(assistant_count(&pool).await, 1);
            assert_eq!(runtime.active_count(), 1);
            drop(lease);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn thinking_is_persisted_only_when_the_provider_emits_it() {
        test_runtime().block_on(async {
            let (_, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let outcome = finish_generation(
                &persistence,
                &lease,
                Ok(GeneratedContent {
                    content: "answer".to_owned(),
                    thinking: Some("reasoning trace".to_owned()),
                }),
                pending(),
            )
            .await;
            let GenerationOutcome::Completed(node) = outcome else {
                panic!("completed provider result must persist");
            };
            assert_eq!(node.metadata, json!({ "thinking": "reasoning trace" }));
        });
    }

    #[test]
    fn prepare_generation_prefers_binding_and_falls_back_to_active_provider() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            insert_provider(&pool, "active", Protocol::OpenAiCompatible, "active-model").await;
            insert_provider(&pool, "bound", Protocol::Anthropic, "bound-default").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let service = ProviderService::new(pool.clone(), Arc::new(NativeCredentialStore));
            let runtime = GenerationRuntime::default();

            persistence
                .set_provider_binding(
                    "conversation",
                    Some("bound".to_owned()),
                    Some("bound-override".to_owned()),
                    Some(ReasoningEffort::High),
                )
                .await
                .unwrap();
            let prepared = prepare_generation(
                pool.clone(),
                &service,
                &runtime,
                "conversation".to_owned(),
                "user".to_owned(),
                GENERATION_A.to_owned(),
            )
            .await
            .unwrap();
            assert_eq!(prepared.protocol, Protocol::Anthropic);
            assert_eq!(prepared.model, "bound-override");
            assert_eq!(prepared.reasoning_effort, Some(ReasoningEffort::High));
            drop(prepared);

            persistence
                .set_provider_binding("conversation", None, None, Some(ReasoningEffort::Low))
                .await
                .unwrap();
            let prepared = prepare_generation(
                pool,
                &service,
                &runtime,
                "conversation".to_owned(),
                "user".to_owned(),
                GENERATION_B.to_owned(),
            )
            .await
            .unwrap();
            assert_eq!(prepared.protocol, Protocol::OpenAiCompatible);
            assert_eq!(prepared.model, "active-model");
            assert_eq!(prepared.reasoning_effort, Some(ReasoningEffort::Low));
        });
    }

    #[test]
    fn prepare_generation_ignores_a_stale_model_left_by_provider_deletion() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            insert_provider(&pool, "active", Protocol::OpenAiCompatible, "active-model").await;
            insert_provider(&pool, "bound", Protocol::Anthropic, "bound-default").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            persistence
                .set_provider_binding(
                    "conversation",
                    Some("bound".to_owned()),
                    Some("bound-override".to_owned()),
                    None,
                )
                .await
                .unwrap();
            // Deleting the bound provider nulls provider_id but leaves the
            // stale `model` column in place (FK SET NULL does not touch it).
            sqlx::query("DELETE FROM providers WHERE id = 'bound'")
                .execute(&pool)
                .await
                .unwrap();
            let service = ProviderService::new(pool.clone(), Arc::new(NativeCredentialStore));
            let prepared = prepare_generation(
                pool,
                &service,
                &GenerationRuntime::default(),
                "conversation".to_owned(),
                "user".to_owned(),
                GENERATION_A.to_owned(),
            )
            .await
            .unwrap();
            assert_eq!(prepared.protocol, Protocol::OpenAiCompatible);
            assert_eq!(prepared.model, "active-model");
        });
    }

    #[test]
    fn prepared_generation_snapshots_survive_concurrent_provider_changes() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            insert_provider(&pool, "active", Protocol::OpenAiCompatible, "active-model").await;
            insert_provider(&pool, "other", Protocol::Anthropic, "other-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let service = ProviderService::new(pool.clone(), Arc::new(NativeCredentialStore));
            let runtime = GenerationRuntime::default();
            let prepared = prepare_generation(
                pool.clone(),
                &service,
                &runtime,
                "conversation".to_owned(),
                "user".to_owned(),
                GENERATION_A.to_owned(),
            )
            .await
            .unwrap();
            assert_eq!(prepared.protocol, Protocol::OpenAiCompatible);
            assert_eq!(prepared.model, "active-model");

            // In-flight isolation (PRD R1/R3): editing settings, rebinding the
            // conversation, and deleting the in-flight provider must not alter
            // the snapshot the running request was prepared from.
            sqlx::query("UPDATE app_settings SET value = 'other' WHERE key = 'active_provider_id'")
                .execute(&pool)
                .await
                .unwrap();
            persistence
                .set_provider_binding(
                    "conversation",
                    Some("other".to_owned()),
                    Some("other-override".to_owned()),
                    Some(ReasoningEffort::High),
                )
                .await
                .unwrap();
            sqlx::query("DELETE FROM providers WHERE id = 'active'")
                .execute(&pool)
                .await
                .unwrap();

            assert_eq!(prepared.protocol, Protocol::OpenAiCompatible);
            assert_eq!(prepared.model, "active-model");
            assert_eq!(prepared.reasoning_effort, None);
        });
    }

    #[test]
    fn finalization_rejects_late_cancel_and_holds_the_slot_through_persistence() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let mut blocker = pool.acquire().await.unwrap();
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let worker = tokio::spawn(async move {
                let outcome = finish_generation(
                    &persistence,
                    &lease,
                    Ok(generated("persist despite late cancel")),
                    pending(),
                )
                .await;
                (outcome, lease)
            });

            for _ in 0..100 {
                if runtime.is_finalizing(GENERATION_A) {
                    break;
                }
                tokio::task::yield_now().await;
            }
            assert!(runtime.is_finalizing(GENERATION_A));
            assert!(!runtime.cancel(GENERATION_A).unwrap());
            assert!(runtime
                .reserve("conversation".to_owned(), GENERATION_B.to_owned())
                .is_err());
            let count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM nodes WHERE role = 'assistant'")
                    .fetch_one(&mut *blocker)
                    .await
                    .unwrap();
            assert_eq!(count, 0);

            drop(blocker);
            let (outcome, lease) = worker.await.unwrap();
            assert!(matches!(outcome, GenerationOutcome::Completed(_)));
            assert_eq!(assistant_count(&pool).await, 1);
            assert_eq!(runtime.active_count(), 1);
            drop(lease);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn cancellation_or_channel_failure_before_finalization_persists_nothing() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            assert!(runtime.cancel(GENERATION_A).unwrap());
            assert!(matches!(
                finish_generation(
                    &persistence,
                    &lease,
                    Ok(generated("cancelled answer")),
                    pending(),
                )
                .await,
                GenerationOutcome::Cancelled
            ));
            drop(lease);

            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_B.to_owned())
                .unwrap();
            assert!(matches!(
                finish_generation(
                    &persistence,
                    &lease,
                    Err(super::ProviderError::Cancelled),
                    pending(),
                )
                .await,
                GenerationOutcome::Cancelled
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            drop(lease);
        });
    }

    #[test]
    fn provider_failure_is_typed_as_generation_stage_and_persists_nothing() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            assert!(matches!(
                finish_generation(
                    &persistence,
                    &lease,
                    Err(super::ProviderError::Unavailable),
                    pending(),
                )
                .await,
                GenerationOutcome::Failed {
                    stage: super::GenerationStage::Generation,
                    ..
                }
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 1);
            drop(lease);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn persistence_failure_is_typed_and_releases_the_slot() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            persistence
                .archive_conversation("conversation")
                .await
                .unwrap();
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            assert!(matches!(
                finish_generation(&persistence, &lease, Ok(generated("late")), pending()).await,
                GenerationOutcome::Failed {
                    stage: super::GenerationStage::Persistence,
                    ..
                }
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 1);
            drop(lease);
            assert_eq!(runtime.active_count(), 0);
        });
    }
}
