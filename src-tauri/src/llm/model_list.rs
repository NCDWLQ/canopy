use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use super::{
    client::{map_status, map_transport_error, OpenAiCompatibleClient},
    LlmError, Protocol, ValidatedEndpoint,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Top level of both protocols' model-list responses. `data` must be present
/// (a payload without it is malformed), while unknown top-level metadata
/// fields (OpenAI's `object`, Anthropic's `first_id`/`has_more`) are ignored.
#[derive(Deserialize)]
struct Response {
    data: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

pub async fn list_models(
    protocol: Protocol,
    endpoint: &ValidatedEndpoint,
    secret: Option<&SecretString>,
) -> Result<Vec<ModelSummary>, LlmError> {
    let client = OpenAiCompatibleClient::new()?;
    let url = endpoint.models_url().clone();
    let mut request = client.http_client().get(url);
    match protocol {
        Protocol::OpenAiCompatible => {
            if let Some(secret) = secret {
                request = request.bearer_auth(secret.expose_secret());
            }
        }
        Protocol::Anthropic => {
            request = request.header("anthropic-version", "2023-06-01");
            if let Some(secret) = secret {
                request = request.header("x-api-key", secret.expose_secret());
            }
        }
    }
    let response = request.send().await.map_err(map_transport_error)?;
    if response.status().is_success() {
        return parse_model_response(response).await;
    }

    // Anthropic-surface gateways frequently omit the models endpoint while the
    // same host serves the OpenAI-compatible list at its root (DeepSeek does
    // exactly this). Probe that surface once before surfacing the failure.
    if matches!(protocol, Protocol::Anthropic)
        && response.status() == reqwest::StatusCode::NOT_FOUND
    {
        let mut fallback = client.http_client().get(endpoint.host_root_models_url());
        if let Some(secret) = secret {
            fallback = fallback.bearer_auth(secret.expose_secret());
        }
        let fallback_response = fallback.send().await.map_err(map_transport_error)?;
        if fallback_response.status().is_success() {
            return parse_model_response(fallback_response).await;
        }
    }
    Err(map_status(response.status(), response.headers()))
}

async fn parse_model_response(response: reqwest::Response) -> Result<Vec<ModelSummary>, LlmError> {
    let response: Response = response.json().await.map_err(|_| LlmError::Protocol)?;
    if response.data.len() > 500 || response.data.iter().any(|model| model.id.trim().is_empty()) {
        return Err(LlmError::Protocol);
    }
    let mut models: Vec<_> = response
        .data
        .into_iter()
        .map(|model| ModelSummary {
            id: model.id,
            display_name: model.display_name,
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}
