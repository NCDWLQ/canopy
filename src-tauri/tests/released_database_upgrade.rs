//! Integration harness: upgrade a committed v0.4.0 SQLite fixture through the
//! production Tauri SQL plugin registration (preload + Migrator), not raw_sql.

use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use canopy_lib::infra::database::{managed_sqlite_pool, register_sql_plugin, MIGRATION_CATALOG};
use serde_json::json;
use sqlx::SqlitePool;
use tauri::Manager;
use tauri_plugin_sql::DbInstances;

const FIXTURE_RELATIVE: &str = "tests/fixtures/canopy-v0.4.0.db";
/// Documented in `tests/fixtures/README.md`; fails the suite if the binary drifts.
const FIXTURE_SHA256: &str = "0deeb7d62dd3b33710039ec608b9b592f482e74b66e1eabc530313024ffd8442";

/// Stable seed rows committed inside the v0.4.0 fixture (see fixtures/README.md).
const PROVIDER_ID: &str = "provider-fixture-a";
const CONVERSATION_BOUND_ID: &str = "conversation-bound";
const CONVERSATION_STALE_ID: &str = "conversation-stale-binding";
const ROOT_BOUND_ID: &str = "node-bound-root";
const CHILD_BOUND_ID: &str = "node-bound-assistant";
const ROOT_STALE_ID: &str = "node-stale-root";
const STALE_MODEL: &str = "stale-orphan-model";
const CREDENTIAL_REF: &str = "test-credential-ref-placeholder";

/// v0.4.0 / current catalog SQLx SHA-384 digests (see fixtures/README.md).
const EXPECTED_LEDGER_CHECKSUMS: &[(i64, &str)] = &[
    (
        1,
        "117677d64c216c159b21721a1bae58441c9c285f1cadb9b81174593ea259eba7fcadc15cf1b91fe2347bde0db4f0dc2e",
    ),
    (
        2,
        "dee9c8efdfe629592b314e78c05a5ae973850fb2a035c2b69ba3255331f5c55cad15308f53fb7204385881b3659640e2",
    ),
    (
        3,
        "2fbb1d19e683a21cfc6e3e6752c51ceacd3c5a44474822b5606c2f075298dc8721cf7a2a7f64dd2d481575870b6c4063",
    ),
    (
        4,
        "e739b4dd0771c817b43d94c33cc23bf837bbfceff64c3b7e86169a1d98de7e6153d81368097e0838b66fbf3a2984480a",
    ),
    (
        5,
        "1e27faf0f41d0ec9e136689dbc6508e21652fbe3ff1d00d8d1a8b469d860b442d4e49488e711781046b8a56c43965441",
    ),
    (
        6,
        "2636f46d47b58de534242c2e2b167b14577982f6c846b037de8fe7e02443d71c61e0b9070c7a8f2314770e76641f2b50",
    ),
];

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Restores `XDG_CONFIG_HOME` and deletes the unique workspace XDG root on drop
/// (success and failure paths).
struct WorkspaceXdgGuard {
    xdg_root: PathBuf,
    previous_xdg: Option<OsString>,
}

impl Drop for WorkspaceXdgGuard {
    fn drop(&mut self) {
        // SAFETY: integration-test process; restore prior env after path probing.
        unsafe {
            match &self.previous_xdg {
                Some(value) => env::set_var("XDG_CONFIG_HOME", value),
                None => env::remove_var("XDG_CONFIG_HOME"),
            }
        }
        if self.xdg_root.exists() {
            let _ = fs::remove_dir_all(&self.xdg_root);
        }
    }
}

fn unique_identifier() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock is after epoch")
        .as_nanos();
    let seq = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("app.canopy.released-db-upgrade.{nanos}.{seq}")
}

fn fixture_source_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_RELATIVE)
}

