use eventsource_stream::Eventsource;
use futures_util::{
    future::{select, Either},
    pin_mut, FutureExt, StreamExt,
};
use secrecy::ExposeSecret;
use serde::Serialize;
use serde_json::Value;

use crate::llm::{
    client::{map_status, map_transport_error, OpenAiCompatibleClient, MAX_RESPONSE_BYTES},
    ChatPrompt, GeneratedContent, LlmError, MessageRole, ReasoningEffort, StreamingRequest,
    TitlePrompt, ValidatedEndpoint,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    budget_tokens: Option<u32>,
}

#[derive(Serialize)]
struct Request {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<Message>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
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

pub fn build_request(prompt: &ChatPrompt) -> Result<Value, LlmError> {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in &prompt.messages {
        match message.role {
            MessageRole::System => system.push(message.content.clone()),
            MessageRole::User => messages.push(Message {
                role: "user",
                content: message.content.clone(),
            }),
            MessageRole::Assistant => messages.push(Message {
                role: "assistant",
                content: message.content.clone(),
            }),
        }
    }
    // Effort ladder (design §4.2): the untiered default keeps the original
    // fixed 8192 ceiling; an explicit tier raises the ceiling to
    // budget + 4096 so the answer always has a body allowance.
    let budget_tokens = budget(prompt.reasoning_effort);
    let max_tokens = match prompt.reasoning_effort {
        None => 8192,
        Some(_) => budget_tokens + 4096,
    };
    serde_json::to_value(Request {
        model: prompt.model.clone(),
        system: (!system.is_empty()).then(|| system.join("\n\n")),
        messages,
        max_tokens,
        thinking: Some(Thinking {
            kind: "enabled",
            budget_tokens: Some(budget_tokens),
        }),
        stream: true,
    })
    .map_err(|_| LlmError::Protocol)
}

fn build_title_request(model: &str, prompt: &TitlePrompt) -> Result<Value, LlmError> {
    serde_json::to_value(Request {
        model: model.trim().to_owned(),
        system: Some(prompt.system.clone()),
        messages: vec![Message {
            role: "user",
            content: prompt.user.clone(),
        }],
        // Omitting the field is not "off" for every endpoint: DeepSeek v4
        // defaults to thinking and burns the whole max_tokens budget before
        // any text. Explicit disabled is valid Anthropic and leaves the
        // title body 6-14 tokens of headroom.
        max_tokens: 256,
        thinking: Some(Thinking {
            kind: "disabled",
            budget_tokens: None,
        }),
        stream: true,
    })
    .map_err(|_| LlmError::Protocol)
}

pub async fn stream<F, T>(
    client: &OpenAiCompatibleClient,
    request: StreamingRequest<'_>,
    on_delta: F,
    on_thinking: T,
) -> Result<GeneratedContent, LlmError>
where
    F: FnMut(&str) -> Result<(), LlmError>,
    T: FnMut(&str) -> Result<(), LlmError>,
{
    let body = build_request(request.prompt)?;
    stream_body(
        client,
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
    client: &OpenAiCompatibleClient,
    endpoint: &ValidatedEndpoint,
    model: &str,
    secret: Option<&secrecy::SecretString>,
    cancellation: &tokio_util::sync::CancellationToken,
    prompt: &TitlePrompt,
) -> Result<String, LlmError> {
    stream_body(
        client,
        endpoint,
        secret,
        cancellation,
        build_title_request(model, prompt)?,
        |_| Ok(()),
        |_| Ok(()),
    )
    .await
    .map(|generated| generated.content)
}

async fn stream_body<F, T>(
    client: &OpenAiCompatibleClient,
    endpoint: &ValidatedEndpoint,
    secret: Option<&secrecy::SecretString>,
    cancellation: &tokio_util::sync::CancellationToken,
    body: Value,
    mut on_delta: F,
    mut on_thinking: T,
) -> Result<GeneratedContent, LlmError>
where
    F: FnMut(&str) -> Result<(), LlmError>,
    T: FnMut(&str) -> Result<(), LlmError>,
{
    let mut http_request = client
        .http_client()
        .post(endpoint.messages_url().clone())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&body);
    if let Some(secret) = secret {
        http_request = http_request.header("x-api-key", secret.expose_secret());
    }
    let response = match select(
        cancellation.cancelled().boxed(),
        http_request.send().boxed(),
    )
    .await
    {
        Either::Left(_) => return Err(LlmError::Cancelled),
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
    while let Some(event) =
        match select(cancellation.cancelled().boxed(), events.next().boxed()).await {
            Either::Left(_) => return Err(LlmError::Cancelled),
            Either::Right((event, _)) => event,
        }
    {
        let event = event.map_err(|_| LlmError::Protocol)?;
        let value: Value = serde_json::from_str(&event.data).map_err(|_| LlmError::Protocol)?;
        match event.event.as_str() {
            "content_block_start" => {
                let index = value["index"].as_u64().ok_or(LlmError::Protocol)?;
                let kind = value["content_block"]["type"]
                    .as_str()
                    .ok_or(LlmError::Protocol)?;
                blocks.insert(index, kind.to_owned());
            }
            "content_block_delta" => {
                let index = value["index"].as_u64().ok_or(LlmError::Protocol)?;
                let kind = blocks.get(&index).ok_or(LlmError::Protocol)?;
                let delta = &value["delta"];
                if kind == "text" && delta["type"] == "text_delta" {
                    let text = delta["text"].as_str().ok_or(LlmError::Protocol)?;
                    if content.len().saturating_add(text.len()) > MAX_RESPONSE_BYTES {
                        return Err(LlmError::Protocol);
                    }
                    if !text.is_empty() {
                        on_delta(text)?;
                        content.push_str(text);
                    }
                } else if kind == "thinking" && delta["type"] == "thinking_delta" {
                    let text = delta["thinking"].as_str().ok_or(LlmError::Protocol)?;
                    if thinking.len().saturating_add(text.len()) > MAX_RESPONSE_BYTES {
                        return Err(LlmError::Protocol);
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
                    return Err(LlmError::Protocol);
                }
            }
            "message_stop" => {
                stopped = true;
                break;
            }
            "error" => return Err(LlmError::Protocol),
            _ => {}
        }
    }
    if !stopped || !stop_reason || content.trim().is_empty() {
        return Err(LlmError::Protocol);
    }
    Ok(GeneratedContent {
        content,
        thinking: (!thinking.is_empty()).then_some(thinking),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::llm::{ChatPrompt, MessageRole, PromptMessage, ReasoningEffort, TitlePrompt};

    use super::{build_request, build_title_request};

    fn message(role: MessageRole, content: &str) -> PromptMessage {
        PromptMessage {
            role,
            content: content.to_owned(),
        }
    }

    fn prompt(effort: Option<ReasoningEffort>) -> ChatPrompt {
        ChatPrompt {
            model: "fixture-model".to_owned(),
            messages: vec![
                message(MessageRole::System, "first policy"),
                message(MessageRole::User, "question"),
                message(MessageRole::Assistant, "interim answer"),
                message(MessageRole::System, "second policy"),
                message(MessageRole::User, "SELECTED_SENTINEL"),
            ],
            reasoning_effort: effort,
        }
    }

    #[test]
    fn request_extracts_system_joins_it_and_maps_ordered_roles() {
        let request = build_request(&prompt(None)).unwrap();
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
    fn title_request_disables_thinking_and_limits_output() {
        let prompt = TitlePrompt {
            system: "Generate a short conversation title for a history list.".to_owned(),
            user: "<conversation>\n<user>\nUSER_EXCERPT_SENTINEL\n</user>\n<assistant>\nASSISTANT_EXCERPT_SENTINEL\n</assistant>\n</conversation>".to_owned(),
        };
        let request = build_title_request("fixture-model", &prompt).unwrap();
        assert_eq!(request["max_tokens"], 256);
        assert_eq!(request["thinking"]["type"], "disabled");
        assert!(request["thinking"].get("budget_tokens").is_none());
        let system = request["system"].as_str().unwrap_or_default();
        assert!(!system.is_empty());
        assert!(system.contains("Generate a short conversation title"));
        assert_eq!(request["messages"].as_array().map(Vec::len), Some(1));
        assert_eq!(request["messages"][0]["role"], "user");
        let user_content = request["messages"][0]["content"].as_str().unwrap();
        assert!(user_content.contains("USER_EXCERPT_SENTINEL"));
        assert!(user_content.contains("<conversation>"));
    }

    #[test]
    fn effort_maps_to_the_budget_and_max_tokens_ladder() {
        for (effort, budget_tokens, max_tokens) in [
            (None, 2048, 8192),
            (Some(ReasoningEffort::Low), 1024, 5120),
            (Some(ReasoningEffort::Medium), 4096, 8192),
            (Some(ReasoningEffort::High), 16384, 20480),
        ] {
            let request = build_request(&prompt(effort)).unwrap();
            assert_eq!(request["thinking"]["budget_tokens"], budget_tokens);
            assert_eq!(request["thinking"]["type"], "enabled");
            assert_eq!(request["max_tokens"], max_tokens);
        }
    }

    #[test]
    fn systemless_paths_omit_the_system_field() {
        let prompt = ChatPrompt {
            model: "fixture-model".to_owned(),
            messages: vec![message(MessageRole::User, "question")],
            reasoning_effort: None,
        };
        let request = build_request(&prompt).unwrap();
        assert!(request.get("system").is_none());
    }
}
