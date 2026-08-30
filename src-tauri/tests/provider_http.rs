mod support;

use std::{net::TcpListener, thread, time::Duration};

use canopy_lib::{
    conversations::{
        ConversationPersistenceService, NewConversation, NewNode, Role, ValidatedPath,
    },
    generation::chat_prompt_from_path,
    llm::{LlmError, OpenAiCompatibleClient, Protocol, ValidatedEndpoint},
};
use secrecy::SecretString;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use support::{migrated_pool, run_async, sse, TestServer};

fn chat_prompt(path: &ValidatedPath, model: &str) -> canopy_lib::llm::ChatPrompt {
    chat_prompt_from_path(path, model, None, None).unwrap()
}

fn node(id: &str, parent_id: Option<&str>, role: Role, content: &str, created_at: i64) -> NewNode {
    NewNode {
        id: id.to_owned(),
        parent_id: parent_id.map(str::to_owned),
        conversation_id: "http-conversation".to_owned(),
        role,
        content: content.to_owned(),
        model: None,
        created_at,
        metadata: json!({}),
    }
}

async fn sibling_path() -> ValidatedPath {
    let pool = migrated_pool().await;
    let service = ConversationPersistenceService::new(pool);
    service
        .create_conversation(
            NewConversation {
                id: "http-conversation".to_owned(),
                title: "HTTP".to_owned(),
                root_node_id: "root".to_owned(),
            },
            node("root", None, Role::System, "system", 1),
        )
        .await
        .unwrap();
    service
        .append_node(node(
            "assistant-shared",
            Some("root"),
            Role::Assistant,
            "shared",
            2,
        ))
        .await
        .unwrap();
    service
        .append_node(node(
            "user-left",
            Some("assistant-shared"),
            Role::User,
            "SIBLING_SENTINEL",
            3,
        ))
        .await
        .unwrap();
    service
        .append_node(node(
            "user-right",
            Some("assistant-shared"),
            Role::User,
            "SELECTED_SENTINEL",
            4,
        ))
        .await
        .unwrap();
    service
        .load_generation_context("http-conversation", "user-right")
        .await
        .unwrap()
        .1
}

#[test]
fn local_sse_stream_preserves_deltas_request_path_and_header_boundary() {
    run_async(async {
        let path = sibling_path().await;
        let first = b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Gene".to_vec();
        let second = b"rated \"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DO".to_vec();
        let third = b"NE]\n\n".to_vec();
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            vec![first, second, third],
        );
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        let cancellation = CancellationToken::new();
        let mut deltas = Vec::new();
        let content = client
            .stream(
                &endpoint,
                &chat_prompt(&path, "fixture-model"),
                Some(&SecretString::from("TEST_HEADER_VALUE")),
                &cancellation,
                |delta| {
                    deltas.push(delta.to_owned());
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(deltas, ["Generated ", "answer"]);
        assert_eq!(content, "Generated answer");

        let request = server.finish();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer test_header_value"));
        assert!(request.contains("SELECTED_SENTINEL"));
        assert!(!request.contains("SIBLING_SENTINEL"));
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            value["messages"],
            json!([
                {"role": "system", "content": "system"},
                {"role": "assistant", "content": "shared"},
                {"role": "user", "content": "SELECTED_SENTINEL"}
            ])
        );
    });
}

#[test]
fn injected_system_prompt_is_prepended_on_a_user_root_path() {
    run_async(async {
        let pool = migrated_pool().await;
        let service = ConversationPersistenceService::new(pool);
        service
            .create_conversation(
                NewConversation {
                    id: "http-conversation".to_owned(),
                    title: "HTTP".to_owned(),
                    root_node_id: "root".to_owned(),
                },
                node("root", None, Role::User, "SELECTED_SENTINEL", 1),
            )
            .await
            .unwrap();
        let path = service
            .load_generation_context("http-conversation", "root")
            .await
            .unwrap()
            .1;
        let server = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            vec![b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".to_vec()],
        );
        let endpoint =
            ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
        let client = OpenAiCompatibleClient::new().unwrap();
        client
            .stream(
                &endpoint,
                &chat_prompt_from_path(&path, "fixture-model", None, Some("INJECTED_SYSTEM"))
                    .unwrap(),
                None,
                &CancellationToken::new(),
                |_| Ok(()),
            )
            .await
            .unwrap();
        let request = server.finish();
        let body = request.split("\r\n\r\n").nth(1).unwrap();
        let value: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            value["messages"],
            json!([
                {"role": "system", "content": "INJECTED_SYSTEM"},
                {"role": "user", "content": "SELECTED_SENTINEL"}
            ])
        );
    });
}

#[test]
fn status_truncation_and_precancel_map_without_persistence() {
    run_async(async {
        let path = sibling_path().await;
        let client = OpenAiCompatibleClient::new().unwrap();
        for (status, headers, expected) in [
            ("401 Unauthorized", vec![], LlmError::Authentication),
            (
                "429 Too Many Requests",
                vec![("Retry-After", "2")],
                LlmError::RateLimited {
                    retry_after_ms: Some(2000),
                },
            ),
            ("503 Service Unavailable", vec![], LlmError::Unavailable),
        ] {
            let server = TestServer::spawn(status, &headers, vec![]);
            let endpoint =
                ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
            let error = client
                .stream(
                    &endpoint,
                    &chat_prompt(&path, "model"),
                    None,
                    &CancellationToken::new(),
                    |_| Ok(()),
                )
                .await
                .unwrap_err();
            assert_eq!(
                std::mem::discriminant(&error),
                std::mem::discriminant(&expected)
            );
            if let LlmError::RateLimited { retry_after_ms } = error {
                assert_eq!(retry_after_ms, Some(2000));
            }
            server.finish();
        }

        let truncated = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            vec![b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n".to_vec()],
        );
        let endpoint =
            ValidatedEndpoint::parse(&truncated.endpoint, Protocol::OpenAiCompatible).unwrap();
        assert!(matches!(
            client
                .stream(
                    &endpoint,
                    &chat_prompt(&path, "model"),
                    None,
                    &CancellationToken::new(),
                    |_| Ok(())
                )
                .await,
            Err(LlmError::Protocol)
        ));
        truncated.finish();

        let cancelled = CancellationToken::new();
        cancelled.cancel();
        let unreachable =
            ValidatedEndpoint::parse("http://127.0.0.1:9/v1", Protocol::OpenAiCompatible).unwrap();
        assert!(matches!(
            client
                .stream(
                    &unreachable,
                    &chat_prompt(&path, "model"),
                    None,
                    &cancelled,
                    |_| Ok(())
                )
                .await,
            Err(LlmError::Cancelled)
        ));
    });
}