fn assert_fixture_sha256() {
    let digest = std::process::Command::new("sha256sum")
        .arg(fixture_source_path())
        .output()
        .expect("sha256sum runs for fixture integrity check");
    assert!(
        digest.status.success(),
        "sha256sum failed: {}",
        String::from_utf8_lossy(&digest.stderr)
    );
    let stdout = String::from_utf8_lossy(&digest.stdout);
    let actual = stdout
        .split_whitespace()
        .next()
        .expect("sha256sum prints a digest");
    assert_eq!(
        actual, FIXTURE_SHA256,
        "versioned fixture bytes must match fixtures/README.md SHA-256"
    );
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

fn probe_app_config_dir(identifier: &str) -> (PathBuf, WorkspaceXdgGuard) {
    // Keep harness paths inside the workspace so tests never touch ~/.config.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock is after epoch")
        .as_nanos();
    let xdg_config = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("canopy-upgrade-xdg-{nanos}"));
    fs::create_dir_all(&xdg_config).expect("workspace XDG_CONFIG_HOME is creatable");
    let previous_xdg = env::var_os("XDG_CONFIG_HOME");
    // SAFETY: integration-test process; dirs reads XDG_CONFIG_HOME for config_dir().
    unsafe {
        env::set_var("XDG_CONFIG_HOME", &xdg_config);
    }
    let guard = WorkspaceXdgGuard {
        xdg_root: xdg_config.clone(),
        previous_xdg,
    };

    let app = tauri::test::mock_builder()
        .build(sql_preload_context(identifier))
        .expect("probe app builds");
    let path = app
        .path()
        .app_config_dir()
        .expect("probe app-config directory resolves");
    drop(app);
    assert!(
        path.starts_with(&xdg_config),
        "upgrade harness must not escape workspace XDG_CONFIG_HOME"
    );
    (path, guard)
}

fn build_plugin_app(identifier: &str) -> tauri::App<tauri::test::MockRuntime> {
    register_sql_plugin(tauri::test::mock_builder())
        .build(sql_preload_context(identifier))
        .expect("SQL plugin app builds and migrates")
}

async fn close_managed_sqlite(instances: &DbInstances) {
    let pool = managed_sqlite_pool(instances)
        .await
        .expect("managed pool is present before close");
    pool.close().await;
}

fn instances_ref(app: &tauri::App<tauri::test::MockRuntime>) -> &DbInstances {
    app.state::<DbInstances>().inner()
}

async fn ledger_checksums(pool: &SqlitePool) -> Vec<(i64, Vec<u8>)> {
    sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool)
        .await
        .expect("migration ledger checksums are readable")
}

