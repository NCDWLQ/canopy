use eventsource_stream::Eventsource;
use futures_util::{
    future::{select, Either},
    pin_mut, FutureExt, StreamExt,
};
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::llm::{
    client::{map_status, map_transport_error, MAX_RESPONSE_BYTES},
    ChatPrompt, GeneratedContent, LlmError, ReasoningEffort, StreamingRequest, TitlePrompt,
    ValidatedEndpoint,
};

pub use crate::llm::client::OpenAiCompatibleClient;

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

pub fn build_request(prompt: &ChatPrompt) -> ChatCompletionRequest {
    ChatCompletionRequest {
        model: prompt.model.clone(),
        messages: prompt
            .messages
            .iter()
            .map(|message| ChatMessage {
                role: message.role.as_str(),
                content: message.content.clone(),
            })
            .collect(),
        stream: true,
        reasoning_effort: prompt.reasoning_effort.map(ReasoningEffort::as_str),
        max_tokens: None,
    }
}

fn build_title_request(
    model: &str,
    prompt: &TitlePrompt,
) -> Result<ChatCompletionRequest, LlmError> {
    let model = model.trim();
    if model.is_empty() {
        return Err(LlmError::invalid_input("model", "blank"));
    }
    if model.len() > 200 {
        return Err(LlmError::invalid_input("model", "too_long"));
    }
    Ok(ChatCompletionRequest {
        model: model.to_owned(),
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

impl OpenAiCompatibleClient {
    pub async fn stream<F>(
        &self,
        endpoint: &ValidatedEndpoint,
        prompt: &ChatPrompt,
        secret: Option<&secrecy::SecretString>,
        cancellation: &tokio_util::sync::CancellationToken,
        on_delta: F,
    ) -> Result<String, LlmError>
    where
        F: FnMut(&str) -> Result<(), LlmError>,
    {
        let request = StreamingRequest {
            endpoint,
            prompt,
            secret,
            cancellation,
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
    ) -> Result<GeneratedContent, LlmError>
    where
        F: FnMut(&str) -> Result<(), LlmError>,
        T: FnMut(&str) -> Result<(), LlmError>,
    {
        let body = build_request(request.prompt);
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
        secret: Option<&secrecy::SecretString>,
        cancellation: &tokio_util::sync::CancellationToken,
        prompt: &TitlePrompt,
    ) -> Result<String, LlmError> {
        let body = build_title_request(model, prompt)?;
        self.stream_chat_completion(endpoint, secret, cancellation, body, |_| Ok(()), |_| Ok(()))
            .await
            .map(|generated| generated.content)
    }

    async fn stream_chat_completion<F, T>(
        &self,
        endpoint: &ValidatedEndpoint,
        secret: Option<&secrecy::SecretString>,
        cancellation: &tokio_util::sync::CancellationToken,
        body: ChatCompletionRequest,
        mut on_delta: F,
        mut on_thinking: T,
    ) -> Result<GeneratedContent, LlmError>
    where
        F: FnMut(&str) -> Result<(), LlmError>,
        T: FnMut(&str) -> Result<(), LlmError>,
    {
        let mut builder = self
            .http_client()
            .post(endpoint.chat_completions_url().clone())
            .json(&body);
        if let Some(secret) = secret {
            builder = builder.bearer_auth(secret.expose_secret());
        }

        let response = match select(cancellation.cancelled().boxed(), builder.send().boxed()).await
        {
            Either::Left(_) => return Err(LlmError::Cancelled),
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
                Either::Left(_) => return Err(LlmError::Cancelled),
                Either::Right((event, _)) => event,
            };
            let Some(event) = next else { break };
            let event = event.map_err(|_| LlmError::Protocol)?;
            if event.data == "[DONE]" {
                done = true;
                break;
            }
            if finished {
                return Err(LlmError::Protocol);
            }
            let chunk: StreamChunk =
                serde_json::from_str(&event.data).map_err(|_| LlmError::Protocol)?;
            if chunk.error.is_some() || chunk.choices.len() != 1 {
                return Err(LlmError::Protocol);
            }
            let choice = &chunk.choices[0];
            if choice.index != 0 {
                return Err(LlmError::Protocol);
            }
            if let Some(delta) = choice.delta.content.as_deref() {
                if content.len().saturating_add(delta.len()) > MAX_RESPONSE_BYTES {
                    return Err(LlmError::Protocol);
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
                    return Err(LlmError::Protocol);
                }
                if !delta.is_empty() {
                    on_thinking(delta)?;
                    thinking.push_str(delta);
                }
            }
            if let Some(reason) = choice.finish_reason.as_deref() {
                if reason != "stop" {
                    return Err(LlmError::Protocol);
                }
                finished = true;
            }
        }

        if !done || !finished || content.trim().is_empty() {
            return Err(LlmError::Protocol);
        }
        Ok(GeneratedContent {
            content,
            thinking: (!thinking.is_empty()).then_some(thinking),
        })
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

    use crate::llm::{ChatPrompt, MessageRole, PromptMessage, ReasoningEffort, TitlePrompt};

    use super::{build_request, build_title_request};

    fn prompt(messages: Vec<PromptMessage>, effort: Option<ReasoningEffort>) -> ChatPrompt {
        ChatPrompt {
            model: "fixture-model".to_owned(),
            messages,
            reasoning_effort: effort,
        }
    }

    fn message(role: MessageRole, content: &str) -> PromptMessage {
        PromptMessage {
            role,
            content: content.to_owned(),
        }
    }

    #[test]
    fn request_preserves_validated_path_order_and_excludes_sibling_sentinel() {
        let request = serde_json::to_value(build_request(&prompt(
            vec![
                message(MessageRole::System, "system"),
                message(MessageRole::Assistant, "shared"),
                message(MessageRole::User, "SELECTED_SENTINEL"),
            ],
            None,
        )))
        .unwrap();
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
        let prompt = TitlePrompt {
            system: "Generate a short conversation title for a history list.".to_owned(),
            user: "<conversation>\n<user>\nUSER_EXCERPT_SENTINEL\n</user>\n<assistant>\nASSISTANT_EXCERPT_SENTINEL\n</assistant>\n</conversation>".to_owned(),
        };
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
    fn reasoning_effort_is_carried_only_when_selected() {
        let messages = vec![message(MessageRole::User, "question")];
        let unselected =
            serde_json::to_value(build_request(&prompt(messages.clone(), None))).unwrap();
        assert!(unselected.get("reasoning_effort").is_none());

        for (effort, expected) in [
            (ReasoningEffort::Low, "low"),
            (ReasoningEffort::Medium, "medium"),
            (ReasoningEffort::High, "high"),
        ] {
            let request =
                serde_json::to_value(build_request(&prompt(messages.clone(), Some(effort))))
                    .unwrap();
            assert_eq!(request["reasoning_effort"], expected);
        }
    }
}
