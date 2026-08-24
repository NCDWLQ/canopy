pub mod conversations;
pub mod database;
pub mod error;
pub mod providers;

use database::{plugin_migrations, DATABASE_URL};

#[cfg(test)]
fn register_conversation_commands<R: tauri::Runtime>(
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
        conversations::commands::set_conversation_provider,
        conversations::commands::search_conversations,
        conversations::commands::write_export_file,
    ])
}

fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
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
        conversations::commands::set_conversation_provider,
        conversations::commands::search_conversations,
        conversations::commands::write_export_file,
        providers::commands::list_providers,
        providers::commands::save_provider,
        providers::commands::delete_provider,
        providers::commands::set_active_provider,
        providers::commands::set_auto_generate_title,
        providers::commands::set_title_model_binding,
        providers::commands::set_language,
        providers::commands::set_theme,
        providers::commands::reveal_provider_api_key,
        providers::commands::generate_from_active_path,
        providers::commands::cancel_generation,
        providers::commands::list_provider_models,
    ])
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    register_commands(tauri::Builder::default())
        .manage(providers::GenerationRuntime::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, plugin_migrations())
                .build(),
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
    use serde_json::json;
    use tauri::{
        ipc::{CallbackFn, InvokeResponseBody},
        test,
        webview::InvokeRequest,
        WebviewWindowBuilder,
    };
    use tauri_plugin_sql::DbInstances;

    use super::{app_builder, register_commands, register_conversation_commands};

    #[test]
    fn application_builder_is_constructible() {
        drop(app_builder());
    }

    #[test]
    fn all_conversation_commands_are_registered_for_mock_ipc() {
        let app = register_conversation_commands(test::mock_builder())
            .manage(DbInstances::default())
            .build(test::mock_context(test::noop_assets()))
            .expect("mock application builds");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview builds");
        let requests = [
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
            (
                "write_export_file",
                json!({ "request": { "path": "/tmp/canopy-export.md", "content": "# Content" } }),
            ),
        ];

        for (command, body) in requests {
            let response = test::get_ipc_response(
                &webview,
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
            .expect_err("missing managed database returns a command error");
            assert_eq!(
                response,
                json!({
                    "code": "database_unavailable",
                    "message": "会话数据库当前不可用。",
                    "retryable": true
                })
            );
        }
    }

    #[test]
    fn generation_cancel_command_is_registered_for_mock_ipc() {
        let app = register_commands(test::mock_builder())
            .manage(DbInstances::default())
            .manage(crate::providers::GenerationRuntime::default())
            .build(test::mock_context(test::noop_assets()))
            .expect("mock application builds");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview builds");
        let generation_id = "11111111-1111-4111-8111-111111111111";
        let requests = [(
            "cancel_generation",
            json!({ "request": { "generation_id": generation_id } }),
        )];

        for (command, body) in requests {
            let response = test::get_ipc_response(
                &webview,
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
            .expect("unknown generation returns a successful false result");
            let InvokeResponseBody::Json(response) = response else {
                panic!("generation control response must be JSON");
            };
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&response).unwrap(),
                json!({ "accepted": false })
            );
        }
    }

    #[test]
    fn set_language_command_is_registered_and_validates_before_database_access() {
        let app = register_commands(test::mock_builder())
            .manage(DbInstances::default())
            .manage(crate::providers::GenerationRuntime::default())
            .build(test::mock_context(test::noop_assets()))
            .expect("mock application builds");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview builds");
        let invoke = |body: serde_json::Value| {
            test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: "set_language".to_owned(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().expect("test URL is valid"),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: test::INVOKE_KEY.to_owned(),
                },
            )
        };

        let rejected = invoke(json!({ "request": { "language": "klingon" } }))
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
        let reaches_database = invoke(json!({ "request": { "language": "zh-CN" } }))
            .expect_err("valid language reaches database resolution");
        assert_eq!(
            reaches_database,
            json!({
                "code": "database_unavailable",
                "message": "会话数据库当前不可用。",
                "retryable": true
            })
        );
    }

    #[test]
    fn set_theme_command_is_registered_and_validates_before_database_access() {
        let app = register_commands(test::mock_builder())
            .manage(DbInstances::default())
            .manage(crate::providers::GenerationRuntime::default())
            .build(test::mock_context(test::noop_assets()))
            .expect("mock application builds");
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview builds");
        let invoke = |body: serde_json::Value| {
            test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: "set_theme".to_owned(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().expect("test URL is valid"),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: test::INVOKE_KEY.to_owned(),
                },
            )
        };

        let rejected = invoke(json!({ "request": { "theme": "solarized" } }))
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

        let reaches_database = invoke(json!({ "request": { "theme": "dark" } }))
            .expect_err("valid theme reaches database resolution");
        assert_eq!(
            reaches_database,
            json!({
                "code": "database_unavailable",
                "message": "会话数据库当前不可用。",
                "retryable": true
            })
        );
    }
}
