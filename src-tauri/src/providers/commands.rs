use std::sync::Arc;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;
use uuid::Uuid;

use crate::{
    error::CommandError,
    infra::{
        database::managed_sqlite_pool,
        identity::{IdentityTimeSource, SystemIdentityTimeSource},
    },
    llm::{
        model_list::{list_models, ModelSummary},
        Protocol, ValidatedEndpoint,
    },
    settings::{SettingsService, TitleModelBinding},
};

use super::{
    ApiKeyAction, NativeCredentialStore, ProviderInput, ProviderService, RedactedProvider,
};

/// Frozen IPC catalog, including settings-owned and generation-owned command
/// names so the shared provider fixture remains byte-compatible. Language,
/// theme, and auto-title handlers live in `settings::commands`; generate and
/// cancel handlers live in `generation::commands`; `list_providers` stays
/// here as the permanent aggregate façade.
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
pub struct DeleteProviderResult {
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetActiveProviderResult {
    pub active_provider_id: String,
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
    let settings = SettingsService::new(pool.clone());
    let service = production_service(pool);
    let (providers, active_provider_id) =
        service.list_providers().await.map_err(CommandError::from)?;
    let auto_generate_title = settings
        .get_auto_generate_title()
        .await
        .map_err(CommandError::from)?;
    let title_model_binding = settings
        .get_title_model_binding()
        .await
        .map_err(CommandError::from)?;
    let language = settings.get_language().await.map_err(CommandError::from)?;
    let theme = settings.get_theme().await.map_err(CommandError::from)?;
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
            let endpoint = ValidatedEndpoint::parse(&provider.base_endpoint, provider.protocol)
                .map_err(CommandError::from)?;
            list_models(provider.protocol, &endpoint, secret.as_ref()).await
        }
        ModelListSourceRequest::Draft {
            protocol,
            base_endpoint,
            api_key,
        } => {
            let protocol = Protocol::from_db_text(&protocol).map_err(CommandError::from)?;
            let endpoint =
                ValidatedEndpoint::parse(&base_endpoint, protocol).map_err(CommandError::from)?;
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

fn validate_id(field: &'static str, value: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() {
        Err(CommandError::invalid_input(field, "blank"))
    } else {
        Ok(())
    }
}
