use sqlx::{Row, SqliteConnection};

use super::{LanguagePreference, SettingsError, ThemePreference, TitleModelBinding};

const ACTIVE_PROVIDER_SETTING_KEY: &str = "active_provider_id";
const AUTO_GENERATE_TITLE_SETTING_KEY: &str = "auto_generate_title";
const TITLE_MODEL_BINDING_SETTING_KEY: &str = "title_model_binding";
const LANGUAGE_SETTING_KEY: &str = "language";
const THEME_SETTING_KEY: &str = "theme";
const DEFAULT_SYSTEM_PROMPT_SETTING_KEY: &str = "default_system_prompt";

#[derive(Debug, Default)]
pub(crate) struct SettingsRepository;

impl SettingsRepository {
    pub(crate) async fn get_active_provider_id(
        connection: &mut SqliteConnection,
    ) -> Result<Option<String>, SettingsError> {
        Self::get_setting(connection, ACTIVE_PROVIDER_SETTING_KEY).await
    }

    pub(crate) async fn set_active_provider_id(
        connection: &mut SqliteConnection,
        provider_id: &str,
    ) -> Result<(), SettingsError> {
        Self::set_setting(connection, ACTIVE_PROVIDER_SETTING_KEY, provider_id).await
    }

    pub(crate) async fn clear_active_provider_id_if(
        connection: &mut SqliteConnection,
        provider_id: &str,
    ) -> Result<(), SettingsError> {
        Self::delete_setting_value(connection, ACTIVE_PROVIDER_SETTING_KEY, provider_id).await
    }

    pub(crate) async fn get_auto_generate_title(
        connection: &mut SqliteConnection,
    ) -> Result<bool, SettingsError> {
        match Self::get_setting(connection, AUTO_GENERATE_TITLE_SETTING_KEY)
            .await?
            .as_deref()
        {
            None | Some("true") => Ok(true),
            Some("false") => Ok(false),
            Some(_) => Err(SettingsError::CorruptValue),
        }
    }

    pub(crate) async fn set_auto_generate_title(
        connection: &mut SqliteConnection,
        enabled: bool,
    ) -> Result<(), SettingsError> {
        Self::set_setting(
            connection,
            AUTO_GENERATE_TITLE_SETTING_KEY,
            if enabled { "true" } else { "false" },
        )
        .await
    }

    pub(crate) async fn get_title_model_binding(
        connection: &mut SqliteConnection,
    ) -> Result<Option<TitleModelBinding>, SettingsError> {
        Self::get_setting(connection, TITLE_MODEL_BINDING_SETTING_KEY)
            .await?
            .map(|value| serde_json::from_str(&value).map_err(|_| SettingsError::CorruptValue))
            .transpose()
    }

    pub(crate) async fn set_title_model_binding(
        connection: &mut SqliteConnection,
        binding: &TitleModelBinding,
    ) -> Result<(), SettingsError> {
        let value = serde_json::to_string(binding).map_err(|_| SettingsError::CorruptValue)?;
        Self::set_setting(connection, TITLE_MODEL_BINDING_SETTING_KEY, &value).await
    }

    pub(crate) async fn delete_title_model_binding(
        connection: &mut SqliteConnection,
    ) -> Result<(), SettingsError> {
        Self::delete_setting(connection, TITLE_MODEL_BINDING_SETTING_KEY).await
    }

    pub(crate) async fn clear_title_binding_for_provider(
        connection: &mut SqliteConnection,
        provider_id: &str,
    ) -> Result<(), SettingsError> {
        if Self::get_title_model_binding(connection)
            .await?
            .is_some_and(|binding| binding.provider_id == provider_id)
        {
            Self::delete_title_model_binding(connection).await?;
        }
        Ok(())
    }

    pub(crate) async fn clear_invalid_title_binding_for_provider(
        connection: &mut SqliteConnection,
        provider_id: &str,
        models: &[String],
    ) -> Result<(), SettingsError> {
        if Self::get_title_model_binding(connection)
            .await?
            .is_some_and(|binding| {
                binding.provider_id == provider_id
                    && !models.iter().any(|model| model == &binding.model)
            })
        {
            Self::delete_title_model_binding(connection).await?;
        }
        Ok(())
    }

    pub(crate) async fn get_language(
        connection: &mut SqliteConnection,
    ) -> Result<LanguagePreference, SettingsError> {
        match Self::get_setting(connection, LANGUAGE_SETTING_KEY)
            .await?
            .as_deref()
        {
            None => Ok(LanguagePreference::System),
            Some(value) => LanguagePreference::from_setting_text(value),
        }
    }

    pub(crate) async fn set_language(
        connection: &mut SqliteConnection,
        language: LanguagePreference,
    ) -> Result<(), SettingsError> {
        Self::set_setting(connection, LANGUAGE_SETTING_KEY, language.as_setting_text()).await
    }

    pub(crate) async fn get_theme(
        connection: &mut SqliteConnection,
    ) -> Result<ThemePreference, SettingsError> {
        match Self::get_setting(connection, THEME_SETTING_KEY)
            .await?
            .as_deref()
        {
            None => Ok(ThemePreference::System),
            Some(value) => ThemePreference::from_setting_text(value),
        }
    }

    pub(crate) async fn set_theme(
        connection: &mut SqliteConnection,
        theme: ThemePreference,
    ) -> Result<(), SettingsError> {
        Self::set_setting(connection, THEME_SETTING_KEY, theme.as_setting_text()).await
    }

    pub(crate) async fn get_default_system_prompt(
        connection: &mut SqliteConnection,
    ) -> Result<Option<String>, SettingsError> {
        Self::get_setting(connection, DEFAULT_SYSTEM_PROMPT_SETTING_KEY).await
    }

    pub(crate) async fn set_default_system_prompt(
        connection: &mut SqliteConnection,
        prompt: Option<&str>,
    ) -> Result<(), SettingsError> {
        match prompt {
            Some(value) => {
                Self::set_setting(connection, DEFAULT_SYSTEM_PROMPT_SETTING_KEY, value).await
            }
            None => Self::delete_setting(connection, DEFAULT_SYSTEM_PROMPT_SETTING_KEY).await,
        }
    }

    async fn get_setting(
        connection: &mut SqliteConnection,
        key: &str,
    ) -> Result<Option<String>, SettingsError> {
        let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(connection)
            .await?;
        row.map(|row| row.try_get("value"))
            .transpose()
            .map_err(Into::into)
    }

    async fn set_setting(
        connection: &mut SqliteConnection,
        key: &str,
        value: &str,
    ) -> Result<(), SettingsError> {
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(connection)
        .await?;
        Ok(())
    }

    async fn delete_setting_value(
        connection: &mut SqliteConnection,
        key: &str,
        value: &str,
    ) -> Result<(), SettingsError> {
        sqlx::query("DELETE FROM app_settings WHERE key = ?1 AND value = ?2")
            .bind(key)
            .bind(value)
            .execute(connection)
            .await?;
        Ok(())
    }

    async fn delete_setting(
        connection: &mut SqliteConnection,
        key: &str,
    ) -> Result<(), SettingsError> {
        sqlx::query("DELETE FROM app_settings WHERE key = ?1")
            .bind(key)
            .execute(connection)
            .await?;
        Ok(())
    }
}
