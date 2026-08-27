use crate::error::CommandError;

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
) -> Result<WriteExportFileResponse, CommandError> {
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
