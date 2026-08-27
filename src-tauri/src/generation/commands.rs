use std::sync::Arc;

use tauri::{ipc::Channel, State};
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::{
    conversations::dto::{ConversationProviderBindingResult, SetConversationProviderRequest},
    error::CommandError,
    infra::database::managed_sqlite_pool,
    llm::LlmError,
    providers::{domain::validate_model, NativeCredentialStore, ProviderService},
};

use super::{
    prepare_generation, set_conversation_provider_binding, spawn_auto_title, GenerationOutcome,
    GenerationRuntime, GenerationStage,
};

pub use super::dto::{
    CancelGenerationRequest, CancelGenerationResult, GenerateFromActivePathRequest,
    GenerationEventDto, GenerationFailureStage, GenerationTerminalDto,
};

/// Frozen IPC names owned by generation. `generate_from_active_path` and
/// `cancel_generation` remain listed in the provider fixture catalog so the
/// frontend command-name contract is unchanged.
pub const GENERATION_COMMAND_NAMES: &[&str] = &[
    "set_conversation_provider",
    "generate_from_active_path",
    "cancel_generation",
];

fn production_provider_service(pool: sqlx::SqlitePool) -> ProviderService {
    ProviderService::new(pool, Arc::new(NativeCredentialStore))
}

fn validate_id(field: &'static str, value: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() {
        Err(CommandError::invalid_input(field, "blank"))
    } else {
        Ok(())
    }
}

fn validate_uuid_v4(field: &'static str, value: &str) -> Result<(), CommandError> {
    if !super::dto::is_canonical_uuid_v4(value) {
        Err(CommandError::invalid_input(field, "invalid_uuid_v4"))
    } else {
        Ok(())
    }
}

/// Sends `started` before `run` begins. Content events are emitted by `run`
/// through the same Channel; the terminal is the return value and is never
/// sent as a Channel event. `Err` means the started event was not delivered.
pub(crate) async fn run_after_started<S, R, Fut>(
    generation_id: String,
    conversation_id: String,
    active_node_id: String,
    model: String,
    send: S,
    run: R,
) -> Result<GenerationTerminalDto, GenerationTerminalDto>
where
    S: Fn(GenerationEventDto) -> Result<(), LlmError>,
    R: FnOnce() -> Fut,
    Fut: std::future::Future<Output = GenerationOutcome>,
{
    let started = GenerationEventDto::Started {
        generation_id: generation_id.clone(),
        conversation_id,
        active_node_id,
        model,
    };
    if send(started).is_err() {
        return Err(GenerationTerminalDto::Cancelled { generation_id });
    }
    Ok(map_generation_outcome(generation_id, run().await))
}

pub(crate) fn map_generation_outcome(
    generation_id: String,
    outcome: GenerationOutcome,
) -> GenerationTerminalDto {
    match outcome {
        GenerationOutcome::Completed(node) => GenerationTerminalDto::Completed {
            generation_id,
            node: node.into(),
        },
        GenerationOutcome::Failed { stage, error } => GenerationTerminalDto::Failed {
            generation_id,
            stage: match stage {
                GenerationStage::Generation => GenerationFailureStage::Generation,
                GenerationStage::Persistence => GenerationFailureStage::Persistence,
            },
            error: CommandError::from(error),
        },
        GenerationOutcome::Cancelled => GenerationTerminalDto::Cancelled { generation_id },
    }
}

