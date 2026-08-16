use eventsource_stream::Eventsource;
use futures_util::{
    future::{select, Either},
    pin_mut, FutureExt, StreamExt,
};
use secrecy::ExposeSecret;
use serde::Serialize;
use serde_json::Value;

use crate::conversations::{ReasoningEffort, Role, ValidatedPath};

use super::{
    openai_compatible::{
        map_status, map_transport_error, GeneratedContent, OpenAiCompatibleClient,
        StreamingRequest, MAX_RESPONSE_BYTES,
    },
    ProviderError,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: &'static str,
    budget_tokens: u32,
}

#[derive(Serialize)]
struct Request {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<Message>,
    max_tokens: u32,
    thinking: Thinking,
    stream: bool,
}

fn budget(effort: Option<ReasoningEffort>) -> u32 {
    match effort {
        None => 2048,
        Some(ReasoningEffort::Low) => 1024,
        Some(ReasoningEffort::Medium) => 4096,
        Some(ReasoningEffort::High) => 16384,
    }
}

pub fn build_request(
    path: &ValidatedPath,
    model: &str,
    effort: Option<ReasoningEffort>,
) -> Result<Value, ProviderError> {
    if path.as_slice().last().map(|node| node.role) != Some(Role::User) {
        return Err(ProviderError::invalid_input(
            "active_node_id",
            "terminal_role_must_be_user",
        ));
    }
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for node in path.as_slice() {
        if node.content.trim().is_empty() {
            return Err(ProviderError::invalid_input(
                "active_node_id",
                "blank_content",
            ));
        }
        match node.role {
            Role::System => system.push(node.content.clone()),
            Role::User => messages.push(Message {
                role: "user",
                content: node.content.clone(),
            }),
            Role::Assistant => messages.push(Message {
                role: "assistant",
                content: node.content.clone(),
            }),
            Role::Tool => {
                return Err(ProviderError::invalid_input(
                    "active_node_id",
                    "tool_role_unsupported",
                ))
            }
        }
    }
    // Effort ladder (design §4.2): the untiered default keeps the original
    // fixed 8192 ceiling; an explicit tier raises the ceiling to
    // budget + 4096 so the answer always has a body allowance.
    let budget_tokens = budget(effort);
    let max_tokens = match effort {
        None => 8192,
        Some(_) => budget_tokens + 4096,
    };
    serde_json::to_value(Request {
        model: model.trim().to_owned(),
        system: (!system.is_empty()).then(|| system.join("\n\n")),
        messages,
        max_tokens,
        thinking: Thinking {
            kind: "enabled",
            budget_tokens,
        },
        stream: true,
    })
    .map_err(|_| ProviderError::Protocol)
}

