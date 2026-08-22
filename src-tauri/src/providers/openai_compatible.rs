use std::{sync::OnceLock, time::Duration};

use eventsource_stream::Eventsource;
use futures_util::{
    future::{select, Either},
    pin_mut, FutureExt, StreamExt,
};
use reqwest::{header::RETRY_AFTER, redirect::Policy, Client, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::conversations::{Role, ValidatedPath};

use crate::conversations::ReasoningEffort;

use super::{domain::validate_model, title_prompt::TitlePrompt, ProviderError, ValidatedEndpoint};

pub(crate) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

pub fn build_request(
    path: &ValidatedPath,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
) -> Result<ChatCompletionRequest, ProviderError> {
    let model = validate_model(model)?;
    let nodes = path.as_slice();
    if nodes.last().map(|node| node.role) != Some(Role::User) {
        return Err(ProviderError::invalid_input(
            "active_node_id",
            "terminal_role_must_be_user",
        ));
    }
    let messages = nodes
        .iter()
        .map(|node| {
            let role = match node.role {
                Role::System => "system",
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::Tool => {
                    return Err(ProviderError::invalid_input(
                        "active_node_id",
                        "tool_role_unsupported",
                    ))
                }
            };
            if node.content.trim().is_empty() {
                return Err(ProviderError::invalid_input(
                    "active_node_id",
                    "blank_content",
                ));
            }
            Ok(ChatMessage {
                role,
                content: node.content.clone(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ChatCompletionRequest {
        model,
        messages,
        stream: true,
        reasoning_effort: reasoning_effort.map(ReasoningEffort::as_str),
        max_tokens: None,
    })
}

fn build_title_request(
    model: &str,
    prompt: &TitlePrompt,
) -> Result<ChatCompletionRequest, ProviderError> {
    Ok(ChatCompletionRequest {
        model: validate_model(model)?,
        messages: vec![
            ChatMessage {
                role: "system",
                content: prompt.system.clone(),
            },
            ChatMessage {
                role: "user",
                content: prompt.user.clone(),
            },
        ],
        stream: true,
        // The 256 budget leaves room for a reasoning model's low-effort
        // thinking tokens (which count toward max_tokens) plus the title
        // body; 60 could starve the body to empty on those models.
        reasoning_effort: Some(ReasoningEffort::Low.as_str()),
        max_tokens: Some(256),
    })
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
    pub path: &'a ValidatedPath,
    pub model: &'a str,
    pub secret: Option<&'a SecretString>,
    pub cancellation: &'a CancellationToken,
    pub reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleClient {
    client: Client,
}

impl OpenAiCompatibleClient {
    pub fn new() -> Result<Self, ProviderError> {
        if let Some(client) = HTTP_CLIENT.get() {
            return Ok(Self {
                client: client.clone(),
            });
        }
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .user_agent("Canopy/0.1")
            .build()
            .map_err(|_| ProviderError::Network)?;
        let _ = HTTP_CLIENT.set(client.clone());
        Ok(Self {
            client: HTTP_CLIENT.get().cloned().unwrap_or(client),
        })
    }

    pub(crate) fn http_client(&self) -> &Client {
        &self.client
    }

    pub async fn stream<F>(
        &self,
        endpoint: &ValidatedEndpoint,
        path: &ValidatedPath,
        model: &str,
        secret: Option<&SecretString>,
        cancellation: &CancellationToken,
        on_delta: F,
    ) -> Result<String, ProviderError>
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
    {
        let request = StreamingRequest {
            endpoint,
            path,
            model,
            secret,
            cancellation,
            reasoning_effort: None,
        };
        self.stream_with_thinking(request, on_delta, |_| Ok(()))
            .await
            .map(|generated| generated.content)
    }

    pub async fn stream_with_thinking<F, T>(
        &self,
        request: StreamingRequest<'_>,
        on_delta: F,
        on_thinking: T,
    ) -> Result<GeneratedContent, ProviderError>
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
        T: FnMut(&str) -> Result<(), ProviderError>,
    {
        let body = build_request(request.path, request.model, request.reasoning_effort)?;
        self.stream_chat_completion(
            request.endpoint,
            request.secret,
            request.cancellation,
            body,
            on_delta,
            on_thinking,
        )
        .await
    }

    pub(crate) async fn stream_title(
        &self,
        endpoint: &ValidatedEndpoint,
        model: &str,
        secret: Option<&SecretString>,
        cancellation: &CancellationToken,
        prompt: &TitlePrompt,
    ) -> Result<String, ProviderError> {
        let body = build_title_request(model, prompt)?;
        self.stream_chat_completion(endpoint, secret, cancellation, body, |_| Ok(()), |_| Ok(()))
            .await
            .map(|generated| generated.content)
    }

    async fn stream_chat_completion<F, T>(
        &self,
        endpoint: &ValidatedEndpoint,
        secret: Option<&SecretString>,
        cancellation: &CancellationToken,
        body: ChatCompletionRequest,
        mut on_delta: F,
        mut on_thinking: T,
    ) -> Result<GeneratedContent, ProviderError>
    where
        F: FnMut(&str) -> Result<(), ProviderError>,
        T: FnMut(&str) -> Result<(), ProviderError>,
    {
        let mut builder = self
            .client
            .post(endpoint.chat_completions_url().clone())
            .json(&body);
        if let Some(secret) = secret {
            builder = builder.bearer_auth(secret.expose_secret());
        }

        let response = match select(cancellation.cancelled().boxed(), builder.send().boxed()).await
        {
            Either::Left(_) => return Err(ProviderError::Cancelled),
            Either::Right((response, _)) => response.map_err(map_transport_error)?,
        };
        if !response.status().is_success() {
            return Err(map_status(response.status(), response.headers()));
        }

        let events = response.bytes_stream().eventsource();
        pin_mut!(events);
        let mut content = String::new();
        let mut thinking = String::new();
        let mut finished = false;
        let mut done = false;
        loop {
            let next = match select(cancellation.cancelled().boxed(), events.next().boxed()).await {
                Either::Left(_) => return Err(ProviderError::Cancelled),
                Either::Right((event, _)) => event,
            };
            let Some(event) = next else { break };
            let event = event.map_err(|_| ProviderError::Protocol)?;
            if event.data == "[DONE]" {
                done = true;
                break;
            }
            if finished {
                return Err(ProviderError::Protocol);
            }
            let chunk: StreamChunk =
                serde_json::from_str(&event.data).map_err(|_| ProviderError::Protocol)?;
            if chunk.error.is_some() || chunk.choices.len() != 1 {
                return Err(ProviderError::Protocol);
            }
            let choice = &chunk.choices[0];
            if choice.index != 0 {
                return Err(ProviderError::Protocol);
            }
            if let Some(delta) = choice.delta.content.as_deref() {
                if content.len().saturating_add(delta.len()) > MAX_RESPONSE_BYTES {
                    return Err(ProviderError::Protocol);
                }
                if !delta.is_empty() {
                    on_delta(delta)?;
                    content.push_str(delta);
                }
            }
            if let Some(delta) = choice
                .delta
                .reasoning_content
                .as_deref()
                .or(choice.delta.reasoning.as_deref())
            {
                if thinking.len().saturating_add(delta.len()) > MAX_RESPONSE_BYTES {
                    return Err(ProviderError::Protocol);
                }
                if !delta.is_empty() {
                    on_thinking(delta)?;
                    thinking.push_str(delta);
                }
            }
            if let Some(reason) = choice.finish_reason.as_deref() {
                if reason != "stop" {
                    return Err(ProviderError::Protocol);
                }
                finished = true;
            }
        }

        if !done || !finished || content.trim().is_empty() {
            return Err(ProviderError::Protocol);
        }
        Ok(GeneratedContent {
            content,
            thinking: (!thinking.is_empty()).then_some(thinking),
        })
    }
}

pub(crate) fn map_transport_error(_: reqwest::Error) -> ProviderError {
    // Endpoint, model, and credential inputs have already passed the local
    // boundary before `send`. Reqwest's error categories overlap for early
    // peer disconnects (they can be both builder and decode errors), so every
    // failure from this send phase is a transport failure. Status responses
    // and SSE protocol errors are handled after a response is received.
    ProviderError::Network
}

pub(crate) fn map_status(
    status: StatusCode,
    headers: &reqwest::header::HeaderMap,
) -> ProviderError {
    match status.as_u16() {
        401 | 403 => ProviderError::Authentication,
        429 => ProviderError::RateLimited {
            retry_after_ms: headers
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000)),
        },
        500..=599 => ProviderError::Unavailable,
        _ => ProviderError::Protocol,
    }
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    #[serde(default)]
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    index: usize,
    #[serde(default)]
    delta: StreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    reasoning: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::conversations::{NewNode, Node, ReasoningEffort, Role, ValidatedPath};

    use super::{build_request, build_title_request};

    fn node(id: &str, parent_id: Option<&str>, role: Role, content: &str) -> Node {
        let node = NewNode {
            id: id.to_owned(),
            parent_id: parent_id.map(str::to_owned),
            conversation_id: "conversation".to_owned(),
            role,
            content: content.to_owned(),
            model: None,
            created_at: 1,
            metadata: json!({}),
        };
        Node {
            id: node.id,
            parent_id: node.parent_id,
            conversation_id: node.conversation_id,
            role: node.role,
            content: node.content,
            model: node.model,
            created_at: node.created_at,
            metadata: node.metadata,
        }
    }

    #[test]
    fn request_preserves_validated_path_order_and_excludes_sibling_sentinel() {
        let path = ValidatedPath::new(vec![
            node("root", None, Role::System, "system"),
            node("assistant", Some("root"), Role::Assistant, "shared"),
            node(
                "selected",
                Some("assistant"),
                Role::User,
                "SELECTED_SENTINEL",
            ),
        ]);
        let request =
            serde_json::to_value(build_request(&path, "fixture-model", None).unwrap()).unwrap();
        assert_eq!(
            request,
            json!({
                "model": "fixture-model",
                "messages": [
                    {"role": "system", "content": "system"},
                    {"role": "assistant", "content": "shared"},
                    {"role": "user", "content": "SELECTED_SENTINEL"}
                ],
                "stream": true
            })
        );
        assert!(!request.to_string().contains("SIBLING_SENTINEL"));
    }

    #[test]
    fn title_request_bounds_reasoning_and_separates_roles() {
        let prompt = crate::providers::title_prompt::build_title_prompt(
            "USER_EXCERPT_SENTINEL",
            "ASSISTANT_EXCERPT_SENTINEL",
        );
        let request =
            serde_json::to_value(build_title_request("fixture-model", &prompt).unwrap()).unwrap();
        assert_eq!(request["max_tokens"], 256);
        assert_eq!(request["reasoning_effort"], "low");
        assert_eq!(request["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(request["messages"][0]["role"], "system");
        assert!(request["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Generate a short conversation title"));
        assert_eq!(request["messages"][1]["role"], "user");
        let user_content = request["messages"][1]["content"].as_str().unwrap();
        assert!(user_content.contains("USER_EXCERPT_SENTINEL"));
        assert!(user_content.contains("<conversation>"));
        assert!(!user_content.contains("Generate a short conversation title"));
    }

    #[test]
    fn tool_and_non_user_terminal_paths_are_rejected() {
        let tool_path = ValidatedPath::new(vec![node("tool", None, Role::Tool, "tool")]);
        assert!(build_request(&tool_path, "model", None).is_err());
        let assistant_path =
            ValidatedPath::new(vec![node("assistant", None, Role::Assistant, "answer")]);
        assert!(build_request(&assistant_path, "model", None).is_err());
        let user_path = ValidatedPath::new(vec![node("user", None, Role::User, "question")]);
        assert!(build_request(&user_path, &"m".repeat(201), None).is_err());
    }

    #[test]
    fn reasoning_effort_is_carried_only_when_selected() {
        let path = ValidatedPath::new(vec![node("user", None, Role::User, "question")]);
        let unselected =
            serde_json::to_value(build_request(&path, "fixture-model", None).unwrap()).unwrap();
        assert!(unselected.get("reasoning_effort").is_none());

        for (effort, expected) in [
            (ReasoningEffort::Low, "low"),
            (ReasoningEffort::Medium, "medium"),
            (ReasoningEffort::High, "high"),
        ] {
            let request =
                serde_json::to_value(build_request(&path, "fixture-model", Some(effort)).unwrap())
                    .unwrap();
            assert_eq!(request["reasoning_effort"], expected);
        }
    }
}
