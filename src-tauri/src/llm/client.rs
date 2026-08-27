use std::{sync::OnceLock, time::Duration};

use reqwest::{header::RETRY_AFTER, redirect::Policy, Client, StatusCode};

use super::LlmError;

pub(crate) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleClient {
    client: Client,
}

impl OpenAiCompatibleClient {
    pub fn new() -> Result<Self, LlmError> {
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
            .map_err(|_| LlmError::Network)?;
        let _ = HTTP_CLIENT.set(client.clone());
        Ok(Self {
            client: HTTP_CLIENT.get().cloned().unwrap_or(client),
        })
    }

    pub(crate) fn http_client(&self) -> &Client {
        &self.client
    }
}

pub(crate) fn map_transport_error(_: reqwest::Error) -> LlmError {
    // Endpoint, model, and credential inputs have already passed the local
    // boundary before `send`. Reqwest's error categories overlap for early
    // peer disconnects (they can be both builder and decode errors), so every
    // failure from this send phase is a transport failure. Status responses
    // and SSE protocol errors are handled after a response is received.
    LlmError::Network
}

pub(crate) fn map_status(status: StatusCode, headers: &reqwest::header::HeaderMap) -> LlmError {
    match status.as_u16() {
        401 | 403 => LlmError::Authentication,
        429 => LlmError::RateLimited {
            retry_after_ms: headers
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000)),
        },
        500..=599 => LlmError::Unavailable,
        _ => LlmError::Protocol,
    }
}
