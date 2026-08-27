use secrecy::SecretString;

use super::ProviderError;
use crate::llm::Protocol;

/// Row id of the provider created by migration 0005 from the legacy singleton
/// profile. Newly created providers use caller-generated opaque ids.
pub const MIGRATED_PROVIDER_ID: &str = "default";
/// Display name the migration assigns to the migrated provider row.
pub const MIGRATED_PROVIDER_NAME: &str = "默认";

#[derive(Clone)]
pub enum ApiKeyAction {
    Keep,
    Replace(SecretString),
    Remove,
}

impl std::fmt::Debug for ApiKeyAction {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Keep => formatter.write_str("Keep"),
            Self::Replace(_) => formatter.write_str("Replace([REDACTED])"),
            Self::Remove => formatter.write_str("Remove"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProviderInput {
    pub name: String,
    pub protocol: Protocol,
    pub base_endpoint: String,
    pub model: String,
    pub models: Vec<String>,
    pub api_key: ApiKeyAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub base_endpoint: String,
    pub model: String,
    pub models: Vec<String>,
    pub(crate) credential_ref: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactedProvider {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub base_endpoint: String,
    pub model: String,
    pub models: Vec<String>,
    pub has_api_key: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn validate_name(name: &str) -> Result<String, ProviderError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ProviderError::invalid_input("name", "blank"));
    }
    if name.chars().count() > 100 {
        return Err(ProviderError::invalid_input("name", "too_long"));
    }
    Ok(name.to_owned())
}

/// Provider-level selectable model list. Rules: 1..=50 entries, each passes
/// `validate_model`, order-preserving dedup, and the provider's default model
/// must be a member (the conversation picker chooses offline from this list).
pub fn validate_models(
    models: &[String],
    default_model: &str,
) -> Result<Vec<String>, ProviderError> {
    if models.is_empty() || models.len() > 50 {
        return Err(ProviderError::invalid_input("models", "size"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut validated = Vec::with_capacity(models.len());
    for model in models {
        let model = validate_model(model)?;
        if seen.insert(model.clone()) {
            validated.push(model);
        }
    }
    if !validated.iter().any(|model| model == default_model) {
        return Err(ProviderError::invalid_input("model", "not_in_models"));
    }
    Ok(validated)
}

pub fn validate_model(model: &str) -> Result<String, ProviderError> {
    let model = model.trim();
    if model.is_empty() {
        return Err(ProviderError::invalid_input("model", "blank"));
    }
    if model.len() > 200 {
        return Err(ProviderError::invalid_input("model", "too_long"));
    }
    Ok(model.to_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn provider_names_must_be_trimmed_non_blank_and_bounded() {
        assert_eq!(validate_name("  Alpha  ").unwrap(), "Alpha");
        assert!(validate_name("   ").is_err());
        assert!(validate_name("").is_err());
        assert!(validate_name(&"x".repeat(101)).is_err());
        assert!(validate_name(&"汉".repeat(100)).is_ok());
        assert!(validate_name(&"汉".repeat(101)).is_err());
    }
}
