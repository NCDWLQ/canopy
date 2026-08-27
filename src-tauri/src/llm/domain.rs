use std::net::{Ipv4Addr, Ipv6Addr};

use secrecy::SecretString;
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

use super::LlmError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    OpenAiCompatible,
    Anthropic,
}

impl Protocol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openai_compatible",
            Self::Anthropic => "anthropic",
        }
    }

    pub fn from_db_text(value: &str) -> Result<Self, LlmError> {
        match value {
            "openai_compatible" => Ok(Self::OpenAiCompatible),
            "anthropic" => Ok(Self::Anthropic),
            _ => Err(LlmError::Protocol),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
}

impl ReasoningEffort {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

impl MessageRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatPrompt {
    pub model: String,
    pub messages: Vec<PromptMessage>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

/// Transport-neutral title prompt: instructions in `system`, untrusted
/// excerpts in `user`. Protocol adapters must not import conversation types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitlePrompt {
    pub system: String,
    pub user: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedContent {
    pub content: String,
    pub thinking: Option<String>,
}

/// Immutable provider inputs captured at generation prepare time. Protocol
/// implementations only borrow this snapshot, so edits to provider settings
/// or conversation binding cannot alter an in-flight request.
pub struct StreamingRequest<'a> {
    pub endpoint: &'a ValidatedEndpoint,
    pub prompt: &'a ChatPrompt,
    pub secret: Option<&'a SecretString>,
    pub cancellation: &'a CancellationToken,
}

#[derive(Debug, Clone)]
pub struct ValidatedEndpoint {
    base: Url,
    protocol: Protocol,
    chat_completions: Url,
    messages: Url,
    models: Url,
}

impl ValidatedEndpoint {
    pub fn parse(value: &str, protocol: Protocol) -> Result<Self, LlmError> {
        let base = Url::parse(value)
            .map_err(|_| LlmError::invalid_input("base_endpoint", "invalid_url"))?;
        if !base.has_host()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(LlmError::invalid_input("base_endpoint", "invalid_origin"));
        }

        let host = base
            .host()
            .ok_or_else(|| LlmError::invalid_input("base_endpoint", "missing_host"))?;
        let loopback = match host {
            Host::Domain(domain) => domain == "localhost",
            Host::Ipv4(address) => address == Ipv4Addr::LOCALHOST,
            Host::Ipv6(address) => address == Ipv6Addr::LOCALHOST,
        };
        match base.scheme() {
            "https" => {}
            "http" if loopback && has_exact_loopback_authority(value) => {}
            _ => return Err(LlmError::invalid_input("base_endpoint", "https_required")),
        }

        let chat_completions = append_segments(&base, &["chat", "completions"])?;
        let (messages, models) = if protocol == Protocol::Anthropic && !path_ends_with_v1(&base) {
            (
                append_segments(&base, &["v1", "messages"])?,
                append_segments(&base, &["v1", "models"])?,
            )
        } else {
            (
                append_segments(&base, &["messages"])?,
                append_segments(&base, &["models"])?,
            )
        };
        Ok(Self {
            base,
            protocol,
            chat_completions,
            messages,
            models,
        })
    }

    pub fn protocol(&self) -> Protocol {
        self.protocol
    }

    pub fn normalized_base(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_owned()
    }

    pub fn chat_completions_url(&self) -> &Url {
        &self.chat_completions
    }

    pub fn messages_url(&self) -> &Url {
        &self.messages
    }

    pub fn models_url(&self) -> &Url {
        &self.models
    }

    /// `{origin}/v1/models` — the OpenAI-compatible model-list surface on the
    /// same host. Anthropic-surface gateways frequently omit the models
    /// endpoint (DeepSeek does) while serving the OpenAI list there, so the
    /// model-list fetch falls back to this URL once on 404.
    pub fn host_root_models_url(&self) -> Url {
        let mut url = self.base.clone();
        url.set_path("/v1/models");
        url.set_query(None);
        url.set_fragment(None);
        url
    }
}

fn append_segments(base: &Url, segments: &[&str]) -> Result<Url, LlmError> {
    let mut url = base.clone();
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| LlmError::invalid_input("base_endpoint", "invalid_path"))?;
        path.pop_if_empty();
        for segment in segments {
            path.push(segment);
        }
    }
    Ok(url)
}

fn path_ends_with_v1(base: &Url) -> bool {
    let path = base.path();
    path.ends_with("/v1") || path.ends_with("/v1/")
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

#[cfg(test)]
mod tests {
    use super::{Protocol, ValidatedEndpoint};

    #[test]
    fn endpoint_policy_accepts_https_and_exact_loopback_http() {
        for accepted in [
            "https://provider.example/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1/v1/",
            "http://[::1]:8080/v1",
        ] {
            let endpoint = ValidatedEndpoint::parse(accepted, Protocol::OpenAiCompatible).unwrap();
            assert!(endpoint
                .chat_completions_url()
                .path()
                .ends_with("/chat/completions"));
            assert!(endpoint.models_url().path().ends_with("/models"));
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
            assert!(
                ValidatedEndpoint::parse(rejected, Protocol::OpenAiCompatible).is_err(),
                "{rejected}"
            );
            assert!(
                ValidatedEndpoint::parse(rejected, Protocol::Anthropic).is_err(),
                "{rejected}"
            );
        }
    }

    #[test]
    fn anthropic_endpoints_append_v1_only_when_missing() {
        for (input, expected) in [
            (
                "https://api.anthropic.com",
                "https://api.anthropic.com/v1/messages",
            ),
            (
                "https://api.anthropic.com/",
                "https://api.anthropic.com/v1/messages",
            ),
            (
                "https://api.anthropic.com/v1",
                "https://api.anthropic.com/v1/messages",
            ),
            (
                "https://api.anthropic.com/v1/",
                "https://api.anthropic.com/v1/messages",
            ),
            ("http://localhost:8080", "http://localhost:8080/v1/messages"),
        ] {
            let endpoint = ValidatedEndpoint::parse(input, Protocol::Anthropic)
                .unwrap_or_else(|error| panic!("{input} rejected: {error:?}"));
            assert_eq!(
                endpoint.messages_url().as_str(),
                expected,
                "messages derivation for {input}"
            );
            assert_eq!(
                endpoint.models_url().as_str(),
                expected.replace("/messages", "/models"),
                "models derivation for {input}"
            );
        }
    }

    #[test]
    fn openai_endpoints_do_not_append_v1() {
        let endpoint =
            ValidatedEndpoint::parse("https://provider.example/v1", Protocol::OpenAiCompatible)
                .unwrap();
        assert_eq!(
            endpoint.chat_completions_url().as_str(),
            "https://provider.example/v1/chat/completions"
        );
        assert_eq!(
            endpoint.models_url().as_str(),
            "https://provider.example/v1/models"
        );
    }
}