fn checksum_to_hex(checksum: &[u8]) -> String {
    checksum.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn assert_ledger_matches_released_checksums(checksums: &[(i64, Vec<u8>)]) {
    assert_eq!(
        checksums.len(),
        MIGRATION_CATALOG.len(),
        "ledger length must equal the current migration catalog (no missing/duplicate rows)"
    );
    assert!(
        checksums.len() >= EXPECTED_LEDGER_CHECKSUMS.len(),
        "current catalog must still include the released v0.4.0 migration set"
    );
    for ((version, checksum), (expected_version, expected_hex)) in
        checksums.iter().zip(EXPECTED_LEDGER_CHECKSUMS.iter())
    {
        assert_eq!(version, expected_version);
        assert_eq!(
            checksum_to_hex(checksum),
            *expected_hex,
            "ledger checksum for version {version} must match the released v0.4.0 SQL bytes"
        );
    }
    let catalog_versions: Vec<i64> = MIGRATION_CATALOG
        .iter()
        .map(|migration| migration.version)
        .collect();
    let ledger_versions: Vec<i64> = checksums.iter().map(|(version, _)| *version).collect();
    assert_eq!(
        ledger_versions, catalog_versions,
        "ledger must list every current catalog version exactly once"
    );
}

async fn assert_released_baseline(pool: &SqlitePool) {
    let checksums = ledger_checksums(pool).await;
    assert_ledger_matches_released_checksums(&checksums);

    let fk_violations: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .expect("foreign_key_check runs");
    assert!(
        fk_violations.is_empty(),
        "foreign_key_check must be empty, got {fk_violations:?}"
    );

    let provider: (String, String, String, Option<String>, String) = sqlx::query_as(
        "SELECT id, name, protocol, credential_ref, model FROM providers WHERE id = ?1",
    )
    .bind(PROVIDER_ID)
    .fetch_one(pool)
    .await
    .expect("fixture provider row exists");
    assert_eq!(
        provider,
        (
            PROVIDER_ID.to_owned(),
            "Fixture Provider".to_owned(),
            "openai_compatible".to_owned(),
            Some(CREDENTIAL_REF.to_owned()),
            "fixture-model".to_owned(),
        )
    );

    let active: String =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'active_provider_id'")
            .fetch_one(pool)
            .await
            .expect("active provider setting exists");
    assert_eq!(active, PROVIDER_ID);

    let language: String =
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'language'")
            .fetch_one(pool)
            .await
            .expect("language setting exists");
    assert_eq!(language, "zh-CN");

    let bound: (
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT provider_id, model, reasoning_effort, title, root_node_id \
         FROM conversations WHERE id = ?1",
    )
    .bind(CONVERSATION_BOUND_ID)
    .fetch_one(pool)
    .await
    .expect("bound conversation exists");
    assert_eq!(
        bound,
        (
            Some(PROVIDER_ID.to_owned()),
            Some("fixture-model".to_owned()),
            Some("medium".to_owned()),
            "Bound fixture tree".to_owned(),
            ROOT_BOUND_ID.to_owned(),
        )
    );

    let bound_nodes: Vec<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, parent_id, content FROM nodes \
         WHERE conversation_id = ?1 ORDER BY created_at, id",
    )
    .bind(CONVERSATION_BOUND_ID)
    .fetch_all(pool)
    .await
    .expect("bound nodes are readable");
    assert_eq!(
        bound_nodes,
        vec![
            (
                ROOT_BOUND_ID.to_owned(),
                None,
                "fixture user root".to_owned(),
            ),
            (
                CHILD_BOUND_ID.to_owned(),
                Some(ROOT_BOUND_ID.to_owned()),
                "fixture assistant reply".to_owned(),
            ),
        ]
    );

    // Migration 7 clears the v0.4.0 stale orphan model while preserving effort
    // and other conversation fields. Fixture seed used STALE_MODEL as the orphan.
    let stale: (
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
        i64,
    ) = sqlx::query_as(
        "SELECT provider_id, model, reasoning_effort, title, root_node_id, is_archived \
         FROM conversations WHERE id = ?1",
    )
    .bind(CONVERSATION_STALE_ID)
    .fetch_one(pool)
    .await
    .expect("stale-binding conversation exists");
    assert_eq!(
        stale,
        (
            None,
            None,
            Some("low".to_owned()),
            "stale binding baseline".to_owned(),
            ROOT_STALE_ID.to_owned(),
            0,
        )
    );
    let residual_orphan_models: i64 =
        sqlx::query_scalar("SELECT count(*) FROM conversations WHERE model = ?1")
            .bind(STALE_MODEL)
            .fetch_one(pool)
            .await
            .expect("orphan model scan runs");
    assert_eq!(
        residual_orphan_models, 0,
        "migration 7 must clear every fixture row that still held {STALE_MODEL}"
    );

    let stale_root: (Option<String>, String) = sqlx::query_as(
        "SELECT parent_id, content FROM nodes WHERE id = ?1 AND conversation_id = ?2",
    )
    .bind(ROOT_STALE_ID)
    .bind(CONVERSATION_STALE_ID)
    .fetch_one(pool)
    .await
    .expect("stale conversation root exists");
    assert_eq!(stale_root, (None, "stale binding root".to_owned()));

    let history_rejected = sqlx::query("UPDATE nodes SET content = 'mutated' WHERE id = ?1")
        .bind(ROOT_BOUND_ID)
        .execute(pool)
        .await;
    assert!(
        history_rejected.is_err(),
        "nodes_immutable_history must still abort content updates"
    );

    let delete_rejected = sqlx::query("DELETE FROM nodes WHERE id = ?1")
        .bind(CHILD_BOUND_ID)
        .execute(pool)
        .await;
    assert!(
        delete_rejected.is_err(),
        "nodes_reject_delete must still abort node deletes"
    );

    let archive_rejected = sqlx::query("UPDATE nodes SET is_archived = 1 WHERE id = ?1")
        .bind(CHILD_BOUND_ID)
        .execute(pool)
        .await;
    assert!(
        archive_rejected.is_err(),
        "node archive triggers must still abort archive flags"
    );
}

