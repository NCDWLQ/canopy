use std::sync::Arc;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::{
    conversations::commands::NodeDto,
    error::CommandError,
    infra::{
        database::managed_sqlite_pool,
        identity::{IdentityTimeSource, SystemIdentityTimeSource},
    },
};

use super::model_list::{list_models, ModelSummary};
use super::{
    generation::{prepare_generation, GenerationOutcome, GenerationStage},
    ApiKeyAction, GenerationRuntime, LanguagePreference, NativeCredentialStore, Protocol,
    ProviderError, ProviderInput, ProviderService, RedactedProvider, ThemePreference,
    TitleModelBinding,
};

pub const PROVIDER_COMMAND_NAMES: &[&str] = &[
    "list_providers",
    "save_provider",
    "delete_provider",
    "set_active_provider",
    "set_auto_generate_title",
    "set_title_model_binding",
    "set_language",
    "set_theme",
    "reveal_provider_api_key",
    "list_provider_models",
    "generate_from_active_path",
    "cancel_generation",
];

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModelListSourceRequest {
    Saved {
        provider_id: String,
    },
    Draft {
        protocol: String,
        base_endpoint: String,
        api_key: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ListProviderModelsRequest {
    pub source: ModelListSourceRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ModelSummaryDto {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ListProviderModelsResult {
    pub models: Vec<ModelSummaryDto>,
}

impl From<ModelSummary> for ModelSummaryDto {
    fn from(model: ModelSummary) -> Self {
        Self {
            id: model.id,
            display_name: model.display_name,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ApiKeyActionDto {
    Keep,
    Replace { value: String },
    Remove,
}

impl From<ApiKeyActionDto> for ApiKeyAction {
    fn from(action: ApiKeyActionDto) -> Self {
        match action {
            ApiKeyActionDto::Keep => Self::Keep,
            ApiKeyActionDto::Replace { value } => Self::Replace(SecretString::from(value)),
            ApiKeyActionDto::Remove => Self::Remove,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ListProvidersRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SaveProviderRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub protocol: String,
    pub base_endpoint: String,
    pub model: String,
    pub models: Vec<String>,
    pub api_key: ApiKeyActionDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteProviderRequest {
    pub provider_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetActiveProviderRequest {
    pub provider_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct RevealProviderApiKeyRequest {
    pub provider_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct RevealProviderApiKeyResult {
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ProviderDto {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub base_endpoint: String,
    pub model: String,
    pub models: Vec<String>,
    pub has_api_key: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ListProvidersResult {
    pub providers: Vec<ProviderDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_provider_id: Option<String>,
    pub auto_generate_title: bool,
    pub title_model_binding: Option<TitleModelBindingDto>,
    pub language: String,
    pub theme: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct TitleModelBindingDto {
    pub provider_id: String,
    pub model: String,
}

impl From<TitleModelBinding> for TitleModelBindingDto {
    fn from(binding: TitleModelBinding) -> Self {
        Self {
            provider_id: binding.provider_id,
            model: binding.model,
        }
    }
}

impl From<TitleModelBindingDto> for TitleModelBinding {
    fn from(binding: TitleModelBindingDto) -> Self {
        Self {
            provider_id: binding.provider_id,
            model: binding.model,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetAutoGenerateTitleRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetAutoGenerateTitleResult {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetTitleModelBindingRequest {
    pub binding: Option<TitleModelBindingDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetTitleModelBindingResult {
    pub binding: Option<TitleModelBindingDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetLanguageRequest {
    pub language: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetLanguageResult {
    pub language: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetThemeRequest {
    pub theme: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetThemeResult {
    pub theme: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct DeleteProviderResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetActiveProviderResult {
    pub active_provider_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CancelGenerationResult {
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationFailureStage {
    Generation,
    Persistence,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
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
    ThinkingDelta {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        content: String,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum GenerationTerminalDto {
    Completed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        node: NodeDto,
    },
    Cancelled {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
    },
    Failed {
        #[serde(deserialize_with = "deserialize_uuid_v4")]
        generation_id: String,
        stage: GenerationFailureStage,
        error: CommandError,
    },
}

impl From<RedactedProvider> for ProviderDto {
    fn from(provider: RedactedProvider) -> Self {
        Self {
            id: provider.id,
            name: provider.name,
            protocol: provider.protocol.as_str().to_owned(),
            base_endpoint: provider.base_endpoint,
            model: provider.model,
            models: provider.models,
            has_api_key: provider.has_api_key,
            created_at: provider.created_at,
            updated_at: provider.updated_at,
        }
    }
}

fn production_service(pool: sqlx::SqlitePool) -> ProviderService {
    ProviderService::new(pool, Arc::new(NativeCredentialStore))
}

#[tauri::command]
pub async fn list_providers(
    _request: ListProvidersRequest,
    instances: State<'_, DbInstances>,
) -> Result<ListProvidersResult, CommandError> {
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let service = production_service(pool);
    let (providers, active_provider_id) =
        service.list_providers().await.map_err(CommandError::from)?;
    let auto_generate_title = service
        .get_auto_generate_title()
        .await
        .map_err(CommandError::from)?;
    let title_model_binding = service
        .get_title_model_binding()
        .await
        .map_err(CommandError::from)?;
    let language = service.get_language().await.map_err(CommandError::from)?;
    let theme = service.get_theme().await.map_err(CommandError::from)?;
    Ok(ListProvidersResult {
        providers: providers.into_iter().map(ProviderDto::from).collect(),
        active_provider_id,
        auto_generate_title,
        title_model_binding: title_model_binding.map(Into::into),
        language: language.as_setting_text().to_owned(),
        theme: theme.as_setting_text().to_owned(),
    })
}

#[tauri::command]
pub async fn set_auto_generate_title(
    request: SetAutoGenerateTitleRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetAutoGenerateTitleResult, CommandError> {
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_auto_generate_title(request.enabled)
        .await
        .map(|enabled| SetAutoGenerateTitleResult { enabled })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn set_title_model_binding(
    request: SetTitleModelBindingRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetTitleModelBindingResult, CommandError> {
    if let Some(binding) = request.binding.as_ref() {
        validate_id("provider_id", &binding.provider_id)?;
    }
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_title_model_binding(request.binding.map(Into::into))
        .await
        .map(|binding| SetTitleModelBindingResult {
            binding: binding.map(Into::into),
        })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn set_language(
    request: SetLanguageRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetLanguageResult, CommandError> {
    let language = LanguagePreference::parse(&request.language)
        .ok_or_else(|| CommandError::invalid_input("language", "invalid_language"))?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_language(language)
        .await
        .map(|language| SetLanguageResult {
            language: language.as_setting_text().to_owned(),
        })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn set_theme(
    request: SetThemeRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetThemeResult, CommandError> {
    let theme = ThemePreference::parse(&request.theme)
        .ok_or_else(|| CommandError::invalid_input("theme", "invalid_theme"))?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_theme(theme)
        .await
        .map(|theme| SetThemeResult {
            theme: theme.as_setting_text().to_owned(),
        })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn save_provider(
    request: SaveProviderRequest,
    instances: State<'_, DbInstances>,
) -> Result<ProviderDto, CommandError> {
    let source = SystemIdentityTimeSource;
    let provider_id = request.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_id("id", &provider_id)?;
    let protocol = Protocol::from_db_text(&request.protocol).map_err(CommandError::from)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let service = production_service(pool);
    service
        .save(
            &provider_id,
            ProviderInput {
                name: request.name,
                protocol,
                base_endpoint: request.base_endpoint,
                model: request.model,
                models: request.models,
                api_key: request.api_key.into(),
            },
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            source.now_millis(),
        )
        .await
        .map(ProviderDto::from)
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn delete_provider(
    request: DeleteProviderRequest,
    instances: State<'_, DbInstances>,
) -> Result<DeleteProviderResult, CommandError> {
    validate_id("provider_id", &request.provider_id)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .delete(&request.provider_id, Uuid::new_v4().to_string())
        .await
        .map(|deleted| DeleteProviderResult { deleted })
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn set_active_provider(
    request: SetActiveProviderRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetActiveProviderResult, CommandError> {
    validate_id("provider_id", &request.provider_id)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_active(&request.provider_id)
        .await
        .map(|active_provider_id| SetActiveProviderResult { active_provider_id })
        .map_err(CommandError::from)
}

/// Returns one stored provider's API key in plaintext for the settings
/// editor. Profile results stay redacted; reveal is the only command that
/// may echo a secret, and only on explicit request.
#[tauri::command]
pub async fn reveal_provider_api_key(
    request: RevealProviderApiKeyRequest,
    instances: State<'_, DbInstances>,
) -> Result<RevealProviderApiKeyResult, CommandError> {
    validate_id("provider_id", &request.provider_id)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let (_, secret) = production_service(pool)
        .load_by_id_with_secret(&request.provider_id)
        .await
        .map_err(CommandError::from)?;
    use secrecy::ExposeSecret;
    Ok(RevealProviderApiKeyResult {
        api_key: secret.map(|secret| secret.expose_secret().to_owned()),
    })
}

#[tauri::command]
pub async fn list_provider_models(
    request: ListProviderModelsRequest,
    instances: State<'_, DbInstances>,
) -> Result<ListProviderModelsResult, CommandError> {
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let service = production_service(pool);
    let models = match request.source {
        ModelListSourceRequest::Saved { provider_id } => {
            validate_id("provider_id", &provider_id)?;
            let (provider, secret) = service
                .load_by_id_with_secret(&provider_id)
                .await
                .map_err(CommandError::from)?;
            let endpoint =
                super::ValidatedEndpoint::parse(&provider.base_endpoint, provider.protocol)
                    .map_err(CommandError::from)?;
            list_models(provider.protocol, &endpoint, secret.as_ref()).await
        }
        ModelListSourceRequest::Draft {
            protocol,
            base_endpoint,
            api_key,
        } => {
            let protocol = Protocol::from_db_text(&protocol).map_err(CommandError::from)?;
            let endpoint = super::ValidatedEndpoint::parse(&base_endpoint, protocol)
                .map_err(CommandError::from)?;
            let secret = api_key
                .filter(|key| !key.is_empty())
                .map(SecretString::from);
            list_models(protocol, &endpoint, secret.as_ref()).await
        }
    }
    .map_err(CommandError::from)?;
    Ok(ListProviderModelsResult {
        models: models.into_iter().map(ModelSummaryDto::from).collect(),
    })
}

/// Sends `started` before `run` begins. Content events are emitted by `run`
/// through the same Channel; the terminal is the return value and is never
/// sent as a Channel event. `Err` means the started event was not delivered.
async fn run_after_started<S, R, Fut>(
    generation_id: String,
    conversation_id: String,
    active_node_id: String,
    model: String,
    send: S,
    run: R,
) -> Result<GenerationTerminalDto, GenerationTerminalDto>
where
    S: Fn(GenerationEventDto) -> Result<(), ProviderError>,
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

fn map_generation_outcome(
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
    let profile_service = production_service(pool.clone());
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
        move |event| {
            event_channel
                .send(event)
                .map_err(|_| ProviderError::Cancelled)
        },
        || async move {
            prepared
                .run(
                    move |content| {
                        delta_channel
                            .send(GenerationEventDto::Delta {
                                generation_id: delta_generation_id.clone(),
                                content: content.to_owned(),
                            })
                            .map_err(|_| ProviderError::Cancelled)
                    },
                    move |content| {
                        thinking_channel
                            .send(GenerationEventDto::ThinkingDelta {
                                generation_id: thinking_generation_id.clone(),
                                content: content.to_owned(),
                            })
                            .map_err(|_| ProviderError::Cancelled)
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
                super::titles::spawn_auto_title(
                    pool,
                    profile_service,
                    app,
                    node.conversation_id.clone(),
                );
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
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    use serde_json::json;

    use crate::{
        conversations::{PersistenceError, Role},
        providers::{
            generation::{GenerationOutcome, GenerationStage},
            ProviderError,
        },
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
                |_| Err(ProviderError::Cancelled),
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
                error: ProviderError::Unavailable,
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
