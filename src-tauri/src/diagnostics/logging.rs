use std::future::Future;
use std::path::PathBuf;

use log::{Level, LevelFilter, Log};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{
    attach_logger, Builder, FileOpenStrategy, RotationStrategy, Target, TargetKind,
    TimezoneStrategy,
};
use uuid::Uuid;

use crate::error::{CommandError, CommandErrorCode};
use crate::identifiers::is_canonical_uuid_v4;

use super::config::{
    load_startup_policy, ActiveLoggingState, ConfigStatus, LoggingPolicy, LoggingSaveLock,
    SinkStatus, LOG_FILE_NAME,
};

const CANOPY_LIB_TARGET: &str = "canopy_lib";
const CANOPY_BIN_TARGET: &str = "canopy";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticId(String);

impl DiagnosticId {
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid.to_string())
    }

    pub fn parse(value: &str) -> Option<Self> {
        is_canonical_uuid_v4(value).then(|| Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone)]
enum FieldValue {
    Static(&'static str),
    Token(String),
    Id(DiagnosticId),
    U64(u64),
    Bool(bool),
}

type SplitResult = Result<(LevelFilter, Box<dyn Log>), tauri_plugin_log::Error>;

pub fn diagnostics_bootstrap_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("diagnostics")
        .setup(|app, _api| {
            bootstrap_logging(app);
            Ok(())
        })
        .build()
}

fn bootstrap_logging<R: Runtime>(app: &AppHandle<R>) {
    let recovered = load_startup_policy(app);
    let invalid_config = recovered.status == ConfigStatus::InvalidFallback;
    let sink_status = install_production_logger(app, recovered.policy);
    app.manage(ActiveLoggingState {
        policy: recovered.policy,
        sink_status,
    });
    app.manage(LoggingSaveLock::new());
    if sink_status != SinkStatus::Disabled {
        if invalid_config {
            record_lifecycle("initialize_logging", "config_fallback", None);
        }
        record_lifecycle("initialize_logging", "ready", None);
    }
}

fn install_production_logger<R: Runtime>(app: &AppHandle<R>, policy: LoggingPolicy) -> SinkStatus {
    install_logger(
        || split_builder(persistent_builder(policy, None), app),
        || split_builder(console_only_builder(), app),
        |level, logger| attach_logger(level, logger).map_err(|_| ()),
    )
}

pub(crate) fn install_logger(
    persistent: impl FnOnce() -> SplitResult,
    console: impl FnOnce() -> SplitResult,
    attach: impl FnOnce(LevelFilter, Box<dyn Log>) -> Result<(), ()>,
) -> SinkStatus {
    if let Ok((level, logger)) = persistent() {
        return match attach(level, logger) {
            Ok(()) => SinkStatus::Persistent,
            Err(()) => SinkStatus::Disabled,
        };
    }
    if let Ok((level, logger)) = console() {
        return match attach(level, logger) {
            Ok(()) => SinkStatus::ConsoleFallback,
            Err(()) => SinkStatus::Disabled,
        };
    }
    SinkStatus::Disabled
}

fn split_builder<R: Runtime>(builder: Builder, app: &AppHandle<R>) -> SplitResult {
    builder
        .split(app)
        .map(|(_plugin, level, logger)| (level, logger))
}

pub(crate) fn persistent_builder(policy: LoggingPolicy, folder: Option<PathBuf>) -> Builder {
    let file_target = match folder {
        Some(path) => TargetKind::Folder {
            path,
            file_name: Some(LOG_FILE_NAME.to_owned()),
        },
        None => TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_owned()),
        },
    };
    let mut targets = vec![filtered_target(file_target)];
    if cfg!(debug_assertions) {
        targets.push(filtered_target(TargetKind::Stdout));
    }
    configure_builder(Builder::new(), policy, targets, build_level())
}

pub(crate) fn console_only_builder() -> Builder {
    let kind = if cfg!(debug_assertions) {
        TargetKind::Stdout
    } else {
        TargetKind::Stderr
    };
    let level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Warn
    };
    configure_builder(
        Builder::new(),
        LoggingPolicy::DEFAULT,
        vec![filtered_target(kind)],
        level,
    )
}

