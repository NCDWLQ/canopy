use sqlx::SqlitePool;

use super::{
    LanguagePreference, SettingsError, SettingsRepository, ThemeColorPreference, ThemePreference,
    TitleModelBinding,
};

#[derive(Clone)]
pub struct SettingsService {
    pool: SqlitePool,
}

impl std::fmt::Debug for SettingsService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SettingsService")
            .finish_non_exhaustive()
    }
}

impl SettingsService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_auto_generate_title(&self) -> Result<bool, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let enabled = SettingsRepository::get_auto_generate_title(&mut transaction).await?;
        transaction.commit().await?;
        Ok(enabled)
    }

    pub async fn set_auto_generate_title(&self, enabled: bool) -> Result<bool, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        SettingsRepository::set_auto_generate_title(&mut transaction, enabled).await?;
        transaction.commit().await?;
        Ok(enabled)
    }

    pub async fn get_title_model_binding(
        &self,
    ) -> Result<Option<TitleModelBinding>, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let binding = SettingsRepository::get_title_model_binding(&mut transaction).await?;
        transaction.commit().await?;
        Ok(binding)
    }

    /// Reads the persisted UI language preference. An absent key means
    /// `System` (follow the OS locale), matching the auto-title default.
    pub async fn get_language(&self) -> Result<LanguagePreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let language = SettingsRepository::get_language(&mut transaction).await?;
        transaction.commit().await?;
        Ok(language)
    }

    pub async fn set_language(
        &self,
        language: LanguagePreference,
    ) -> Result<LanguagePreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        SettingsRepository::set_language(&mut transaction, language).await?;
        transaction.commit().await?;
        Ok(language)
    }

    /// Reads the persisted UI theme preference. An absent key means
    /// `System` (follow the OS/system color scheme), matching the default.
    pub async fn get_theme(&self) -> Result<ThemePreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let theme = SettingsRepository::get_theme(&mut transaction).await?;
        transaction.commit().await?;
        Ok(theme)
    }

    pub async fn set_theme(
        &self,
        theme: ThemePreference,
    ) -> Result<ThemePreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        SettingsRepository::set_theme(&mut transaction, theme).await?;
        transaction.commit().await?;
        Ok(theme)
    }

    /// Reads the persisted shadcn primary palette. An absent key means
    /// `Neutral`, preserving the current default appearance.
    pub async fn get_theme_color(&self) -> Result<ThemeColorPreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let theme_color = SettingsRepository::get_theme_color(&mut transaction).await?;
        transaction.commit().await?;
        Ok(theme_color)
    }

    pub async fn set_theme_color(
        &self,
        theme_color: ThemeColorPreference,
    ) -> Result<ThemeColorPreference, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        SettingsRepository::set_theme_color(&mut transaction, theme_color).await?;
        transaction.commit().await?;
        Ok(theme_color)
    }

    pub async fn get_default_system_prompt(&self) -> Result<Option<String>, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        let prompt = SettingsRepository::get_default_system_prompt(&mut transaction).await?;
        transaction.commit().await?;
        Ok(prompt)
    }

    pub async fn set_default_system_prompt(
        &self,
        prompt: Option<String>,
    ) -> Result<Option<String>, SettingsError> {
        let mut transaction = self.pool.begin().await?;
        SettingsRepository::set_default_system_prompt(&mut transaction, prompt.as_deref()).await?;
        transaction.commit().await?;
        Ok(prompt)
    }
}
