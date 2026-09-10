use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::{error::CommandError, infra::database::managed_sqlite_pool};

use super::{UsageService, UsageSummary};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GetUsageSummaryRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ClearUsageRecordsRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct ClearUsageRecordsResult {
    pub cleared: bool,
}

pub const USAGE_COMMAND_NAMES: &[&str] = &["get_usage_summary", "clear_usage_records"];

fn production_service(pool: sqlx::SqlitePool) -> UsageService {
    UsageService::new(pool)
}

#[tauri::command]
pub async fn get_usage_summary(
    request: GetUsageSummaryRequest,
    instances: State<'_, DbInstances>,
) -> Result<UsageSummary, CommandError> {
    let _ = request;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .summary()
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn clear_usage_records(
    request: ClearUsageRecordsRequest,
    instances: State<'_, DbInstances>,
) -> Result<ClearUsageRecordsResult, CommandError> {
    let _ = request;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .clear()
        .await
        .map(|()| ClearUsageRecordsResult { cleared: true })
        .map_err(CommandError::from)
}
