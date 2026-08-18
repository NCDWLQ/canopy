mod support;

use canopy_lib::{
    conversations::{
        ConversationPersistenceService, NewConversation, NewNode, ReasoningEffort, Role,
        ValidatedPath,
    },
    providers::{
        anthropic,
        model_list::list_models,
        openai_compatible::{OpenAiCompatibleClient, StreamingRequest},
        Protocol, ProviderError, ValidatedEndpoint,
    },
};
use secrecy::SecretString;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use support::{migrated_pool, run_async, sse, sse_event, SequenceResponse, TestServer};

fn node(id: &str, parent_id: Option<&str>, role: Role, content: &str, created_at: i64) -> NewNode {
    NewNode {
        id: id.to_owned(),
        parent_id: parent_id.map(str::to_owned),
        conversation_id: "protocol-conversation".to_owned(),
        role,
        content: content.to_owned(),
        model: None,
        created_at,
        metadata: json!({}),
    }
}

async fn protocol_path() -> ValidatedPath {
    let pool = migrated_pool().await;
    let service = ConversationPersistenceService::new(pool);
    service
        .create_conversation(
            NewConversation {
                id: "protocol-conversation".to_owned(),
                title: "Protocol".to_owned(),
                root_node_id: "root".to_owned(),
            },
            node("root", None, Role::System, "system policy", 1),
        )
        .await
        .unwrap();
    service
        .append_node(node(
            "user",
            Some("root"),
            Role::User,
            "SELECTED_SENTINEL",
            2,
        ))
        .await
        .unwrap();
    service
        .load_generation_context("protocol-conversation", "user")
        .await
        .unwrap()
        .1
}

fn anthropic_events() -> Vec<Vec<u8>> {
    vec![
        sse_event("message_start", r#"{"type":"message_start","message":{}}"#),
        sse_event(
            "content_block_start",
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}"#,
        ),
        sse_event(
            "content_block_delta",
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me "}}"#,
        ),
        sse_event(
            "content_block_delta",
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"think"}}"#,
        ),
        sse_event(
            "content_block_delta",
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-ignored"}}"#,
        ),
        sse_event(
            "content_block_start",
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"text"}}"#,
        ),
        sse_event(
            "content_block_delta",
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Gene"}}"#,
        ),
        sse_event(
            "content_block_delta",
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"rated answer"}}"#,
        ),
        sse_event(
            "message_delta",
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
        ),
        sse_event("message_stop", r#"{"type":"message_stop"}"#),
    ]
}

#[test]
fn anthropic_stream_routes_blocks_and_sends_native_headers_and_body() {
    run_async(async {
        let path = protocol_path().await;
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            anthropic_events(),
        );
        let endpoint = ValidatedEndpoint::parse(&server.endpoint, Protocol::Anthropic).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let mut deltas = Vec::new();
        let mut thinking = Vec::new();
        let generated = anthropic::stream(
            &client,
            StreamingRequest {
                endpoint: &endpoint,
                path: &path,
                model: "claude-fixture",
                secret: Some(&SecretString::from("ANTHROPIC_TEST_KEY")),
                cancellation: &CancellationToken::new(),
                reasoning_effort: None,
            },
            |delta| {
                deltas.push(delta.to_owned());
                Ok(())
            },
            |delta| {
                thinking.push(delta.to_owned());
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(deltas, ["Gene", "rated answer"]);
        assert_eq!(thinking, ["let me ", "think"]);
        assert_eq!(generated.content, "Generated answer");
        assert_eq!(generated.thinking.as_deref(), Some("let me think"));

        let request = server.finish();
        assert!(request.starts_with("POST /v1/messages HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("x-api-key: anthropic_test_key"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            value,
            json!({
                "model": "claude-fixture",
                "system": "system policy",
                "messages": [{"role": "user", "content": "SELECTED_SENTINEL"}],
                "max_tokens": 8192,
                "thinking": {"type": "enabled", "budget_tokens": 2048},
                "stream": true
            })
        );
    });
}

#[test]
fn anthropic_stream_maps_effort_to_the_budget_ladder() {
    run_async(async {
        let path = protocol_path().await;
        for (effort, budget_tokens, max_tokens) in [
            (Some(ReasoningEffort::Low), 1024, 5120),
            (None, 2048, 8192),
            (Some(ReasoningEffort::Medium), 4096, 8192),
            (Some(ReasoningEffort::High), 16384, 20480),
        ] {
            let server = TestServer::spawn(
                "200 OK",
                &[("Content-Type", "text/event-stream")],
                anthropic_events(),
            );
            let endpoint = ValidatedEndpoint::parse(&server.endpoint, Protocol::Anthropic).unwrap();
            let client = OpenAiCompatibleClient::new().unwrap();
            anthropic::stream(
                &client,
                StreamingRequest {
                    endpoint: &endpoint,
                    path: &path,
                    model: "claude-fixture",
                    secret: None,
                    cancellation: &CancellationToken::new(),
                    reasoning_effort: effort,
                },
                |_| Ok(()),
                |_| Ok(()),
            )
            .await
            .unwrap();
            let request = server.finish();
            let body = request.split("\r\n\r\n").nth(1).unwrap();
            let value: serde_json::Value = serde_json::from_str(body).unwrap();
            assert_eq!(value["thinking"]["budget_tokens"], budget_tokens);
            assert_eq!(value["max_tokens"], max_tokens);
        }
    });
}

#[test]
fn anthropic_stream_accepts_max_tokens_stop_reason_and_closes_without_done() {
    run_async(async {
        let path = protocol_path().await;
        let events = vec![
            sse_event(
                "content_block_start",
                r#"{"type":"content_block_start","index":0,"content_block":{"type":"text"}}"#,
            ),
            sse_event(
                "content_block_delta",
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"truncated but valid"}}"#,
            ),
            sse_event(
                "message_delta",
                r#"{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}"#,
            ),
            sse_event("message_stop", r#"{"type":"message_stop"}"#),
        ];
        let server = TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], events);
        let endpoint = ValidatedEndpoint::parse(&server.endpoint, Protocol::Anthropic).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let generated = anthropic::stream(
            &client,
            StreamingRequest {
                endpoint: &endpoint,
                path: &path,
                model: "claude-fixture",
                secret: None,
                cancellation: &CancellationToken::new(),
                reasoning_effort: None,
            },
            |_| Ok(()),
            |_| Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(generated.content, "truncated but valid");
        assert_eq!(generated.thinking, None);
        server.finish();
    });
}

