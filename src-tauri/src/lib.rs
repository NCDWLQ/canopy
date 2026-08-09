use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:canopy.db";

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let migrations = vec![Migration {
        version: 1,
        description: "bootstrap",
        sql: include_str!("../migrations/0001_bootstrap.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations)
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
    use super::app_builder;

    #[test]
    fn application_builder_is_constructible() {
        drop(app_builder());
    }
}
