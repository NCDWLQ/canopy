pub mod conversations;
pub mod database;
pub mod error;

use database::{plugin_migrations, DATABASE_URL};

fn register_conversation_commands<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        conversations::commands::create_conversation,
        conversations::commands::append_node,
        conversations::commands::create_branch,
        conversations::commands::edit_node_as_branch,
        conversations::commands::load_conversation_tree,
        conversations::commands::load_active_path,
        conversations::commands::archive_conversation,
    ])
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    register_conversation_commands(tauri::Builder::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, plugin_migrations())
                .build(),
        )
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
    use tauri::{ipc::CallbackFn, test, webview::InvokeRequest, WebviewWindowBuilder};
    use tauri_plugin_sql::DbInstances;

    use super::{app_builder, register_conversation_commands};

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
                    "message": "The conversation database is currently unavailable.",
                    "retryable": true
                })
            );
        }
    }
}
