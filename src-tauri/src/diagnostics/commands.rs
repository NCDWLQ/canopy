use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_opener::OpenerExt;

use super::config::{
    config_dir, read_recovered_config, save_policy, ActiveLoggingState, ConfigStatus,
    LoggingLimits, LoggingPolicy, LoggingSaveLock, PolicyValidation, SinkStatus,
};
use super::logging::{command_result, record_lifecycle};
use crate::error::{CommandError, CommandErrorCode};

pub const DIAGNOSTICS_COMMAND_NAMES: &[&str] = &[
    "get_logging_settings",
    "save_logging_settings",
    "open_log_directory",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct EmptyDiagnosticsRequest {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SaveLoggingSettingsRequest {
    pub max_file_mib: u32,
    pub max_files: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoggingPolicyDto {
    pub max_file_mib: u32,
    pub max_files: u32,
}

impl From<LoggingPolicy> for LoggingPolicyDto {
    fn from(policy: LoggingPolicy) -> Self {
        Self {
            max_file_mib: policy.max_file_mib,
            max_files: policy.max_files,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoggingLimitsDto {
    pub default_max_file_mib: u32,
    pub default_max_files: u32,
    pub max_file_mib: u32,
    pub max_files: u32,
    pub max_total_mib: u32,
}

impl From<LoggingLimits> for LoggingLimitsDto {
    fn from(limits: LoggingLimits) -> Self {
        Self {
            default_max_file_mib: limits.default_max_file_mib,
            default_max_files: limits.default_max_files,
            max_file_mib: limits.max_file_mib,
            max_files: limits.max_files,
            max_total_mib: limits.max_total_mib,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoggingSettingsDto {
    pub configured: LoggingPolicyDto,
    pub active: LoggingPolicyDto,
    pub limits: LoggingLimitsDto,
    pub config_status: ConfigStatus,
    pub sink_status: SinkStatus,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct OpenLogDirectoryResult {
    pub opened: bool,
}

pub trait LogDirectoryOpener: Send + Sync {
    fn resolve_log_dir(&self) -> Result<PathBuf, CommandError>;
    fn create_dir_all(&self, path: &Path) -> Result<(), CommandError>;
    fn open_path(&self, path: &Path) -> Result<(), CommandError>;
}

struct ProductionLogDirectoryOpener<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> LogDirectoryOpener for ProductionLogDirectoryOpener<R> {
    fn resolve_log_dir(&self) -> Result<PathBuf, CommandError> {
        self.app.path().app_log_dir().map_err(|_| open_failed())
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), CommandError> {
        std::fs::create_dir_all(path).map_err(|_| open_failed())
    }

    fn open_path(&self, path: &Path) -> Result<(), CommandError> {
        self.app
            .opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|_| open_failed())
    }
}

#[tauri::command]
pub async fn get_logging_settings<R: Runtime>(
    _request: EmptyDiagnosticsRequest,
    app: AppHandle<R>,
    active: State<'_, ActiveLoggingState>,
) -> Result<LoggingSettingsDto, CommandError> {
    command_result(
        "get_logging_settings",
        current_settings(&app, *active),
        None,
    )
}

#[tauri::command]
pub async fn save_logging_settings<R: Runtime>(
    request: SaveLoggingSettingsRequest,
    app: AppHandle<R>,
    active: State<'_, ActiveLoggingState>,
    lock: State<'_, LoggingSaveLock>,
) -> Result<LoggingSettingsDto, CommandError> {
    let policy = match LoggingPolicy::try_from_limits(request.max_file_mib, request.max_files) {
        Ok(policy) => policy,
        Err(error) => return Err(invalid_policy(error)),
    };
    let _guard = lock.0.lock().await;
    let dir = config_dir(&app)?;
    let result = tokio::task::spawn_blocking(move || save_policy(&dir, policy))
        .await
        .map_err(|_| save_failed())
        .and_then(|result| result);
    match result {
        Ok(_) => {
            record_lifecycle("save_logging_settings", "completed", None);
            current_settings(&app, *active)
        }
        Err(error) => {
            super::logging::record_command_failure("save_logging_settings", &error, None);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn open_log_directory<R: Runtime>(
    _request: EmptyDiagnosticsRequest,
    app: AppHandle<R>,
) -> Result<OpenLogDirectoryResult, CommandError> {
    let opener = ProductionLogDirectoryOpener { app };
    command_result("open_log_directory", open_log_directory_with(&opener), None)
}

pub(crate) fn open_log_directory_with(
    opener: &dyn LogDirectoryOpener,
) -> Result<OpenLogDirectoryResult, CommandError> {
    let path = opener.resolve_log_dir()?;
    opener.create_dir_all(&path)?;
    opener.open_path(&path)?;
    Ok(OpenLogDirectoryResult { opened: true })
}

fn current_settings<R: Runtime>(
    app: &AppHandle<R>,
    active: ActiveLoggingState,
) -> Result<LoggingSettingsDto, CommandError> {
    let dir = config_dir(app)?;
    let recovered = read_recovered_config(&dir);
    Ok(LoggingSettingsDto {
        configured: recovered.policy.into(),
        active: active.policy.into(),
        limits: LoggingLimits::AUTHORITATIVE.into(),
        config_status: recovered.status,
        sink_status: active.sink_status,
        restart_required: recovered.policy != active.policy,
    })
}

fn invalid_policy(error: PolicyValidation) -> CommandError {
    let reason = match error {
        PolicyValidation::NonPositive => "non_positive",
        PolicyValidation::OverLimit => "over_limit",
        PolicyValidation::Overflow => "overflow",
        PolicyValidation::TotalBudget => "total_budget",
    };
    CommandError::invalid_input("logging_policy", reason)
}

fn open_failed() -> CommandError {
    CommandError {
        code: CommandErrorCode::Internal,
        message: "无法打开日志目录。".to_owned(),
        retryable: true,
        details: None,
    }
}

fn save_failed() -> CommandError {
    CommandError {
        code: CommandErrorCode::Internal,
        message: "无法保存日志设置。".to_owned(),
        retryable: true,
        details: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{open_log_directory_with, LogDirectoryOpener, OpenLogDirectoryResult};
    use crate::error::CommandErrorCode;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    struct FakeOpener {
        resolve: Result<PathBuf, crate::error::CommandError>,
        create: Result<(), crate::error::CommandError>,
        open: Result<(), crate::error::CommandError>,
        created: Mutex<Vec<PathBuf>>,
        opened: Mutex<Vec<PathBuf>>,
    }

    impl LogDirectoryOpener for FakeOpener {
        fn resolve_log_dir(&self) -> Result<PathBuf, crate::error::CommandError> {
            self.resolve.clone()
        }

        fn create_dir_all(&self, path: &Path) -> Result<(), crate::error::CommandError> {
            self.created.lock().unwrap().push(path.to_path_buf());
            self.create.clone()
        }

        fn open_path(&self, path: &Path) -> Result<(), crate::error::CommandError> {
            self.opened.lock().unwrap().push(path.to_path_buf());
            self.open.clone()
        }
    }

    fn internal() -> crate::error::CommandError {
        crate::error::CommandError {
            code: CommandErrorCode::Internal,
            message: "无法打开日志目录。".to_owned(),
            retryable: true,
            details: None,
        }
    }

    #[test]
    fn open_directory_creates_and_opens_resolved_path() {
        let opener = FakeOpener {
            resolve: Ok(PathBuf::from("/trusted/logs")),
            create: Ok(()),
            open: Ok(()),
            created: Mutex::new(Vec::new()),
            opened: Mutex::new(Vec::new()),
        };
        assert_eq!(
            open_log_directory_with(&opener).unwrap(),
            OpenLogDirectoryResult { opened: true }
        );
        assert_eq!(
            opener.created.lock().unwrap().as_slice(),
            [PathBuf::from("/trusted/logs")]
        );
        assert_eq!(
            opener.opened.lock().unwrap().as_slice(),
            [PathBuf::from("/trusted/logs")]
        );
    }

    #[test]
    fn open_directory_maps_create_and_open_failures() {
        let create_fail = FakeOpener {
            resolve: Ok(PathBuf::from("/trusted/logs")),
            create: Err(internal()),
            open: Ok(()),
            created: Mutex::new(Vec::new()),
            opened: Mutex::new(Vec::new()),
        };
        assert_eq!(
            open_log_directory_with(&create_fail).unwrap_err().code,
            CommandErrorCode::Internal
        );
        assert!(create_fail.opened.lock().unwrap().is_empty());

        let open_fail = FakeOpener {
            resolve: Ok(PathBuf::from("/trusted/logs")),
            create: Ok(()),
            open: Err(internal()),
            created: Mutex::new(Vec::new()),
            opened: Mutex::new(Vec::new()),
        };
        assert_eq!(
            open_log_directory_with(&open_fail).unwrap_err().message,
            "无法打开日志目录。"
        );
    }

    #[test]
    fn capabilities_do_not_grant_opener_or_log_permissions() {
        let raw = include_str!("../../capabilities/default.json");
        let value: serde_json::Value = serde_json::from_str(raw).unwrap();
        let permissions = value["permissions"].as_array().expect("permissions array");
        for permission in permissions {
            let permission = permission.as_str().expect("permission string");
            assert!(
                !permission.starts_with("opener:"),
                "unexpected opener permission {permission}"
            );
            assert!(
                !permission.starts_with("log:"),
                "unexpected log permission {permission}"
            );
        }
    }
}
