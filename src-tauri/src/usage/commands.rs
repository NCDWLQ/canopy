use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::{error::CommandError, infra::database::managed_sqlite_pool};

use super::{domain::is_iso_day, UsageRange, UsageService, UsageSummary};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GetUsageSummaryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<UsageRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub through_day: Option<String>,
}

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

fn validate_summary_request(request: &GetUsageSummaryRequest) -> Result<(), CommandError> {
    if request
        .through_day
        .as_deref()
        .is_some_and(|day| !is_iso_day(day))
    {
        return Err(CommandError::invalid_input("through_day", "invalid_date"));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_usage_summary(
    request: GetUsageSummaryRequest,
    instances: State<'_, DbInstances>,
) -> Result<UsageSummary, CommandError> {
    validate_summary_request(&request)?;
    let pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    production_service(pool)
        .summary(
            request.range.unwrap_or(UsageRange::All),
            request.through_day.as_deref(),
        )
        .await
        .map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::{validate_summary_request, GetUsageSummaryRequest};
    use crate::error::CommandErrorCode;

    #[test]
    fn summary_request_rejects_malformed_through_day() {
        let error = validate_summary_request(&GetUsageSummaryRequest {
            range: None,
            through_day: Some("2026-02-29".to_owned()),
        })
        .unwrap_err();
        assert_eq!(error.code, CommandErrorCode::InvalidInput);
    }
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