#[test]
fn anthropic_stream_failures_fail_closed_as_protocol_errors() {
    run_async(async {
        let path = protocol_path().await;
        let client = OpenAiCompatibleClient::new().unwrap();

        let cases: Vec<Vec<Vec<u8>>> = vec![
            // stop_sequence is not a normal completion.
            vec![
                sse_event(
                    "content_block_start",
                    r#"{"type":"content_block_start","index":0,"content_block":{"type":"text"}}"#,
                ),
                sse_event(
                    "content_block_delta",
                    r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}"#,
                ),
                sse_event(
                    "message_delta",
                    r#"{"type":"message_delta","delta":{"stop_reason":"stop_sequence"}}"#,
                ),
                sse_event("message_stop", r#"{"type":"message_stop"}"#),
            ],
            // Stream ends before message_stop (truncated).
            vec![
                sse_event(
                    "content_block_start",
                    r#"{"type":"content_block_start","index":0,"content_block":{"type":"text"}}"#,
                ),
                sse_event(
                    "content_block_delta",
                    r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}"#,
                ),
                sse_event(
                    "message_delta",
                    r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
                ),
            ],
            // message_stop without a recorded stop reason.
            vec![
                sse_event(
                    "content_block_start",
                    r#"{"type":"content_block_start","index":0,"content_block":{"type":"text"}}"#,
                ),
                sse_event(
                    "content_block_delta",
                    r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}"#,
                ),
                sse_event("message_stop", r#"{"type":"message_stop"}"#),
            ],
            // Provider error event.
            vec![sse_event(
                "error",
                r#"{"type":"error","error":{"message":"private body"}}"#,
            )],
            // Delta for an index that never had content_block_start.
            vec![sse_event(
                "content_block_delta",
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}"#,
            )],
            // Thinking-only stream: content stays a success precondition.
            vec![
                sse_event(
                    "content_block_start",
                    r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}"#,
                ),
                sse_event(
                    "content_block_delta",
                    r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"only thoughts"}}"#,
                ),
                sse_event(
                    "message_delta",
                    r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#,
                ),
                sse_event("message_stop", r#"{"type":"message_stop"}"#),
            ],
            // Malformed JSON payload.
            vec![sse_event("content_block_start", "not-json")],
        ];

        for chunks in cases {
            let server =
                TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], chunks);
            let endpoint = ValidatedEndpoint::parse(&server.endpoint, Protocol::Anthropic).unwrap();
            let result = anthropic::stream(
                &client,
                StreamingRequest {
                    endpoint: &endpoint,
                    path: &path,
                    model: "claude-fixture",
                    secret: None,
                    cancellation: &CancellationToken::new(),
                    reasoning_effort: None,
                },
                |_| Ok(()),
                |_| Ok(()),
            )
            .await;
            assert!(
                matches!(result, Err(ProviderError::Protocol)),
                "expected a protocol error"
            );
            server.finish();
        }
    });
}