async fn assert_provider_delete_clears_binding_pair(pool: &SqlitePool) {
    sqlx::query("DELETE FROM providers WHERE id = ?1")
        .bind(PROVIDER_ID)
        .execute(pool)
        .await
        .expect("deleting the fixture provider succeeds");
    let unbound: (
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT provider_id, model, reasoning_effort, title, root_node_id \
         FROM conversations WHERE id = ?1",
    )
    .bind(CONVERSATION_BOUND_ID)
    .fetch_one(pool)
    .await
    .expect("bound conversation remains after provider delete");
    assert_eq!(
        unbound,
        (
            None,
            None,
            Some("medium".to_owned()),
            "Bound fixture tree".to_owned(),
            ROOT_BOUND_ID.to_owned(),
        )
    );
}

fn install_fixture_copy(app_config_dir: &Path) {
    fs::create_dir_all(app_config_dir).expect("unique app-config directory is creatable");
    let destination = app_config_dir.join("canopy.db");
    fs::copy(fixture_source_path(), &destination)
        .unwrap_or_else(|error| panic!("copy versioned fixture to {destination:?}: {error}"));
}

#[test]
fn released_v040_fixture_upgrades_through_production_sql_plugin() {
    assert_fixture_sha256();

    let identifier = unique_identifier();
    assert!(
        identifier.starts_with("app.canopy.released-db-upgrade."),
        "test identifier must be harness-scoped"
    );
    assert_ne!(identifier, "app.canopy.desktop");

    let (app_config_dir, xdg_guard) = probe_app_config_dir(&identifier);
    install_fixture_copy(&app_config_dir);
    let expected_db = app_config_dir.join("canopy.db");

    let first_checksums = {
        let app = build_plugin_app(&identifier);
        let instances = instances_ref(&app);
        let checksums = tauri::async_runtime::block_on(async {
            let pool = managed_sqlite_pool(instances)
                .await
                .expect("plugin-managed pool resolves after preload");
            let opened = pool.connect_options().get_filename().to_path_buf();
            assert_eq!(
                opened, expected_db,
                "plugin must open the copied canopy.db under the unique identifier"
            );
            assert_released_baseline(&pool).await;
            assert_provider_delete_clears_binding_pair(&pool).await;
            let checksums = ledger_checksums(&pool).await;
            close_managed_sqlite(instances).await;
            checksums
        });
        drop(app);
        checksums
    };

    let second_checksums = {
        let app = build_plugin_app(&identifier);
        let instances = instances_ref(&app);
        let checksums = tauri::async_runtime::block_on(async {
            let pool = managed_sqlite_pool(instances)
                .await
                .expect("plugin-managed pool resolves on restart");
            // Restart must not re-mutate already-repaired rows or the ledger.
            // Provider was deleted in the first pass; re-check ledger + FK only.
            let checksums = ledger_checksums(&pool).await;
            assert_ledger_matches_released_checksums(&checksums);
            let fk_violations: Vec<(String, i64, String, i64)> =
                sqlx::query_as("PRAGMA foreign_key_check")
                    .fetch_all(&pool)
                    .await
                    .expect("foreign_key_check runs on restart");
            assert!(fk_violations.is_empty());
            let repaired: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
                "SELECT provider_id, model, reasoning_effort FROM conversations WHERE id = ?1",
            )
            .bind(CONVERSATION_STALE_ID)
            .fetch_one(&pool)
            .await
            .expect("repaired stale conversation survives restart");
            assert_eq!(repaired, (None, None, Some("low".to_owned())));
            let unbound: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
                "SELECT provider_id, model, reasoning_effort FROM conversations WHERE id = ?1",
            )
            .bind(CONVERSATION_BOUND_ID)
            .fetch_one(&pool)
            .await
            .expect("unbound conversation survives restart");
            assert_eq!(unbound, (None, None, Some("medium".to_owned())));
            close_managed_sqlite(instances).await;
            checksums
        });
        drop(app);
        checksums
    };

    assert_eq!(
        first_checksums, second_checksums,
        "restart must be idempotent for the migration ledger"
    );

    // Drop the guard explicitly so cleanup assertions run in this scope.
    drop(xdg_guard);
    assert!(
        !app_config_dir.exists(),
        "unique test directory must be cleaned up"
    );
    assert!(
        fixture_source_path().is_file(),
        "versioned fixture must remain untouched"
    );
}
