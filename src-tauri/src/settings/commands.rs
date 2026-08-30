use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::{error::CommandError, infra::database::managed_sqlite_pool};

use super::{LanguagePreference, SettingsService, ThemePreference};

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
pub struct SetDefaultSystemPromptRequest {
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SetDefaultSystemPromptResult {
    pub prompt: Option<String>,
}

const MAX_SYSTEM_PROMPT_BYTES: usize = 1024 * 1024;

fn normalize_system_prompt(value: Option<&str>) -> Result<Option<String>, CommandError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > MAX_SYSTEM_PROMPT_BYTES {
        return Err(CommandError::invalid_input("prompt", "too_large"));
    }
    Ok(Some(trimmed.to_owned()))
}

fn production_service(pool: sqlx::SqlitePool) -> SettingsService {
    SettingsService::new(pool)
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
pub async fn set_default_system_prompt(
    request: SetDefaultSystemPromptRequest,
    instances: State<'_, DbInstances>,
) -> Result<SetDefaultSystemPromptResult, CommandError> {
    let prompt = normalize_system_prompt(request.prompt.as_deref())?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .set_default_system_prompt(prompt)
        .await
        .map(|prompt| SetDefaultSystemPromptResult { prompt })
        .map_err(CommandError::from)
}