#[test]
fn openai_stream_captures_reasoning_content_and_reasoning_thinking() {
    run_async(async {
        let path = protocol_path().await;
        let chunks = vec![
            sse(
                r#"{"choices":[{"index":0,"delta":{"reasoning_content":"deepseek "},"finish_reason":null}]}"#,
            ),
            sse(
                r#"{"choices":[{"index":0,"delta":{"reasoning_content":"trace"},"finish_reason":null}]}"#,
            ),
            sse(
                r#"{"choices":[{"index":0,"delta":{"content":"Generated answer"},"finish_reason":"stop"}]}"#,
            ),
            sse("[DONE]"),
        ];
        let server = TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], chunks);
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let mut thinking = Vec::new();
        let generated = client
            .stream_with_thinking(
                StreamingRequest {
                    endpoint: &endpoint,
                    path: &path,
                    model: "fixture-model",
                    secret: None,
                    cancellation: &CancellationToken::new(),
                    reasoning_effort: Some(ReasoningEffort::Low),
                },
                |_| Ok(()),
                |delta| {
                    thinking.push(delta.to_owned());
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(thinking, ["deepseek ", "trace"]);
        assert_eq!(generated.content, "Generated answer");
        assert_eq!(generated.thinking.as_deref(), Some("deepseek trace"));
        let request = server.finish();
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(value["reasoning_effort"], "low");
    });
}

#[test]
fn openai_stream_prefers_reasoning_content_and_skips_empty_thinking() {
    run_async(async {
        let path = protocol_path().await;
        let chunks = vec![
            // Empty reasoning strings are skipped, not errors.
            sse(
                r#"{"choices":[{"index":0,"delta":{"reasoning_content":""},"finish_reason":null}]}"#,
            ),
            // Both fields in one chunk: reasoning_content wins.
            sse(
                r#"{"choices":[{"index":0,"delta":{"reasoning":"openrouter","reasoning_content":"preferred"},"finish_reason":null}]}"#,
            ),
            sse(r#"{"choices":[{"index":0,"delta":{"reasoning":"-tail"},"finish_reason":null}]}"#),
            sse(
                r#"{"choices":[{"index":0,"delta":{"content":"Generated answer"},"finish_reason":"stop"}]}"#,
            ),
            sse("[DONE]"),
        ];
        let server = TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], chunks);
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let mut thinking = Vec::new();
        let generated = client
            .stream_with_thinking(
                StreamingRequest {
                    endpoint: &endpoint,
                    path: &path,
                    model: "fixture-model",
                    secret: None,
                    cancellation: &CancellationToken::new(),
                    reasoning_effort: None,
                },
                |_| Ok(()),
                |delta| {
                    thinking.push(delta.to_owned());
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(thinking, ["preferred", "-tail"]);
        assert_eq!(generated.thinking.as_deref(), Some("preferred-tail"));
        // No effort selected: the request body omits reasoning_effort.
        let request = server.finish();
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert!(value.get("reasoning_effort").is_none());
    });
}

#[test]
fn openai_stream_without_thinking_fields_stays_a_plain_content_stream() {
    run_async(async {
        let path = protocol_path().await;
        let chunks = vec![
            sse(
                r#"{"choices":[{"index":0,"delta":{"content":"Generated answer"},"finish_reason":"stop"}]}"#,
            ),
            sse("[DONE]"),
        ];
        let server = TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], chunks);
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let generated = client
            .stream_with_thinking(
                StreamingRequest {
                    endpoint: &endpoint,
                    path: &path,
                    model: "fixture-model",
                    secret: None,
                    cancellation: &CancellationToken::new(),
                    reasoning_effort: None,
                },
                |_| Ok(()),
                |_| Ok(()),
            )
            .await
            .unwrap();
        assert_eq!(generated.content, "Generated answer");
        assert_eq!(generated.thinking, None);
        server.finish();
    });
}