#[cfg(test)]
pub(crate) fn folder_builder(
    max_file_bytes: u128,
    max_files: u32,
    folder: PathBuf,
    level: LevelFilter,
) -> Builder {
    let policy = LoggingPolicy {
        max_file_mib: 1,
        max_files,
    };
    let targets = vec![filtered_target(TargetKind::Folder {
        path: folder,
        file_name: Some(LOG_FILE_NAME.to_owned()),
    })];
    configure_builder(Builder::new(), policy, targets, level).max_file_size(max_file_bytes)
}

fn configure_builder(
    builder: Builder,
    policy: LoggingPolicy,
    targets: Vec<Target>,
    level: LevelFilter,
) -> Builder {
    builder
        .max_file_size(u128::from(policy.max_file_bytes()))
        .rotation_strategy(rotation_strategy(policy))
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .file_open_strategy(FileOpenStrategy::Append)
        .level(level)
        .filter(|metadata| is_canopy_owned_target(metadata.target()))
        .targets(targets)
}

pub(crate) fn rotation_strategy(policy: LoggingPolicy) -> RotationStrategy {
    match policy.rotation_keep_archives() {
        None => RotationStrategy::KeepOne,
        Some(archives) => RotationStrategy::KeepSome(archives),
    }
}

fn build_level() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

fn filtered_target(kind: TargetKind) -> Target {
    Target::new(kind).filter(|metadata| is_canopy_owned_target(metadata.target()))
}

pub(crate) fn is_canopy_owned_target(target: &str) -> bool {
    target == CANOPY_LIB_TARGET
        || target.starts_with("canopy_lib::")
        || target == CANOPY_BIN_TARGET
        || target.starts_with("canopy::")
}

pub fn record_command_failure(
    operation: &'static str,
    error: &CommandError,
    correlation: Option<DiagnosticId>,
) {
    let Some(level) = command_failure_level(error.code) else {
        return;
    };
    emit_line(
        level,
        &format_command_failure(operation, error, correlation),
    );
}

pub(crate) fn format_command_failure(
    operation: &'static str,
    error: &CommandError,
    correlation: Option<DiagnosticId>,
) -> String {
    let mut fields = vec![("retryable", FieldValue::Bool(error.retryable))];
    if let Some(id) = correlation {
        fields.push(("id", FieldValue::Id(id)));
    }
    format_event(operation, error.code.as_str(), &fields)
}

pub fn record_lifecycle(
    operation: &'static str,
    code: &'static str,
    correlation: Option<DiagnosticId>,
) {
    let mut fields = Vec::new();
    if code == "config_fallback" {
        fields.push(("reason", FieldValue::Static("invalid")));
    }
    if let Some(id) = correlation {
        fields.push(("id", FieldValue::Id(id)));
    }
    emit(lifecycle_level(code), operation, code, &fields);
}

pub fn record_generation(
    operation: &'static str,
    code: &'static str,
    generation_id: DiagnosticId,
    duration_ms: Option<u64>,
) {
    let mut fields = vec![("generation_id", FieldValue::Id(generation_id))];
    if let Some(duration_ms) = duration_ms {
        fields.push(("duration_ms", FieldValue::U64(duration_ms)));
    }
    emit(generation_level(code), operation, code, &fields);
}

pub fn record_startup_failure(error: &tauri::Error) {
    emit_line(Level::Error, &format_startup_failure(error));
}

pub(crate) fn format_startup_failure(error: &tauri::Error) -> String {
    match error {
        tauri::Error::PluginInitialization(plugin, _message) => format_event(
            "run_application",
            "plugin_initialization",
            &[("plugin", FieldValue::Token(sanitize_plugin_name(plugin)))],
        ),
        _ => format_event("run_application", "startup_failed", &[]),
    }
}

fn command_failure_level(code: CommandErrorCode) -> Option<Level> {
    match code {
        CommandErrorCode::InvalidInput
        | CommandErrorCode::NotFound
        | CommandErrorCode::Cancelled => None,
        CommandErrorCode::DatabaseUnavailable
        | CommandErrorCode::ProviderAuthentication
        | CommandErrorCode::RateLimited
        | CommandErrorCode::ProviderUnavailable
        | CommandErrorCode::NetworkFailure => Some(Level::Warn),
        CommandErrorCode::TreeIntegrity
        | CommandErrorCode::MigrationFailure
        | CommandErrorCode::Internal => Some(Level::Error),
    }
}

