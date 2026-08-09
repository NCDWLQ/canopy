use secrecy::SecretString;
use std::net::{Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use super::ProviderError;

pub const PROFILE_ID: &str = "default";

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
pub struct ProviderProfileInput {
    pub base_endpoint: String,
    pub model: String,
    pub api_key: ApiKeyAction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderProfile {
    pub base_endpoint: String,
    pub model: String,
    pub(crate) credential_ref: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactedProviderProfile {
    pub base_endpoint: String,
    pub model: String,
    pub has_api_key: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct ValidatedEndpoint {
    base: Url,
    chat_completions: Url,
}

impl ValidatedEndpoint {
    pub fn parse(value: &str) -> Result<Self, ProviderError> {
        let base = Url::parse(value)
            .map_err(|_| ProviderError::invalid_input("base_endpoint", "invalid_url"))?;
        if !base.has_host()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(ProviderError::invalid_input(
                "base_endpoint",
                "invalid_origin",
            ));
        }

        let host = base
            .host()
            .ok_or_else(|| ProviderError::invalid_input("base_endpoint", "missing_host"))?;
        let loopback = match host {
            Host::Domain(domain) => domain == "localhost",
            Host::Ipv4(address) => address == Ipv4Addr::LOCALHOST,
            Host::Ipv6(address) => address == Ipv6Addr::LOCALHOST,
        };
        match base.scheme() {
            "https" => {}
            "http" if loopback && has_exact_loopback_authority(value) => {}
            _ => {
                return Err(ProviderError::invalid_input(
                    "base_endpoint",
                    "https_required",
                ))
            }
        }

        let mut chat_completions = base.clone();
        chat_completions
            .path_segments_mut()
            .map_err(|_| ProviderError::invalid_input("base_endpoint", "invalid_path"))?
            .pop_if_empty()
            .push("chat")
            .push("completions");
        Ok(Self {
            base,
            chat_completions,
        })
    }

    pub fn normalized_base(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_owned()
    }

    pub fn chat_completions_url(&self) -> &Url {
        &self.chat_completions
    }
}

fn has_exact_loopback_authority(value: &str) -> bool {
    let Some(rest) = value
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
        .then(|| &value[7..])
    else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if let Some(ipv6) = authority.strip_prefix('[') {
        let Some((host, suffix)) = ipv6.split_once(']') else {
            return false;
        };
        return host == "::1" && valid_optional_port(suffix);
    }
    let (host, suffix) = match authority.rsplit_once(':') {
        Some((host, _)) if !host.contains(':') => (host, &authority[host.len()..]),
        _ => (authority, ""),
    };
    (host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1") && valid_optional_port(suffix)
}

fn valid_optional_port(suffix: &str) -> bool {
    suffix.is_empty()
        || suffix
            .strip_prefix(':')
            .is_some_and(|port| !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()))
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
    use super::ValidatedEndpoint;

    #[test]
    fn endpoint_policy_accepts_https_and_exact_loopback_http() {
        for accepted in [
            "https://provider.example/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1/v1/",
            "http://[::1]:8080/v1",
        ] {
            let endpoint = ValidatedEndpoint::parse(accepted).expect("endpoint is accepted");
            assert!(endpoint
                .chat_completions_url()
                .path()
                .ends_with("/chat/completions"));
        }
    }

    #[test]
    fn endpoint_policy_rejects_untrusted_forms() {
        for rejected in [
            "http://provider.example/v1",
            "http://127.0.0.2/v1",
            "http://127.1/v1",
            "http://2130706433/v1",
            "http://localhost.example/v1",
            "https://user:pass@provider.example/v1",
            "https://provider.example/v1?token=value",
            "https://provider.example/v1#fragment",
            "/v1",
        ] {
            assert!(ValidatedEndpoint::parse(rejected).is_err(), "{rejected}");
        }
    }
}
