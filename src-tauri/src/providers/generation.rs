use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{future::select, FutureExt};
use secrecy::SecretString;
use serde_json::json;
use sqlx::SqlitePool;
use tokio::{sync::oneshot, time::Instant};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::conversations::{
    commands::{IdentityTimeSource, SystemIdentityTimeSource},
    ConversationPersistenceService, NewNode, Node, Role, ValidatedPath,
};

use super::{
    openai_compatible::{build_request, OpenAiCompatibleClient},
    ProviderError, ProviderProfileService, ValidatedEndpoint,
};

const DEFAULT_COMMIT_TIMEOUT: Duration = Duration::from_secs(30);

struct GenerationEntry {
    generation_id: String,
    cancellation: CancellationToken,
    phase: GenerationPhase,
}

enum GenerationPhase {
    Running,
    AwaitingCommit {
        commit_token: String,
        deadline: Instant,
        acknowledgement: oneshot::Sender<()>,
    },
    Committing,
    Cancelling,
}

#[derive(Clone)]
pub struct GenerationRuntime {
    entries: Arc<Mutex<HashMap<String, GenerationEntry>>>,
    commit_timeout: Duration,
}

impl Default for GenerationRuntime {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            commit_timeout: DEFAULT_COMMIT_TIMEOUT,
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
        if !matches!(
            entry.phase,
            GenerationPhase::Running | GenerationPhase::AwaitingCommit { .. }
        ) {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Cancelling;
        entry.cancellation.cancel();
        Ok(true)
    }

    pub fn commit(&self, generation_id: &str, commit_token: &str) -> Result<bool, ProviderError> {
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

        let expired = matches!(
            &entry.phase,
            GenerationPhase::AwaitingCommit { deadline, .. } if Instant::now() >= *deadline
        );
        if expired {
            entry.phase = GenerationPhase::Cancelling;
            entry.cancellation.cancel();
            return Ok(false);
        }
        let exact = matches!(
            &entry.phase,
            GenerationPhase::AwaitingCommit {
                commit_token: expected,
                ..
            } if expected == commit_token
        );
        if !exact {
            return Ok(false);
        }

        let previous = std::mem::replace(&mut entry.phase, GenerationPhase::Committing);
        let GenerationPhase::AwaitingCommit {
            acknowledgement, ..
        } = previous
        else {
            return Err(ProviderError::RuntimeInvariant);
        };
        let _worker_wakeup = acknowledgement.send(());
        Ok(true)
    }