fn lifecycle_level(code: &str) -> Level {
    match code {
        "title_generation_skipped" | "config_fallback" => Level::Warn,
        "plugin_initialization" | "startup_failed" => Level::Error,
        _ => Level::Info,
    }
}

fn generation_level(code: &str) -> Level {
    match code {
        "generation_failed" => Level::Warn,
        "persistence_failed" => Level::Error,
        _ => Level::Info,
    }
}

fn emit(
    level: Level,
    operation: &'static str,
    code: &'static str,
    fields: &[(&'static str, FieldValue)],
) {
    emit_line(level, &format_event(operation, code, fields));
}

fn emit_line(level: Level, message: &str) {
    match level {
        Level::Error => log::error!("{message}"),
        Level::Warn => log::warn!("{message}"),
        Level::Info => log::info!("{message}"),
        Level::Debug => log::debug!("{message}"),
        Level::Trace => log::trace!("{message}"),
    }
}

fn format_event(
    operation: &'static str,
    code: &'static str,
    fields: &[(&'static str, FieldValue)],
) -> String {
    let mut line = format!("operation={operation} code={code}");
    for (key, value) in fields {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        match value {
            FieldValue::Static(value) => line.push_str(value),
            FieldValue::Token(value) => line.push_str(value),
            FieldValue::Id(value) => line.push_str(value.as_str()),
            FieldValue::U64(value) => line.push_str(&value.to_string()),
            FieldValue::Bool(value) => line.push_str(if *value { "true" } else { "false" }),
        }
    }
    line
}

pub(crate) fn sanitize_plugin_name(name: &str) -> String {
    if is_safe_plugin_name(name) {
        name.to_owned()
    } else {
        "unknown".to_owned()
    }
}

fn is_safe_plugin_name(name: &str) -> bool {
    let len = name.len();
    (1..=64).contains(&len)
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub(crate) fn command_result<T>(
    operation: &'static str,
    result: Result<T, CommandError>,
    correlation: Option<DiagnosticId>,
) -> Result<T, CommandError> {
    if let Err(error) = &result {
        record_command_failure(operation, error, correlation.clone());
    }
    result
}

pub(crate) async fn log_command<T>(
    operation: &'static str,
    success_code: Option<&'static str>,
    correlation: Option<DiagnosticId>,
    fut: impl Future<Output = Result<T, CommandError>>,
) -> Result<T, CommandError> {
    let result = fut.await;
    if result.is_ok() {
        if let Some(code) = success_code {
            record_lifecycle(operation, code, correlation.clone());
        }
    }
    command_result(operation, result, correlation)
}

#[cfg(test)]
mod tests {
    use super::{
        command_failure_level, format_command_failure, format_event, format_startup_failure,
        install_logger, is_canopy_owned_target, rotation_strategy, sanitize_plugin_name,
        DiagnosticId, FieldValue,
    };
    use crate::diagnostics::config::{LoggingPolicy, SinkStatus};
    use crate::error::{CommandError, CommandErrorCode};
    use log::{Level, LevelFilter, Log, Metadata, Record};
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tauri_plugin_log::RotationStrategy;

    const SECRET: &str = "sk-SECRET_SENTINEL";
    const PROMPT: &str = "PROMPT_SENTINEL please ignore";
    const PATH: &str = "/home/user/.local/share/canopy/canopy.db";
    const BODY: &str = "PROVIDER_BODY_SENTINEL";
    const NEWLINE: &str = "line1\nline2\rinjected";

    struct NoopLog;

    impl Log for NoopLog {
        fn enabled(&self, _metadata: &Metadata) -> bool {
            false
        }

        fn log(&self, _record: &Record) {}

        fn flush(&self) {}
    }

    #[test]
    fn canopy_targets_are_accepted_and_dependencies_rejected() {
        assert!(is_canopy_owned_target("canopy_lib"));
        assert!(is_canopy_owned_target("canopy_lib::diagnostics::logging"));
        assert!(is_canopy_owned_target("canopy"));
        assert!(is_canopy_owned_target("canopy::main"));
        assert!(!is_canopy_owned_target("sqlx::query"));
        assert!(!is_canopy_owned_target("tauri_plugin_sql"));
        assert!(!is_canopy_owned_target("canopy_lib_extra"));
        assert!(!is_canopy_owned_target("webview"));
    }

    #[test]
    fn rotation_mapping_never_constructs_keep_some_zero() {
        assert!(matches!(
            rotation_strategy(LoggingPolicy {
                max_file_mib: 5,
                max_files: 1
            }),
            RotationStrategy::KeepOne
        ));
        assert!(matches!(
            rotation_strategy(LoggingPolicy::DEFAULT),
            RotationStrategy::KeepSome(4)
        ));
        assert!(matches!(
            rotation_strategy(LoggingPolicy {
                max_file_mib: 5,
                max_files: 2
            }),
            RotationStrategy::KeepSome(1)
        ));
    }

    #[test]
    fn command_failure_severity_skips_expected_input() {
        assert_eq!(command_failure_level(CommandErrorCode::InvalidInput), None);
        assert_eq!(command_failure_level(CommandErrorCode::NotFound), None);
        assert_eq!(command_failure_level(CommandErrorCode::Cancelled), None);
        assert_eq!(
            command_failure_level(CommandErrorCode::DatabaseUnavailable),
            Some(Level::Warn)
        );
        assert_eq!(
            command_failure_level(CommandErrorCode::Internal),
            Some(Level::Error)
        );
        assert_eq!(
            command_failure_level(CommandErrorCode::TreeIntegrity),
            Some(Level::Error)
        );
    }

    #[test]
    fn formatted_events_are_single_line_and_omit_command_error_payloads() {
        let error = CommandError {
            code: CommandErrorCode::Internal,
            message: format!("{SECRET} {PROMPT} {PATH} {BODY} {NEWLINE}"),
            retryable: false,
            details: Some(json!({
                "prompt": PROMPT,
                "response_body": BODY,
                "database_url": PATH,
                "api_key": SECRET
            })),
        };
        let line = format_command_failure("create_conversation", &error, None);
        assert_eq!(
            line,
            "operation=create_conversation code=internal retryable=false"
        );
        assert!(!line.contains('\n'));
        assert!(!line.contains('\r'));
        for sentinel in [SECRET, PROMPT, PATH, BODY, "line2", error.message.as_str()] {
            assert!(!line.contains(sentinel));
        }
        assert!(!line.contains("details"));
        assert!(!line.contains("message="));
        let with_id = format_command_failure(
            "save_provider",
            &error,
            DiagnosticId::parse("11111111-1111-4111-8111-111111111111"),
        );
        assert_eq!(
            with_id,
            "operation=save_provider code=internal retryable=false id=11111111-1111-4111-8111-111111111111"
        );
        assert!(!with_id.contains(SECRET));
    }

    #[test]
    fn every_level_formatter_keeps_a_single_safe_line() {
        let event = format_event(
            "generate_from_active_path",
            "completed",
            &[
                (
                    "generation_id",
                    FieldValue::Id(
                        DiagnosticId::parse("11111111-1111-4111-8111-111111111111").unwrap(),
                    ),
                ),
                ("duration_ms", FieldValue::U64(12)),
            ],
        );
        for level in [
            Level::Error,
            Level::Warn,
            Level::Info,
            Level::Debug,
            Level::Trace,
        ] {
            let formatted = format!("[{level}] {event}");
            assert_eq!(formatted.lines().count(), 1);
            assert!(!formatted.contains(SECRET));
            assert!(!formatted.contains('\n'));
        }
    }

    #[test]
    fn newline_plugin_names_are_replaced() {
        assert_eq!(sanitize_plugin_name("sql"), "sql");
        assert_eq!(sanitize_plugin_name("sql\nforged"), "unknown");
        assert_eq!(sanitize_plugin_name(""), "unknown");
        assert_eq!(sanitize_plugin_name("a".repeat(65).as_str()), "unknown");
    }

    #[test]
    fn startup_failure_classifies_plugin_without_source_message() {
        let error =
            tauri::Error::PluginInitialization("sql".into(), format!("failed to open {PATH}"));
        let line = format_startup_failure(&error);
        assert_eq!(
            line,
            "operation=run_application code=plugin_initialization plugin=sql"
        );
        assert!(!line.contains(PATH));
        let forged = tauri::Error::PluginInitialization("sql\nforged".into(), PATH.into());
        assert_eq!(
            format_startup_failure(&forged),
            "operation=run_application code=plugin_initialization plugin=unknown"
        );
        let other = tauri::Error::AssetNotFound(PATH.to_owned());
        assert_eq!(
            format_startup_failure(&other),
            "operation=run_application code=startup_failed"
        );
        assert!(!format_startup_failure(&other).contains(PATH));
    }

    #[test]
    fn fallback_order_is_persistent_then_console_then_disabled() {
        let attempts = Arc::new(Mutex::new(Vec::new()));
        let status = install_logger(
            {
                let attempts = Arc::clone(&attempts);
                move || {
                    attempts.lock().unwrap().push("persistent");
                    Err(std::io::Error::other("persistent").into())
                }
            },
            {
                let attempts = Arc::clone(&attempts);
                move || {
                    attempts.lock().unwrap().push("console");
                    Ok((LevelFilter::Info, Box::new(NoopLog)))
                }
            },
            |_, _| {
                attempts.lock().unwrap().push("attach");
                Ok(())
            },
        );
        assert_eq!(status, SinkStatus::ConsoleFallback);
        assert_eq!(
            attempts.lock().unwrap().as_slice(),
            ["persistent", "console", "attach"]
        );

        let status = install_logger(
            || Err(std::io::Error::other("persistent").into()),
            || Err(std::io::Error::other("console").into()),
            |_, _| panic!("attach must not run"),
        );
        assert_eq!(status, SinkStatus::Disabled);

        let status = install_logger(
            || Ok((LevelFilter::Info, Box::new(NoopLog))),
            || panic!("console must not run after persistent split"),
            |_, _| Err(()),
        );
        assert_eq!(status, SinkStatus::Disabled);
    }

    #[test]
    fn diagnostic_id_rejects_unvalidated_strings() {
        assert!(DiagnosticId::parse("11111111-1111-4111-8111-111111111111").is_some());
        assert!(DiagnosticId::parse("not-a-uuid").is_none());
        assert!(DiagnosticId::parse("11111111-1111-4111-8111-111111111111\n").is_none());
    }

    #[test]
    fn boxed_logger_writes_canopy_events_and_drops_dependency_targets() {
        let dir = std::env::temp_dir().join(format!("canopy-log-box-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds");
        let builder = super::folder_builder(1024, 2, dir.clone(), LevelFilter::Trace);
        let (_plugin, _level, logger) = builder.split(app.handle()).expect("split logger");
        logger.log(
            &Record::builder()
                .args(format_args!("operation=initialize_logging code=ready"))
                .level(Level::Info)
                .target("canopy_lib::diagnostics::logging")
                .build(),
        );
        logger.log(
            &Record::builder()
                .args(format_args!("sqlx should not persist"))
                .level(Level::Info)
                .target("sqlx::query")
                .build(),
        );
        logger.flush();
        drop(logger);
        let contents = std::fs::read_to_string(dir.join("canopy.log")).expect("log file");
        assert!(contents.contains("operation=initialize_logging code=ready"));
        assert!(!contents.contains("sqlx should not persist"));
        assert_eq!(contents.lines().count(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn boxed_logger_rotates_within_the_configured_file_budget() {
        let dir = std::env::temp_dir().join(format!("canopy-log-rot-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app builds");
        let builder = super::folder_builder(256, 2, dir.clone(), LevelFilter::Info);
        let (_plugin, _level, logger) = builder.split(app.handle()).expect("split logger");
        for index in 0..8 {
            logger.log(
                &Record::builder()
                    .args(format_args!(
                        "operation=rotate_probe code=ready n={index:03} {}",
                        "x".repeat(200)
                    ))
                    .level(Level::Info)
                    .target("canopy_lib::diagnostics::logging")
                    .build(),
            );
            logger.flush();
        }
        drop(logger);
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| {
                let name = entry.ok()?.file_name().to_string_lossy().into_owned();
                name.starts_with("canopy").then_some(name)
            })
            .collect();
        names.sort();
        assert!(
            names.iter().any(|name| name == "canopy.log"),
            "expected an active log file, got {names:?}"
        );
        assert!(
            names.iter().any(|name| name != "canopy.log"),
            "expected a rotated archive within the budget, got {names:?}"
        );
        assert!(
            names.len() <= 2,
            "retention budget is 2 files, found {names:?}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
