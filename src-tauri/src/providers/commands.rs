use std::sync::Arc;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::{
    conversations::commands::{IdentityTimeSource, NodeDto, SystemIdentityTimeSource},
    database::managed_sqlite_pool,
    error::CommandError,
};

use super::{
    generation::{prepare_generation, GenerationOutcome},
    ApiKeyAction, GenerationRuntime, NativeCredentialStore, ProviderError, ProviderProfileInput,
    ProviderProfileService, RedactedProviderProfile,
};

pub const PROVIDER_COMMAND_NAMES: &[&str] = &[
    "save_provider_profile",
    "load_provider_profile",
    "delete_provider_profile",
    "generate_from_active_path",
    "cancel_generation",
    "commit_generation",
];

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ApiKeyActionDto {
    Keep,
    Replace { value: String },
    Remove,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SaveProviderProfileRequest {
    pub base_endpoint: String,
    pub model: String,
    pub api_key: ApiKeyActionDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoadProviderProfileRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteProviderProfileRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ProviderProfileDto {
    pub base_endpoint: String,
    pub model: String,
    pub has_api_key: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteProviderProfileResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GenerateFromActivePathRequest {
    pub conversation_id: String,
    pub active_node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CancelGenerationRequest {
    pub generation_id: String,
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CommitGenerationRequest {
    pub generation_id: String,
    pub commit_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GenerationStartResult {
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub generation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CancelGenerationResult {
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CommitGenerationResult {
    pub accepted: bool,
}

#[derive(Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationEventDto {
    Started {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        conversation_id: String,
        active_node_id: String,
        model: String,
    },
    Delta {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        content: String,
    },
    ReadyToCommit {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        commit_token: String,
    },
    Completed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        node: NodeDto,
    },
    Failed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        error: CommandError,
    },
    Cancelled {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
    },
}

impl From<RedactedProviderProfile> for ProviderProfileDto {
    fn from(profile: RedactedProviderProfile) -> Self {
        Self {
            base_endpoint: profile.base_endpoint,
            model: profile.model,
            has_api_key: profile.has_api_key,
            updated_at: profile.updated_at,
        }
    }
}

fn production_service(pool: sqlx::SqlitePool) -> ProviderProfileService {
    ProviderProfileService::new(pool, Arc::new(NativeCredentialStore))
}

#[tauri::command]
pub async fn save_provider_profile(
    request: SaveProviderProfileRequest,
    instances: State<'_, DbInstances>,
) -> Result<ProviderProfileDto, CommandError> {
    let source = SystemIdentityTimeSource;
    let api_key = match request.api_key {
        ApiKeyActionDto::Keep => ApiKeyAction::Keep,
        ApiKeyActionDto::Replace { value } => ApiKeyAction::Replace(SecretString::from(value)),
        ApiKeyActionDto::Remove => ApiKeyAction::Remove,
    };
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .save(
            ProviderProfileInput {
                base_endpoint: request.base_endpoint,
                model: request.model,
                api_key,
            },
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            source.now_millis(),
        )
        .await
        .map(ProviderProfileDto::from)
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn load_provider_profile(
    _request: LoadProviderProfileRequest,
    instances: State<'_, DbInstances>,
) -> Result<ProviderProfileDto, CommandError> {
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .load()
        .await
        .map(ProviderProfileDto::from)
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn delete_provider_profile(
    _request: DeleteProviderProfileRequest,
    instances: State<'_, DbInstances>,
) -> Result<DeleteProviderProfileResult, CommandError> {
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .delete(Uuid::new_v4().to_string())
        .await
        .map(|deleted| DeleteProviderProfileResult { deleted })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn generate_from_active_path(
    request: GenerateFromActivePathRequest,
    on_event: Channel<GenerationEventDto>,
    instances: State<'_, DbInstances>,
    runtime: State<'_, GenerationRuntime>,
) -> Result<GenerationStartResult, CommandError> {
    validate_id("conversation_id", &request.conversation_id)?;
    validate_id("active_node_id", &request.active_node_id)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let profile_service = production_service(pool.clone());
    let generation_id = Uuid::new_v4().to_string();
    let prepared = prepare_generation(
        pool,
        &profile_service,
        runtime.inner(),
        request.conversation_id.clone(),
        request.active_node_id.clone(),
        generation_id.clone(),
    )
    .await
    .map_err(CommandError::from)?;

    let result = GenerationStartResult {
        generation_id: generation_id.clone(),
    };
    let started = GenerationEventDto::Started {
        generation_id: generation_id.clone(),
        conversation_id: prepared.conversation_id().to_owned(),
        active_node_id: prepared.active_node_id().to_owned(),
        model: prepared.model().to_owned(),
    };
    let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
    tauri::async_runtime::spawn(async move {
        if on_event.send(started).is_err() {
            let _ignored_receiver = started_sender.send(false);
            return;
        }
        let _ignored_receiver = started_sender.send(true);

        let delta_channel = on_event.clone();
        let ready_channel = on_event.clone();
        let delta_generation_id = generation_id.clone();
        let ready_generation_id = generation_id.clone();
        let outcome = prepared
            .run(
                move |content| {
                    delta_channel
                        .send(GenerationEventDto::Delta {
                            generation_id: delta_generation_id.clone(),
                            content: content.to_owned(),
                        })
                        .map_err(|_| ProviderError::Cancelled)
                },
                move |commit_token| {
                    ready_channel
                        .send(GenerationEventDto::ReadyToCommit {
                            generation_id: ready_generation_id,
                            commit_token: commit_token.to_owned(),
                        })
                        .map_err(|_| ProviderError::Cancelled)
                },
            )
            .await;

        let terminal = match outcome {
            GenerationOutcome::Completed(node) => GenerationEventDto::Completed {
                generation_id: generation_id.clone(),
                node: node.into(),
            },
            GenerationOutcome::Failed(error) => GenerationEventDto::Failed {
                generation_id: generation_id.clone(),
                error: CommandError::from(error),
            },
            GenerationOutcome::Cancelled => GenerationEventDto::Cancelled {
                generation_id: generation_id.clone(),
            },
        };
        let _terminal_send = on_event.send(terminal);
    });
    match started_receiver.await {
        Ok(true) => Ok(result),
        Ok(false) | Err(_) => Err(CommandError::cancelled()),
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

#[tauri::command]
pub fn commit_generation(
    request: CommitGenerationRequest,
    runtime: State<'_, GenerationRuntime>,
) -> Result<CommitGenerationResult, CommandError> {
    validate_uuid_v4("generation_id", &request.generation_id)?;
    validate_uuid_v4("commit_token", &request.commit_token)?;
    runtime
        .commit(&request.generation_id, &request.commit_token)
        .map(|accepted| CommitGenerationResult { accepted })
        .map_err(CommandError::from)
}

fn validate_id(field: &'static str, value: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() {
        Err(CommandError::invalid_input(field, "blank"))
    } else {
        Ok(())
    }
}

fn validate_uuid_v4(field: &'static str, value: &str) -> Result<(), CommandError> {
    if !is_canonical_uuid_v4(value) {
        Err(CommandError::invalid_input(field, "invalid_uuid_v4"))
    } else {
        Ok(())
    }
}

fn is_canonical_uuid_v4(value: &str) -> bool {
    Uuid::parse_str(value)
        .ok()
        .filter(|parsed| parsed.get_version() == Some(uuid::Version::Random))
        .filter(|parsed| parsed.get_variant() == uuid::Variant::RFC4122)
        .is_some_and(|parsed| parsed.to_string() == value)
}

fn deserialize_uuid_v4<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if is_canonical_uuid_v4(&value) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom("expected canonical UUID v4"))
    }
}

#[cfg(test)]
mod tests {
    use super::validate_uuid_v4;

    #[test]
    fn generation_acknowledgement_ids_require_canonical_uuid_v4() {
        assert!(validate_uuid_v4("generation_id", "11111111-1111-4111-8111-111111111111").is_ok());
        for invalid in [
            "",
            "generation",
            "11111111-1111-3111-8111-111111111111",
            "11111111-1111-4111-7111-111111111111",
            "11111111-1111-4111-8111-11111111111A",
        ] {
            assert!(validate_uuid_v4("commit_token", invalid).is_err());
        }
    }
}
