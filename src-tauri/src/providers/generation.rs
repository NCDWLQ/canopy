use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use secrecy::SecretString;
use serde_json::json;
use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

use crate::conversations::{
    commands::{IdentityTimeSource, SystemIdentityTimeSource},
    ConversationPersistenceService, NewNode, Node, Role, ValidatedPath,
};

use super::{
    openai_compatible::{build_request, OpenAiCompatibleClient},
    ProviderError, ProviderProfileService, ValidatedEndpoint,
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

    pub(crate) async fn run<F>(self, on_delta: F) -> GenerationRunResult
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
    {
        let cancellation = self.lease.cancellation().clone();
        let streamed = self
            .client
            .stream(
                &self.endpoint,
                &self.path,
                &self.model,
                self.secret.as_ref(),
                &cancellation,
                on_delta,
            )
            .await;
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
    streamed: Result<String, ProviderError>,
    pending: PendingAssistant,
) -> GenerationOutcome {
    match streamed {
        Ok(content) => match lease.begin_finalizing() {
            Ok(true) => {
                let source = SystemIdentityTimeSource;
                match persistence
                    .append_completed_assistant(NewNode {
                        id: source.new_id(),
                        parent_id: Some(pending.parent_id),
                        conversation_id: pending.conversation_id,
                        role: Role::Assistant,
                        content,
                        model: Some(pending.model),
                        created_at: source.now_millis(),
                        metadata: json!({}),
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
    profile_service: &ProviderProfileService,
    runtime: &GenerationRuntime,
    conversation_id: String,
    active_node_id: String,
    generation_id: String,
) -> Result<PreparedGeneration, ProviderError> {
    let persistence = ConversationPersistenceService::new(pool);
    let (_, path) = persistence
        .load_generation_context(&conversation_id, &active_node_id)
        .await?;
    let (profile, secret) = profile_service.load_with_secret().await?;
    let endpoint = ValidatedEndpoint::parse(&profile.base_endpoint)?;
    build_request(&path, &profile.model)?;
    let client = OpenAiCompatibleClient::new()?;
    let lease = runtime.reserve(conversation_id.clone(), generation_id)?;

    Ok(PreparedGeneration {
        conversation_id,
        active_node_id,
        model: profile.model,
        endpoint,
        path,
        secret,
        client,
        persistence,
        lease,
    })
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use crate::{
        conversations::{ConversationPersistenceService, NewConversation, NewNode, Role},
        database::MIGRATION_CATALOG,
    };

    use super::{finish_generation, GenerationOutcome, GenerationRuntime, PendingAssistant};

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
                Ok("persisted answer".to_owned()),
                pending(),
            )
            .await;
            let GenerationOutcome::Completed(node) = outcome else {
                panic!("completed provider result must persist");
            };
            assert_eq!(node.content, "persisted answer");
            assert_eq!(assistant_count(&pool).await, 1);
            assert_eq!(runtime.active_count(), 1);
            drop(lease);
            assert_eq!(runtime.active_count(), 0);
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
                    Ok("persist despite late cancel".to_owned()),
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
                    Ok("cancelled answer".to_owned()),
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
                finish_generation(&persistence, &lease, Ok("late".to_owned()), pending()).await,
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
