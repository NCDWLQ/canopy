use serde::{Deserialize, Serialize};

use super::SettingsError;

/// Persisted UI language preference stored under the `language` key in
/// `app_settings`. `System` follows the OS locale and is the default while
/// the key is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguagePreference {
    System,
    ZhCn,
    En,
}

impl LanguagePreference {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "zh-CN" => Some(Self::ZhCn),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn from_setting_text(value: &str) -> Result<Self, SettingsError> {
        Self::parse(value).ok_or(SettingsError::CorruptValue)
    }

    pub fn as_setting_text(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::ZhCn => "zh-CN",
            Self::En => "en",
        }
    }
}

/// Persisted UI theme preference stored under the `theme` key in
/// `app_settings`. `System` follows the OS/system color scheme and is the
/// default while the key is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemePreference {
    System,
    Light,
    Dark,
}

impl ThemePreference {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    pub fn from_setting_text(value: &str) -> Result<Self, SettingsError> {
        Self::parse(value).ok_or(SettingsError::CorruptValue)
    }

    pub fn as_setting_text(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

/// Persisted shadcn primary palette stored under the `theme_color` key in
/// `app_settings`. `Neutral` is the default while the key is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeColorPreference {
    Neutral,
    Blue,
    Green,
    Orange,
    Red,
    Rose,
    Violet,
}

impl ThemeColorPreference {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "neutral" => Some(Self::Neutral),
            "blue" => Some(Self::Blue),
            "green" => Some(Self::Green),
            "orange" => Some(Self::Orange),
            "red" => Some(Self::Red),
            "rose" => Some(Self::Rose),
            "violet" => Some(Self::Violet),
            _ => None,
        }
    }

    pub fn from_setting_text(value: &str) -> Result<Self, SettingsError> {
        Self::parse(value).ok_or(SettingsError::CorruptValue)
    }

    pub fn as_setting_text(self) -> &'static str {
        match self {
            Self::Neutral => "neutral",
            Self::Blue => "blue",
            Self::Green => "green",
            Self::Orange => "orange",
            Self::Red => "red",
            Self::Rose => "rose",
            Self::Violet => "violet",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct TitleModelBinding {
    pub provider_id: String,
    pub model: String,
}