    fn expire(&self, generation_id: &str) -> Result<bool, ProviderError> {
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
        let expired = matches!(
            &entry.phase,
            GenerationPhase::AwaitingCommit { deadline, .. } if Instant::now() >= *deadline
        );
        if !expired {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Cancelling;
        entry.cancellation.cancel();
        Ok(true)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.entries.lock().map_or(0, |entries| entries.len())
    }

    #[cfg(test)]
    fn with_commit_timeout(commit_timeout: Duration) -> Self {
        Self {
            commit_timeout,
            ..Self::default()
        }
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

    async fn await_commit<F>(&self, send_ready: F) -> Result<bool, ProviderError>
    where
        F: FnOnce(&str) -> Result<(), ProviderError>,
    {
        let commit_token = Uuid::new_v4().to_string();
        let deadline = Instant::now() + self.runtime.commit_timeout;
        let (acknowledgement, receiver) = oneshot::channel();

        {
            let mut entries = self
                .runtime
                .entries
                .lock()
                .map_err(|_| ProviderError::RuntimeInvariant)?;
            let Some(entry) = entries.get_mut(&self.conversation_id) else {
                return Err(ProviderError::RuntimeInvariant);
            };
            if entry.generation_id != self.generation_id
                || !matches!(entry.phase, GenerationPhase::Running)
                || entry.cancellation.is_cancelled()
            {
                return Ok(false);
            }
            entry.phase = GenerationPhase::AwaitingCommit {
                commit_token: commit_token.clone(),
                deadline,
                acknowledgement,
            };
            if let Err(error) = send_ready(&commit_token) {
                entry.phase = GenerationPhase::Cancelling;
                entry.cancellation.cancel();
                return match error {
                    ProviderError::Cancelled => Ok(false),
                    other => Err(other),
                };
            }
        }

        match select(receiver.boxed(), tokio::time::sleep_until(deadline).boxed()).await {
            futures_util::future::Either::Left((acknowledgement, _)) => Ok(acknowledgement.is_ok()),
            futures_util::future::Either::Right(((), receiver)) => {
                if self.runtime.expire(&self.generation_id)? {
                    return Ok(false);
                }
                Ok(receiver.await.is_ok())
            }
        }
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

    pub(crate) async fn run<F, R>(self, on_delta: F, on_ready: R) -> GenerationOutcome
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
        R: FnOnce(&str) -> Result<(), ProviderError>,
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
        finish_generation(
            &self.persistence,
            self.lease,
            streamed,
            PendingAssistant {
                parent_id: self.active_node_id,
                conversation_id: self.conversation_id,
                model: self.model,
            },
            on_ready,
        )
        .await
    }
}

struct PendingAssistant {
    parent_id: String,
    conversation_id: String,
    model: String,
}

pub(crate) enum GenerationOutcome {
    Completed(Node),
    Failed(ProviderError),
    Cancelled,
}

async fn finish_generation<F>(
    persistence: &ConversationPersistenceService,
    lease: GenerationLease,
    streamed: Result<String, ProviderError>,
    pending: PendingAssistant,
    on_ready: F,
) -> GenerationOutcome
where
    F: FnOnce(&str) -> Result<(), ProviderError>,
{
    match streamed {
        Ok(content) => match lease.await_commit(on_ready).await {
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
                    Err(error) => GenerationOutcome::Failed(error.into()),
                }
            }
            Ok(false) => GenerationOutcome::Cancelled,
            Err(error) => GenerationOutcome::Failed(error),
        },
        Err(ProviderError::Cancelled) => GenerationOutcome::Cancelled,
        Err(error) => GenerationOutcome::Failed(error),
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
    let lease = runtime.reserve(conversation_id.clone(), generation_id.clone())?;

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
    use std::{str::FromStr, time::Duration};

    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tokio::sync::oneshot;
    use uuid::{Uuid, Version};

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
    fn registry_is_per_conversation_and_exact_cancel_is_one_shot() {
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
        assert!(!runtime
            .cancel("00000000-0000-4000-8000-000000000000")
            .unwrap());
        assert!(runtime.cancel(GENERATION_A).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(first.cancellation().is_cancelled());
        assert!(!second.cancellation().is_cancelled());
        drop(first);
        drop(second);
        assert_eq!(runtime.active_count(), 0);
    }

    #[test]
    fn not_ready_and_stale_controls_do_not_disturb_the_live_generation() {
        let runtime = GenerationRuntime::default();
        let first = runtime
            .reserve("conversation-a".to_owned(), GENERATION_A.to_owned())
            .unwrap();
        assert!(!runtime.commit(GENERATION_A, GENERATION_B).unwrap());
        assert!(!first.cancellation().is_cancelled());
        assert!(runtime.cancel(GENERATION_A).unwrap());
        drop(first);

        let second = runtime
            .reserve("conversation-a".to_owned(), GENERATION_B.to_owned())
            .unwrap();
        assert!(!runtime.commit(GENERATION_A, GENERATION_B).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(!second.cancellation().is_cancelled());
        assert!(runtime.cancel(GENERATION_B).unwrap());
    }

    #[test]
    fn exact_ack_is_one_shot_and_no_row_exists_before_it() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker_persistence = persistence.clone();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &worker_persistence,
                    lease,
                    Ok("persisted answer".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });

            let token = ready_rx.await.unwrap();
            let parsed = Uuid::parse_str(&token).unwrap();
            assert_eq!(parsed.get_version(), Some(Version::Random));
            assert_eq!(assistant_count(&pool).await, 0);
            assert!(runtime
                .reserve("conversation".to_owned(), GENERATION_B.to_owned())
                .is_err());
            assert!(!runtime.commit(GENERATION_A, GENERATION_B).unwrap());
            assert!(runtime.commit(GENERATION_A, &token).unwrap());
            assert!(!runtime.commit(GENERATION_A, &token).unwrap());
            assert!(!runtime.cancel(GENERATION_A).unwrap());

            let node = match worker.await.unwrap() {
                GenerationOutcome::Completed(node) => node,
                _ => panic!("accepted acknowledgement must permit commit"),
            };
            assert_eq!(node.content, "persisted answer");
            assert_eq!(assistant_count(&pool).await, 1);
            assert_eq!(runtime.active_count(), 0);
            assert!(!runtime.cancel(GENERATION_A).unwrap());
        });
    }

    #[test]
    fn cancel_wins_before_ack_and_ready_send_failure_persist_nothing() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker_persistence = persistence.clone();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &worker_persistence,
                    lease,
                    Ok("cancelled answer".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });
            let token = ready_rx.await.unwrap();
            assert!(runtime.cancel(GENERATION_A).unwrap());
            assert!(!runtime.commit(GENERATION_A, &token).unwrap());
            assert!(matches!(
                worker.await.unwrap(),
                GenerationOutcome::Cancelled
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 0);

            let failed_ready = runtime
                .reserve("conversation".to_owned(), GENERATION_B.to_owned())
                .unwrap();
            assert!(matches!(
                finish_generation(
                    &persistence,
                    failed_ready,
                    Ok("undelivered".to_owned()),
                    pending(),
                    |_| Err(super::ProviderError::Cancelled),
                )
                .await,
                GenerationOutcome::Cancelled
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn timeout_wins_under_paused_time_and_releases_the_slot() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            tokio::time::pause();
            let runtime = GenerationRuntime::with_commit_timeout(Duration::from_secs(30));
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &persistence,
                    lease,
                    Ok("expired".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });
            let token = ready_rx.await.unwrap();
            tokio::time::advance(Duration::from_secs(31)).await;
            assert!(matches!(
                worker.await.unwrap(),
                GenerationOutcome::Cancelled
            ));
            assert!(!runtime.commit(GENERATION_A, &token).unwrap());
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn commit_before_the_monotonic_deadline_wins_over_the_timer() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            tokio::time::pause();
            let runtime = GenerationRuntime::with_commit_timeout(Duration::from_secs(30));
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &persistence,
                    lease,
                    Ok("committed before deadline".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });
            let token = ready_rx.await.unwrap();
            tokio::time::advance(Duration::from_secs(29)).await;
            assert!(runtime.commit(GENERATION_A, &token).unwrap());
            tokio::time::advance(Duration::from_secs(2)).await;
            assert!(matches!(
                worker.await.unwrap(),
                GenerationOutcome::Completed(_)
            ));
            assert_eq!(assistant_count(&pool).await, 1);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn archive_failure_after_ack_writes_nothing_and_releases_the_slot() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::with_commit_timeout(Duration::from_secs(30));
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker_persistence = persistence.clone();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &worker_persistence,
                    lease,
                    Ok("late archived answer".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });
            let token = ready_rx.await.unwrap();
            let mut blocker = pool.acquire().await.unwrap();
            assert!(runtime.commit(GENERATION_A, &token).unwrap());
            assert!(runtime
                .reserve("conversation".to_owned(), GENERATION_B.to_owned())
                .is_err());
            sqlx::query("UPDATE conversations SET is_archived = 1 WHERE id = 'conversation'")
                .execute(&mut *blocker)
                .await
                .unwrap();
            drop(blocker);
            assert!(matches!(
                worker.await.unwrap(),
                GenerationOutcome::Failed(super::ProviderError::Persistence(_))
            ));
            assert_eq!(assistant_count(&pool).await, 0);
            assert_eq!(runtime.active_count(), 0);
        });
    }

    #[test]
    fn database_failure_after_ack_is_failed_and_releases_the_slot() {
        test_runtime().block_on(async {
            let (pool, persistence) = seeded_persistence().await;
            let runtime = GenerationRuntime::default();
            let lease = runtime
                .reserve("conversation".to_owned(), GENERATION_A.to_owned())
                .unwrap();
            let (ready_tx, ready_rx) = oneshot::channel();
            let worker = tokio::spawn(async move {
                finish_generation(
                    &persistence,
                    lease,
                    Ok("database unavailable".to_owned()),
                    pending(),
                    move |token| {
                        ready_tx
                            .send(token.to_owned())
                            .map_err(|_| super::ProviderError::RuntimeInvariant)
                    },
                )
                .await
            });
            let token = ready_rx.await.unwrap();
            pool.close().await;
            assert!(runtime.commit(GENERATION_A, &token).unwrap());
            assert!(matches!(
                worker.await.unwrap(),
                GenerationOutcome::Failed(super::ProviderError::Persistence(_))
            ));
            assert_eq!(runtime.active_count(), 0);
        });
    }
}