pub async fn stream<F, T>(
    client: &OpenAiCompatibleClient,
    request: StreamingRequest<'_>,
    mut on_delta: F,
    mut on_thinking: T,
) -> Result<GeneratedContent, ProviderError>
where
    F: FnMut(&str) -> Result<(), ProviderError>,
    T: FnMut(&str) -> Result<(), ProviderError>,
{
    let mut http_request = client
        .http_client()
        .post(request.endpoint.messages_url().clone())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&build_request(
            request.path,
            request.model,
            request.reasoning_effort,
        )?);
    if let Some(secret) = request.secret {
        http_request = http_request.header("x-api-key", secret.expose_secret());
    }
    let response = match select(
        request.cancellation.cancelled().boxed(),
        http_request.send().boxed(),
    )
    .await
    {
        Either::Left(_) => return Err(ProviderError::Cancelled),
        Either::Right((response, _)) => response.map_err(map_transport_error)?,
    };
    if !response.status().is_success() {
        return Err(map_status(response.status(), response.headers()));
    }
    let events = response.bytes_stream().eventsource();
    pin_mut!(events);
    let mut blocks: std::collections::HashMap<u64, String> = std::collections::HashMap::new();
    let mut content = String::new();
    let mut thinking = String::new();
    let mut stop_reason = false;
    let mut stopped = false;
    while let Some(event) = match select(
        request.cancellation.cancelled().boxed(),
        events.next().boxed(),
    )
    .await
    {
        Either::Left(_) => return Err(ProviderError::Cancelled),
        Either::Right((event, _)) => event,
    } {
        let event = event.map_err(|_| ProviderError::Protocol)?;
        let value: Value =
            serde_json::from_str(&event.data).map_err(|_| ProviderError::Protocol)?;
        match event.event.as_str() {
            "content_block_start" => {
                let index = value["index"].as_u64().ok_or(ProviderError::Protocol)?;
                let kind = value["content_block"]["type"]
                    .as_str()
                    .ok_or(ProviderError::Protocol)?;
                blocks.insert(index, kind.to_owned());
            }
            "content_block_delta" => {
                let index = value["index"].as_u64().ok_or(ProviderError::Protocol)?;
                let kind = blocks.get(&index).ok_or(ProviderError::Protocol)?;
                let delta = &value["delta"];
                if kind == "text" && delta["type"] == "text_delta" {
                    let text = delta["text"].as_str().ok_or(ProviderError::Protocol)?;
                    if content.len().saturating_add(text.len()) > MAX_RESPONSE_BYTES {
                        return Err(ProviderError::Protocol);
                    }
                    if !text.is_empty() {
                        on_delta(text)?;
                        content.push_str(text);
                    }
                } else if kind == "thinking" && delta["type"] == "thinking_delta" {
                    let text = delta["thinking"].as_str().ok_or(ProviderError::Protocol)?;
                    if thinking.len().saturating_add(text.len()) > MAX_RESPONSE_BYTES {
                        return Err(ProviderError::Protocol);
                    }
                    if !text.is_empty() {
                        on_thinking(text)?;
                        thinking.push_str(text);
                    }
                }
            }
            "message_delta" => {
                stop_reason = matches!(
                    value["delta"]["stop_reason"].as_str(),
                    Some("end_turn" | "max_tokens")
                );
                if !stop_reason {
                    return Err(ProviderError::Protocol);
                }
            }
            "message_stop" => {
                stopped = true;
                break;
            }
            "error" => return Err(ProviderError::Protocol),
            _ => {}
        }
    }
    if !stopped || !stop_reason || content.trim().is_empty() {
        return Err(ProviderError::Protocol);
    }
    Ok(GeneratedContent {
        content,
        thinking: (!thinking.is_empty()).then_some(thinking),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::conversations::{NewNode, Node, ReasoningEffort, Role, ValidatedPath};

    use super::build_request;

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

    fn path() -> ValidatedPath {
        ValidatedPath::new(vec![
            node("system-a", None, Role::System, "first policy"),
            node("user", Some("system-a"), Role::User, "question"),
            node(
                "assistant",
                Some("user"),
                Role::Assistant,
                "interim answer",
            ),
            node("system-b", Some("assistant"), Role::System, "second policy"),
            node("follow-up", Some("system-b"), Role::User, "SELECTED_SENTINEL"),
        ])
    }

    #[test]
    fn request_extracts_system_joins_it_and_maps_ordered_roles() {
        let request = build_request(&path(), "fixture-model", None).unwrap();
        assert_eq!(
            request,
            json!({
                "model": "fixture-model",
                "system": "first policy\n\nsecond policy",
                "messages": [
                    {"role": "user", "content": "question"},
                    {"role": "assistant", "content": "interim answer"},
                    {"role": "user", "content": "SELECTED_SENTINEL"}
                ],
                "max_tokens": 8192,
                "thinking": {"type": "enabled", "budget_tokens": 2048},
                "stream": true
            })
        );
    }

    #[test]
    fn effort_maps_to_the_budget_and_max_tokens_ladder() {
        for (effort, budget_tokens, max_tokens) in [
            (None, 2048, 8192),
            (Some(ReasoningEffort::Low), 1024, 5120),
            (Some(ReasoningEffort::Medium), 4096, 8192),
            (Some(ReasoningEffort::High), 16384, 20480),
        ] {
            let request = build_request(&path(), "fixture-model", effort).unwrap();
            assert_eq!(request["thinking"]["budget_tokens"], budget_tokens);
            assert_eq!(request["thinking"]["type"], "enabled");
            assert_eq!(request["max_tokens"], max_tokens);
        }
    }

    #[test]
    fn systemless_paths_omit_the_system_field() {
        let path = ValidatedPath::new(vec![node("user", None, Role::User, "question")]);
        let request = build_request(&path, "fixture-model", None).unwrap();
        assert!(request.get("system").is_none());
    }

    #[test]
    fn tool_blank_and_non_user_terminal_paths_are_rejected() {
        let tool_path =
            ValidatedPath::new(vec![node("tool", None, Role::Tool, "tool content")]);
        assert!(build_request(&tool_path, "model", None).is_err());

        let blank_path = ValidatedPath::new(vec![
            node("user", None, Role::User, "  \n\t "),
        ]);
        assert!(build_request(&blank_path, "model", None).is_err());

        let assistant_terminal =
            ValidatedPath::new(vec![node("assistant", None, Role::Assistant, "answer")]);
        assert!(build_request(&assistant_terminal, "model", None).is_err());
    }
}