#[tauri::command]
pub async fn set_conversation_provider(
    request: SetConversationProviderRequest,
    instances: State<'_, DbInstances>,
) -> Result<ConversationProviderBindingResult, CommandError> {
    validate_id("conversation_id", &request.conversation_id)?;
    let (provider_id, model) = match request.binding {
        Some(binding) => {
            validate_id("provider_id", &binding.provider_id)?;
            let model = validate_model(&binding.model).map_err(CommandError::from)?;
            (Some(binding.provider_id), Some(model))
        }
        None => (None, None),
    };
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    set_conversation_provider_binding(
        pool,
        &request.conversation_id,
        provider_id,
        model,
        request.reasoning_effort.map(Into::into),
    )
    .await
    .map(ConversationProviderBindingResult::from)
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn generate_from_active_path<R: tauri::Runtime>(
    request: GenerateFromActivePathRequest,
    on_event: Channel<GenerationEventDto>,
    app: tauri::AppHandle<R>,
    instances: State<'_, DbInstances>,
    runtime: State<'_, GenerationRuntime>,
) -> Result<GenerationTerminalDto, CommandError> {
    validate_id("conversation_id", &request.conversation_id)?;
    validate_id("active_node_id", &request.active_node_id)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let profile_service = production_provider_service(pool.clone());
    let generation_id = Uuid::new_v4().to_string();
    let prepared = prepare_generation(
        pool.clone(),
        &profile_service,
        runtime.inner(),
        request.conversation_id.clone(),
        request.active_node_id.clone(),
        generation_id.clone(),
    )
    .await
    .map_err(CommandError::from)?;

    let event_channel = on_event.clone();
    let delta_channel = on_event.clone();
    let thinking_channel = on_event.clone();
    let delta_generation_id = generation_id.clone();
    let thinking_generation_id = generation_id.clone();
    match run_after_started(
        generation_id.clone(),
        prepared.conversation_id().to_owned(),
        prepared.active_node_id().to_owned(),
        prepared.model().to_owned(),
        move |event| event_channel.send(event).map_err(|_| LlmError::Cancelled),
        || async move {
            prepared
                .run(
                    move |content| {
                        delta_channel
                            .send(GenerationEventDto::Delta {
                                generation_id: delta_generation_id.clone(),
                                content: content.to_owned(),
                            })
                            .map_err(|_| LlmError::Cancelled)
                    },
                    move |content| {
                        thinking_channel
                            .send(GenerationEventDto::ThinkingDelta {
                                generation_id: thinking_generation_id.clone(),
                                content: content.to_owned(),
                            })
                            .map_err(|_| LlmError::Cancelled)
                    },
                )
                .await
                .outcome
        },
    )
    .await
    {
        Err(cancelled) => {
            let _ = runtime.inner().cancel(&generation_id);
            Ok(cancelled)
        }
        Ok(terminal) => {
            if let GenerationTerminalDto::Completed { node, .. } = &terminal {
                spawn_auto_title(pool, profile_service, app, node.conversation_id.clone());
            }
            Ok(terminal)
        }
    }
}

#[tauri::command]
pub fn cancel_generation(
    request: CancelGenerationRequest,
    runtime: State<'_, GenerationRuntime>,
) -> Result<CancelGenerationResult, CommandError> {
    validate_uuid_v4("generation_id", &request.generation_id)?;
    runtime
        .cancel(&request.generation_id)
        .map(|accepted| CancelGenerationResult { accepted })
        .map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    use serde_json::json;

    use crate::{
        conversations::{PersistenceError, Role},
        generation::{GenerationOutcome, GenerationStage},
        llm::LlmError,
    };

    use super::{
        map_generation_outcome, run_after_started, validate_uuid_v4, GenerationEventDto,
        GenerationFailureStage, GenerationTerminalDto,
    };

    const GENERATION_A: &str = "11111111-1111-4111-8111-111111111111";

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    fn assistant_node() -> crate::conversations::Node {
        crate::conversations::Node {
            id: "assistant".to_owned(),
            parent_id: Some("user".to_owned()),
            conversation_id: "conversation".to_owned(),
            role: Role::Assistant,
            content: "answer".to_owned(),
            model: Some("model".to_owned()),
            created_at: 1,
            metadata: json!({}),
        }
    }

    #[test]
    fn generation_ids_require_canonical_uuid_v4() {
        assert!(validate_uuid_v4("generation_id", "11111111-1111-4111-8111-111111111111").is_ok());
        for invalid in [
            "",
            "generation",
            "11111111-1111-3111-8111-111111111111",
            "11111111-1111-4111-7111-111111111111",
            "11111111-1111-4111-8111-11111111111A",
        ] {
            assert!(validate_uuid_v4("generation_id", invalid).is_err());
        }
    }

    #[test]
    fn generation_channel_sends_started_before_content_and_returns_unique_terminal() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let send = {
            let events = events.clone();
            move |event: GenerationEventDto| {
                events.lock().unwrap().push(event);
                Ok(())
            }
        };
        let events_for_run = events.clone();
        let terminal = test_runtime().block_on(async {
            run_after_started(
                GENERATION_A.to_owned(),
                "conversation".to_owned(),
                "user".to_owned(),
                "model".to_owned(),
                send,
                || {
                    let events_for_run = events_for_run.clone();
                    async move {
                        events_for_run
                            .lock()
                            .unwrap()
                            .push(GenerationEventDto::ThinkingDelta {
                                generation_id: GENERATION_A.to_owned(),
                                content: "think".to_owned(),
                            });
                        events_for_run
                            .lock()
                            .unwrap()
                            .push(GenerationEventDto::Delta {
                                generation_id: GENERATION_A.to_owned(),
                                content: "answer".to_owned(),
                            });
                        GenerationOutcome::Completed(assistant_node())
                    }
                },
            )
            .await
            .expect("started send succeeds")
        });
        let recorded = events.lock().unwrap().clone();
        assert!(matches!(
            recorded.as_slice(),
            [
                GenerationEventDto::Started { .. },
                GenerationEventDto::ThinkingDelta { .. },
                GenerationEventDto::Delta { .. }
            ]
        ));
        assert!(matches!(
            terminal,
            GenerationTerminalDto::Completed { generation_id, .. }
                if generation_id == GENERATION_A
        ));
    }

    #[test]
    fn generation_channel_failure_before_run_returns_cancelled_without_running() {
        let ran = Arc::new(AtomicBool::new(false));
        let ran_for_run = ran.clone();
        let terminal = test_runtime().block_on(async {
            run_after_started(
                GENERATION_A.to_owned(),
                "conversation".to_owned(),
                "user".to_owned(),
                "model".to_owned(),
                |_| Err(LlmError::Cancelled),
                || {
                    ran_for_run.store(true, Ordering::SeqCst);
                    async { panic!("run must not start after started send fails") }
                },
            )
            .await
            .expect_err("started failure is cancelled")
        });
        assert!(!ran.load(Ordering::SeqCst));
        assert!(matches!(
            terminal,
            GenerationTerminalDto::Cancelled { generation_id }
                if generation_id == GENERATION_A
        ));
    }

    #[test]
    fn generation_terminal_is_unique_and_retains_failure_stage() {
        let completed = map_generation_outcome(
            GENERATION_A.to_owned(),
            GenerationOutcome::Completed(assistant_node()),
        );
        let cancelled =
            map_generation_outcome(GENERATION_A.to_owned(), GenerationOutcome::Cancelled);
        let generation_failed = map_generation_outcome(
            GENERATION_A.to_owned(),
            GenerationOutcome::Failed {
                stage: GenerationStage::Generation,
                error: LlmError::Unavailable.into(),
            },
        );
        let persistence_failed = map_generation_outcome(
            GENERATION_A.to_owned(),
            GenerationOutcome::Failed {
                stage: GenerationStage::Persistence,
                error: PersistenceError::DatabaseUnavailable.into(),
            },
        );
        assert!(matches!(completed, GenerationTerminalDto::Completed { .. }));
        assert!(matches!(cancelled, GenerationTerminalDto::Cancelled { .. }));
        assert!(matches!(
            generation_failed,
            GenerationTerminalDto::Failed {
                stage: GenerationFailureStage::Generation,
                ..
            }
        ));
        assert!(matches!(
            persistence_failed,
            GenerationTerminalDto::Failed {
                stage: GenerationFailureStage::Persistence,
                ..
            }
        ));
    }
}