#[test]
fn redirects_are_not_followed_with_credentials() {
    run_async(async {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let location = format!("http://{}/capture", target.local_addr().unwrap());
        let source = TestServer::spawn("302 Found", &[("Location", location.as_str())], vec![]);
        let path = sibling_path().await;
        let endpoint =
            ValidatedEndpoint::parse(&source.endpoint, Protocol::OpenAiCompatible).unwrap();
        let result = OpenAiCompatibleClient::new()
            .unwrap()
            .stream(
                &endpoint,
                &chat_prompt(&path, "model"),
                Some(&SecretString::from("REDIRECT_TEST_VALUE")),
                &CancellationToken::new(),
                |_| Ok(()),
            )
            .await;
        assert!(matches!(result, Err(LlmError::Protocol)));
        source.finish();
        thread::sleep(Duration::from_millis(20));
        assert!(target.accept().is_err());
    });
}

#[test]
fn malformed_non_normal_and_post_finish_streams_fail_closed() {
    run_async(async {
        let path = sibling_path().await;
        let client = OpenAiCompatibleClient::new().unwrap();
        let cases = [
            vec![sse("not-json")],
            vec![sse(
                r#"{"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"length"}]}"#,
            )],
            vec![
                sse(
                    r#"{"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}"#,
                ),
                sse(r#"{"choices":[{"index":0,"delta":{"content":"late"},"finish_reason":null}]}"#),
                sse("[DONE]"),
            ],
            vec![sse(
                r#"{"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null},{"index":1,"delta":{"content":"b"},"finish_reason":null}]}"#,
            )],
            vec![sse(r#"{"error":{"message":"private body"},"choices":[]}"#)],
        ];

        for chunks in cases {
            let server =
                TestServer::spawn("200 OK", &[("Content-Type", "text/event-stream")], chunks);
            let endpoint =
                ValidatedEndpoint::parse(&server.endpoint, Protocol::OpenAiCompatible).unwrap();
            assert!(matches!(
                client
                    .stream(
                        &endpoint,
                        &chat_prompt(&path, "model"),
                        None,
                        &CancellationToken::new(),
                        |_| Ok(())
                    )
                    .await,
                Err(LlmError::Protocol)
            ));
            server.finish();
        }
    });
}

#[test]
fn response_bound_midstream_cancellation_and_network_failure_are_typed() {
    run_async(async {
        let path = sibling_path().await;
        let client = OpenAiCompatibleClient::new().unwrap();

        let oversized_delta = "x".repeat(1024 * 1024 + 1);
        let oversized = TestServer::spawn(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            vec![sse(&format!(
                r#"{{"choices":[{{"index":0,"delta":{{"content":"{oversized_delta}"}},"finish_reason":"stop"}}]}}"#
            ))],
        );
        let endpoint =
            ValidatedEndpoint::parse(&oversized.endpoint, Protocol::OpenAiCompatible).unwrap();
        assert!(matches!(
            client
                .stream(
                    &endpoint,
                    &chat_prompt(&path, "model"),
                    None,
                    &CancellationToken::new(),
                    |_| Ok(())
                )
                .await,
            Err(LlmError::Protocol)
        ));
        oversized.finish();

        let cancelled_server = TestServer::spawn_with_delay(
            "200 OK",
            &[("Content-Type", "text/event-stream")],
            vec![
                sse(
                    r#"{"choices":[{"index":0,"delta":{"content":"first"},"finish_reason":null}]}"#,
                ),
                sse(
                    r#"{"choices":[{"index":0,"delta":{"content":"second"},"finish_reason":"stop"}]}"#,
                ),
                sse("[DONE]"),
            ],
            Duration::from_millis(50),
        );
        let endpoint =
            ValidatedEndpoint::parse(&cancelled_server.endpoint, Protocol::OpenAiCompatible)
                .unwrap();
        let cancellation = CancellationToken::new();
        let cancellation_from_delta = cancellation.clone();
        let result = client
            .stream(
                &endpoint,
                &chat_prompt(&path, "model"),
                None,
                &cancellation,
                |_| {
                    cancellation_from_delta.cancel();
                    Ok(())
                },
            )
            .await;
        assert!(matches!(result, Err(LlmError::Cancelled)));
        cancelled_server.finish();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let unavailable_endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let disconnect = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let endpoint =
            ValidatedEndpoint::parse(&unavailable_endpoint, Protocol::OpenAiCompatible).unwrap();
        let result = client
            .stream(
                &endpoint,
                &chat_prompt(&path, "model"),
                None,
                &CancellationToken::new(),
                |_| Ok(()),
            )
            .await;
        disconnect.join().unwrap();
        assert!(
            matches!(result, Err(LlmError::Network)),
            "unexpected transport result: {result:?}"
        );
    });
}
