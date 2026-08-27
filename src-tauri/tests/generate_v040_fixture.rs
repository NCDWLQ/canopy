//! One-shot fixture generator. Run once with:
//! `CANOPY_WRITE_V040_FIXTURE=1 cargo test --manifest-path src-tauri/Cargo.toml \
//!   --test generate_v040_fixture -- --ignored --nocapture`
//! Default suite skips generation (`#[ignore]` + env guard).
//!
//! Uses a workspace-local `XDG_CONFIG_HOME` so generation never touches the
//! real user config directory.

mod support;

use std::{
    env, fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use canopy_lib::infra::database::{managed_sqlite_pool, register_sql_plugin};
use serde_json::json;
use sqlx::SqlitePool;
use support::run_async;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

const PROVIDER_ID: &str = "provider-fixture-a";
const CONVERSATION_BOUND_ID: &str = "conversation-bound";
const CONVERSATION_STALE_ID: &str = "conversation-stale-binding";
const ROOT_BOUND_ID: &str = "node-bound-root";
const CHILD_BOUND_ID: &str = "node-bound-assistant";
const ROOT_STALE_ID: &str = "node-stale-root";
const STALE_MODEL: &str = "stale-orphan-model";
const CREDENTIAL_REF: &str = "test-credential-ref-placeholder";

fn output_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/canopy-v0.4.0.db")
}

fn sql_preload_context(identifier: &str) -> tauri::Context<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = identifier.to_owned();
    context
        .config_mut()
        .plugins
        .0
        .insert("sql".to_owned(), json!({ "preload": ["sqlite:canopy.db"] }));
    context
}

async fn seed_fixture_rows(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO providers \
           (id, name, protocol, base_endpoint, model, credential_ref, created_at, updated_at, models) \
         VALUES (?1, 'Fixture Provider', 'openai_compatible', 'https://provider.example/v1', \
                 'fixture-model', ?2, 1700000000000, 1700000000000, json_array('fixture-model'))",
    )
    .bind(PROVIDER_ID)
    .bind(CREDENTIAL_REF)
    .execute(pool)
    .await
    .expect("provider seed");

    sqlx::query(
        "INSERT INTO app_settings (key, value) VALUES \
           ('active_provider_id', ?1), \
           ('language', 'zh-CN'), \
           ('theme', 'system')",
    )
    .bind(PROVIDER_ID)
    .execute(pool)
    .await
    .expect("settings seed");

    let mut tx = pool.begin().await.expect("seed transaction");
    sqlx::query(
        "INSERT INTO conversations \
           (id, title, root_node_id, is_archived, provider_id, model, reasoning_effort) \
         VALUES (?1, 'Bound fixture tree', ?2, 0, ?3, 'fixture-model', 'medium')",
    )
    .bind(CONVERSATION_BOUND_ID)
    .bind(ROOT_BOUND_ID)
    .bind(PROVIDER_ID)
    .execute(&mut *tx)
    .await
    .expect("bound conversation");
    sqlx::query(
        "INSERT INTO nodes \
           (id, parent_id, conversation_id, role, content, model, created_at, metadata) \
         VALUES (?1, NULL, ?2, 'user', 'fixture user root', NULL, 100, '{}')",
    )
    .bind(ROOT_BOUND_ID)
    .bind(CONVERSATION_BOUND_ID)
    .execute(&mut *tx)
    .await
    .expect("bound root");
    sqlx::query(
        "INSERT INTO nodes \
           (id, parent_id, conversation_id, role, content, model, created_at, metadata) \
         VALUES (?1, ?2, ?3, 'assistant', 'fixture assistant reply', 'fixture-model', 200, '{}')",
    )
    .bind(CHILD_BOUND_ID)
    .bind(ROOT_BOUND_ID)
    .bind(CONVERSATION_BOUND_ID)
    .execute(&mut *tx)
    .await
    .expect("bound child");

    sqlx::query(
        "INSERT INTO conversations \
           (id, title, root_node_id, is_archived, provider_id, model, reasoning_effort) \
         VALUES (?1, 'stale binding baseline', ?2, 0, NULL, ?3, 'low')",
    )
    .bind(CONVERSATION_STALE_ID)
    .bind(ROOT_STALE_ID)
    .bind(STALE_MODEL)
    .execute(&mut *tx)
    .await
    .expect("stale conversation");
    sqlx::query(
        "INSERT INTO nodes \
           (id, parent_id, conversation_id, role, content, model, created_at, metadata) \
         VALUES (?1, NULL, ?2, 'user', 'stale binding root', NULL, 300, '{}')",
    )
    .bind(ROOT_STALE_ID)
    .bind(CONVERSATION_STALE_ID)
    .execute(&mut *tx)
    .await
    .expect("stale root");
    tx.commit().await.expect("seed commit");

    let fk: Vec<(String,)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .expect("fk check");
    assert!(
        fk.is_empty(),
        "seeded fixture must have no FK violations: {fk:?}"
    );
}

#[test]
#[ignore = "set CANOPY_WRITE_V040_FIXTURE=1 and run with --ignored to regenerate"]
fn generate_v040_fixture_via_sql_plugin() {
    if env::var_os("CANOPY_WRITE_V040_FIXTURE").is_none() {
        panic!("refusing to regenerate without CANOPY_WRITE_V040_FIXTURE=1");
    }

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let identifier = format!("app.canopy.generate-v040-fixture.{nanos}");

    // Keep all plugin path resolution inside the workspace.
    let xdg_config = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("canopy-fixture-xdg-{nanos}"));
    fs::create_dir_all(&xdg_config).expect("workspace XDG_CONFIG_HOME is creatable");
    // SAFETY: test-only process; dirs crate reads this env for config_dir().
    unsafe {
        env::set_var("XDG_CONFIG_HOME", &xdg_config);
    }

    let probe = tauri::test::mock_builder()
        .build(sql_preload_context(&identifier))
        .expect("probe builds");
    let app_config_dir = probe
        .path()
        .app_config_dir()
        .expect("app-config dir resolves");
    drop(probe);

    assert!(
        app_config_dir.starts_with(&xdg_config),
        "generator must not escape workspace XDG_CONFIG_HOME"
    );
    fs::create_dir_all(&app_config_dir).expect("create generate dir");

    let app = register_sql_plugin(tauri::test::mock_builder())
        .build(sql_preload_context(&identifier))
        .expect("plugin creates migrated canopy.db");
    let db_path = app_config_dir.join("canopy.db");
    assert!(db_path.is_file(), "plugin must create {db_path:?}");

    run_async(async {
        let pool = managed_sqlite_pool(app.state::<DbInstances>().inner())
            .await
            .expect("managed pool");
        seed_fixture_rows(&pool).await;
        pool.close().await;
    });
    drop(app);

    let destination = output_path();
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).expect("fixtures dir");
    }
    fs::copy(&db_path, &destination)
        .unwrap_or_else(|error| panic!("copy generated fixture to {destination:?}: {error}"));
    fs::remove_dir_all(&xdg_config).expect("cleanup workspace XDG_CONFIG_HOME");

    let digest = Command::new("sha256sum")
        .arg(&destination)
        .output()
        .expect("sha256sum runs");
    eprintln!("wrote {}", destination.display());
    eprint!("{}", String::from_utf8_lossy(&digest.stdout));
}
