pub mod conversations;
pub mod error;
pub mod exports;
pub mod generation;
pub mod infra;
pub mod llm;
pub mod providers;
pub mod settings;

use infra::database::register_sql_plugin;

pub(crate) fn register_commands<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        conversations::commands::create_conversation,
        conversations::commands::append_node,
        conversations::commands::create_branch,
        conversations::commands::edit_node_as_branch,
        conversations::commands::list_conversations,
        conversations::commands::load_conversation_tree,
        conversations::commands::load_active_path,
        conversations::commands::archive_conversation,
        conversations::commands::rename_conversation,
        conversations::commands::delete_conversation,
        conversations::commands::unarchive_conversation,
        generation::commands::set_conversation_provider,
        conversations::commands::search_conversations,
        exports::commands::write_export_file,
        providers::commands::list_providers,
        providers::commands::save_provider,
        providers::commands::delete_provider,
        providers::commands::set_active_provider,
        settings::commands::set_auto_generate_title,
        providers::commands::set_title_model_binding,
        settings::commands::set_language,
        settings::commands::set_theme,
        providers::commands::reveal_provider_api_key,
        generation::commands::generate_from_active_path,
        generation::commands::cancel_generation,
        providers::commands::list_provider_models,
    ])
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    register_sql_plugin(
        register_commands(tauri::Builder::default())
            .manage(generation::GenerationRuntime::default()),
    )
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
        if cfg!(debug_assertions) {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
        }
        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app_builder()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use tauri::{
        ipc::{CallbackFn, InvokeResponseBody},
        test,
        webview::{InvokeRequest, WebviewWindow},
        WebviewWindowBuilder,
    };
    use tauri_plugin_sql::DbInstances;

    use super::{app_builder, register_commands};

    fn database_unavailable() -> Value {
        json!({
            "code": "database_unavailable",
            "message": "对话数据库当前不可用。",
            "retryable": true
        })
    }

    fn mock_production_app() -> (
        tauri::App<tauri::test::MockRuntime>,
        WebviewWindow<tauri::test::MockRuntime>,
    ) {
        let app = register_commands(test::mock_builder())
            .manage(DbInstances::default())
            .manage(crate::generation::GenerationRuntime::default())
            .build(test::mock_context(test::noop_assets()))
            .expect("mock application builds");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview builds");
        (app, webview)
    }

    fn invoke(
        webview: &WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        body: Value,
    ) -> Result<InvokeResponseBody, Value> {
        test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: command.to_owned(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("test URL is valid"),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: test::INVOKE_KEY.to_owned(),
            },
        )
    }

    #[test]
    fn application_builder_is_constructible() {
        drop(app_builder());
    }

    #[test]
    fn all_production_commands_are_registered_for_mock_ipc() {
        let (_app, webview) = mock_production_app();
        // `generate_from_active_path` requires Tauri's Channel argument
        // (`onEvent` / `on_event`). A `__CHANNEL__:id` string is enough to
        // deserialize the handler argument; the command then fails at managed
        // database resolution, which is distinct from an unknown command.
        let database_backed = [
            (
                "create_conversation",
                json!({ "request": { "title": "Title", "content": "Content" } }),
            ),
            (
                "append_node",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "parent_node_id": "parent",
                    "content": "Content"
                } }),
            ),
            (
                "create_branch",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "parent_node_id": "parent",
                    "content": "Content"
                } }),
            ),
            (
                "edit_node_as_branch",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "source_node_id": "source",
                    "content": "Content"
                } }),
            ),
            ("list_conversations", json!({ "request": {} })),
            (
                "load_conversation_tree",
                json!({ "request": { "conversation_id": "conversation" } }),
            ),
            (
                "load_active_path",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "active_node_id": "active"
                } }),
            ),
            (
                "archive_conversation",
                json!({ "request": { "conversation_id": "conversation" } }),
            ),
            (
                "rename_conversation",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "title": "Renamed title"
                } }),
            ),
            (
                "delete_conversation",
                json!({ "request": { "conversation_id": "conversation" } }),
            ),
            (
                "unarchive_conversation",
                json!({ "request": { "conversation_id": "conversation" } }),
            ),
            (
                "set_conversation_provider",
                json!({ "request": {
                    "conversation_id": "conversation",
                    "binding": null,
                    "reasoning_effort": null
                } }),
            ),
            (
                "search_conversations",
                json!({ "request": { "query": "content" } }),
            ),
            ("list_providers", json!({ "request": {} })),
            (
                "save_provider",
                json!({ "request": {
                    "name": "Fixture provider",
                    "protocol": "openai_compatible",
                    "base_endpoint": "https://provider.example/v1",
                    "model": "fixture-model",
                    "models": ["fixture-model"],
                    "api_key": { "action": "keep" }
                } }),
            ),
            (
                "delete_provider",
                json!({ "request": { "provider_id": "provider" } }),
            ),
            (
                "set_active_provider",
                json!({ "request": { "provider_id": "provider" } }),
            ),
            (
                "set_auto_generate_title",
                json!({ "request": { "enabled": true } }),
            ),
            (
                "set_title_model_binding",
                json!({ "request": { "binding": null } }),
            ),
            (
                "set_language",
                json!({ "request": { "language": "zh-CN" } }),
            ),
            ("set_theme", json!({ "request": { "theme": "dark" } })),
            (
                "reveal_provider_api_key",
                json!({ "request": { "provider_id": "provider" } }),
            ),
            (
                "list_provider_models",
                json!({ "request": {
                    "source": { "type": "saved", "provider_id": "provider" }
                } }),
            ),
            (
                "generate_from_active_path",
                json!({
                    "request": {
                        "conversation_id": "conversation",
                        "active_node_id": "active"
                    },
                    "onEvent": "__CHANNEL__:0"
                }),
            ),
        ];
        assert_eq!(database_backed.len(), 24);

        for (command, body) in database_backed {
            let response = invoke(&webview, command, body).unwrap_err();
            assert_eq!(
                response,
                database_unavailable(),
                "{command} must reach managed database resolution"
            );
        }

        let cancel = invoke(
            &webview,
            "cancel_generation",
            json!({ "request": {
                "generation_id": "11111111-1111-4111-8111-111111111111"
            } }),
        )
        .expect("unknown generation returns a successful false result");
        let InvokeResponseBody::Json(response) = cancel else {
            panic!("generation control response must be JSON");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&response).unwrap(),
            json!({ "accepted": false })
        );

        let unknown = invoke(
            &webview,
            "not_a_registered_command",
            json!({ "request": {} }),
        )
        .expect_err("unknown commands are rejected");
        assert_ne!(
            unknown,
            database_unavailable(),
            "an unknown command must not look like a registered database-backed handler"
        );
    }

    #[test]
    fn write_export_file_succeeds_without_managed_database() {
        let (_app, webview) = mock_production_app();
        let path = std::env::temp_dir().join(format!(
            "canopy-export-registry-{}.md",
            uuid::Uuid::new_v4()
        ));
        let path_str = path.to_string_lossy().into_owned();
        let content = "# Content";

        let response = invoke(
            &webview,
            "write_export_file",
            json!({ "request": { "path": path_str, "content": content } }),
        )
        .expect("export must succeed without a managed SQLite pool");
        let InvokeResponseBody::Json(body) = response else {
            panic!("export response must be JSON");
        };
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap(),
            json!({ "bytes_written": content.len() as u64 })
        );
        let stored = std::fs::read_to_string(&path).expect("exported file is readable");
        assert_eq!(stored, content);
        std::fs::remove_file(&path).expect("exported file is removed");
    }

    #[test]
    fn set_language_command_is_registered_and_validates_before_database_access() {
        let (_app, webview) = mock_production_app();
        let rejected = invoke(
            &webview,
            "set_language",
            json!({ "request": { "language": "klingon" } }),
        )
        .expect_err("unknown language is rejected as invalid input");
        assert_eq!(
            rejected,
            json!({
                "code": "invalid_input",
                "message": "请求包含无效输入。",
                "retryable": false,
                "details": { "field": "language", "reason": "invalid_language" }
            })
        );

        // A valid value passes DTO validation; without a managed database the
        // registered command fails closed exactly like every other
        // database-backed command.
        let reaches_database = invoke(
            &webview,
            "set_language",
            json!({ "request": { "language": "zh-CN" } }),
        )
        .expect_err("valid language reaches database resolution");
        assert_eq!(reaches_database, database_unavailable());
    }

    #[test]
    fn set_theme_command_is_registered_and_validates_before_database_access() {
        let (_app, webview) = mock_production_app();
        let rejected = invoke(
            &webview,
            "set_theme",
            json!({ "request": { "theme": "solarized" } }),
        )
        .expect_err("unknown theme is rejected as invalid input");
        assert_eq!(
            rejected,
            json!({
                "code": "invalid_input",
                "message": "请求包含无效输入。",
                "retryable": false,
                "details": { "field": "theme", "reason": "invalid_theme" }
            })
        );

        let reaches_database = invoke(
            &webview,
            "set_theme",
            json!({ "request": { "theme": "dark" } }),
        )
        .expect_err("valid theme reaches database resolution");
        assert_eq!(reaches_database, database_unavailable());
    }
}
