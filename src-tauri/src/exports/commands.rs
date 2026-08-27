use tauri::State;
use tauri_plugin_sql::DbInstances;

use crate::{error::CommandError, infra::database::managed_sqlite_pool};

use super::{
    dto::{WriteExportFileRequest, WriteExportFileResponse},
    service,
};

/// Frozen IPC name owned by export. The conversation fixture catalog still
/// lists it so the frontend command-name contract is unchanged.
pub const EXPORT_COMMAND_NAMES: &[&str] = &["write_export_file"];

#[tauri::command]
pub async fn write_export_file(
    request: WriteExportFileRequest,
    instances: State<'_, DbInstances>,
) -> Result<WriteExportFileResponse, CommandError> {
    // Compatibility preflight: the historical handler resolved the managed
    // pool before writing, so a missing database maps to
    // `database_unavailable` even though export does not use SQL.
    let _pool = managed_sqlite_pool(instances.inner())
        .await
        .map_err(CommandError::from)?;
    let bytes_written = service::write_export_file(&request.path, &request.content)?;
    Ok(WriteExportFileResponse { bytes_written })
}

#[cfg(test)]
mod tests {
    use super::EXPORT_COMMAND_NAMES;

    #[test]
    fn command_names_are_frozen() {
        assert_eq!(EXPORT_COMMAND_NAMES, &["write_export_file"]);
    }
}