#[test]
fn model_lists_are_sorted_bounded_and_parsed_per_protocol() {
    run_async(async {
        // OpenAI compatible: Bearer auth, id-only entries, sorted by id.
        let body = r#"{"data":[{"id":"zeta"},{"id":"alpha"},{"id":"mid"}]}"#;
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "application/json")],
            vec![body.as_bytes().to_vec()],
        );
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let models = list_models(
            Protocol::OpenAiCompatible,
            &endpoint,
            Some(&SecretString::from("OPENAI_TEST_KEY")),
        )
        .await
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "mid", "zeta"]
        );
        assert!(models.iter().all(|model| model.display_name.is_none()));
        let request = server.finish();
        assert!(request.starts_with("GET /v1/models HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer openai_test_key"));

        // Anthropic: x-api-key + anthropic-version, display names preserved.
        let body = r#"{"data":[{"id":"claude-3","display_name":"Claude 3"},{"id":"claude-4"}]}"#;
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "application/json")],
            vec![body.as_bytes().to_vec()],
        );
        let endpoint = ValidatedEndpoint::parse(&server.endpoint, Protocol::Anthropic).unwrap();
        let models = list_models(
            Protocol::Anthropic,
            &endpoint,
            Some(&SecretString::from("ANTHROPIC_TEST_KEY")),
        )
        .await
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| (model.id.as_str(), model.display_name.clone()))
                .collect::<Vec<_>>(),
            [
                ("claude-3", Some("Claude 3".to_owned())),
                ("claude-4", None),
            ]
        );
        let request = server.finish();
        assert!(request.starts_with("GET /v1/models HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("x-api-key: anthropic_test_key"));
        assert!(request.contains("anthropic-version: 2023-06-01"));

        // Empty list resolves without models.
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "application/json")],
            vec![r#"{"data":[]}"#.as_bytes().to_vec()],
        );
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let models = list_models(Protocol::OpenAiCompatible, &endpoint, None)
            .await
            .unwrap();
        assert!(models.is_empty());
        server.finish();

        // Malformed payloads fail closed.
        for body in [r#"{"unexpected": true}"#, "not-json"] {
            let server = TestServer::spawn(
                "200 OK",
                &[("Content-Type", "application/json")],
                vec![body.as_bytes().to_vec()],
            );
            let endpoint =
                ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
            let result = list_models(Protocol::OpenAiCompatible, &endpoint, None).await;
            assert!(
                matches!(result, Err(ProviderError::Protocol)),
                "malformed body must fail closed"
            );
            server.finish();
        }

        // More than 500 models is refused rather than truncated.
        let oversized = format!(
            r#"{{"data":[{}]}}"#,
            (0..501)
                .map(|index| format!(r#"{{"id":"model-{index}"}}"#))
                .collect::<Vec<_>>()
                .join(",")
        );
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "application/json")],
            vec![oversized.as_bytes().to_vec()],
        );
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let result = list_models(Protocol::OpenAiCompatible, &endpoint, None).await;
        assert!(matches!(result, Err(ProviderError::Protocol)));
        server.finish();
    });
}

#[test]
fn anthropic_model_list_falls_back_to_the_openai_surface_on_404() {
    run_async(async {
        // A gateway base with a non-/v1 path prefix (DeepSeek style): the
        // anthropic surface answers 404 while the host root serves the
        // OpenAI-compatible list.
        let server = TestServer::spawn_sequence(vec![
            SequenceResponse::json("404 Not Found", ""),
            SequenceResponse::json(
                "200 OK",
                r#"{"object":"list","data":[{"id":"deepseek-reasoner"},{"id":"deepseek-chat"},{"id":"deepseek-chat","display_name":"ignored"}]}"#,
            ),
        ]);
        let base = format!("http://{}/anthropic", server.address);
        let endpoint = ValidatedEndpoint::parse(&base, Protocol::Anthropic).unwrap();
        let models = list_models(
            Protocol::Anthropic,
            &endpoint,
            Some(&SecretString::from("DUAL_SURFACE_KEY")),
        )
        .await
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["deepseek-chat", "deepseek-chat", "deepseek-reasoner"]
        );
        let requests = server.finish_all();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /anthropic/v1/models HTTP/1.1"));
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("x-api-key: dual_surface_key"));
        assert!(requests[1].starts_with("GET /v1/models HTTP/1.1"));
        assert!(requests[1]
            .to_ascii_lowercase()
            .contains("authorization: bearer dual_surface_key"));

        // A gateway with no OpenAI surface either keeps failing as a protocol
        // error; the fallback probe must not mask non-404 statuses.
        let server = TestServer::spawn_sequence(vec![
            SequenceResponse::json("404 Not Found", ""),
            SequenceResponse::json("404 Not Found", ""),
        ]);
        let base = format!("http://{}/anthropic", server.address);
        let endpoint = ValidatedEndpoint::parse(&base, Protocol::Anthropic).unwrap();
        let result = list_models(
            Protocol::Anthropic,
            &endpoint,
            Some(&SecretString::from("DUAL_SURFACE_KEY")),
        )
        .await;
        assert!(matches!(result, Err(ProviderError::Protocol)));
        assert_eq!(server.finish_all().len(), 2);

        // Non-404 failures (e.g. 401) never trigger the fallback probe.
        let server = TestServer::spawn(
            "401 Unauthorized",
            &[("Content-Type", "application/json")],
            vec![b""[..].to_vec()],
        );
        let base = format!("http://{}/anthropic", server.address);
        let endpoint = ValidatedEndpoint::parse(&base, Protocol::Anthropic).unwrap();
        let result = list_models(
            Protocol::Anthropic,
            &endpoint,
            Some(&SecretString::from("DUAL_SURFACE_KEY")),
        )
        .await;
        assert!(matches!(result, Err(ProviderError::Authentication)));
        server.finish();
    });
}
