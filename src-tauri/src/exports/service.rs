use thiserror::Error;

// Exports aggregate many nodes (plus headings), so the cap keeps generous
// headroom above the 1 MiB per-node limit instead of reusing it.
const MAX_EXPORT_CONTENT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("invalid export input")]
    InvalidInput {
        field: &'static str,
        reason: &'static str,
    },

    #[error("export file write failed")]
    WriteFailed,
}

impl ExportError {
    fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self::InvalidInput { field, reason }
    }
}

/// Validate and write one export file. Blocking by design: a single bounded
/// write (16 MiB cap) performed on the command task. IO failures never
/// include the target path.
pub fn write_export_file(path: &str, content: &str) -> Result<u64, ExportError> {
    if path.trim().is_empty() {
        return Err(ExportError::invalid_input("path", "blank"));
    }
    if content.trim().is_empty() {
        return Err(ExportError::invalid_input("content", "blank"));
    }
    if content.len() > MAX_EXPORT_CONTENT_BYTES {
        return Err(ExportError::invalid_input("content", "too_large"));
    }
    std::fs::write(path, content).map_err(|_| ExportError::WriteFailed)?;
    Ok(u64::try_from(content.len()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::write_export_file;
    use crate::error::{CommandError, CommandErrorCode};

    #[test]
    fn export_write_rejects_blank_and_oversized_requests() {
        let blank_path = CommandError::from(write_export_file("  ", "# title").unwrap_err());
        assert_eq!(blank_path.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            blank_path.details,
            Some(serde_json::json!({ "field": "path", "reason": "blank" }))
        );

        let blank_content =
            CommandError::from(write_export_file("/tmp/canopy-export.md", " \n\t ").unwrap_err());
        assert_eq!(blank_content.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            blank_content.details,
            Some(serde_json::json!({ "field": "content", "reason": "blank" }))
        );

        let oversized = CommandError::from(
            write_export_file("/tmp/canopy-export.md", &"a".repeat(16 * 1024 * 1024 + 1))
                .unwrap_err(),
        );
        assert_eq!(oversized.code, CommandErrorCode::InvalidInput);
        assert_eq!(
            oversized.details,
            Some(serde_json::json!({ "field": "content", "reason": "too_large" }))
        );
    }

    #[test]
    fn export_write_maps_io_failure_to_export_file_write_envelope() {
        // A missing parent directory fails with ENOENT for every user,
        // including a root test runner, without touching the filesystem.
        let error = CommandError::from(
            write_export_file("/canopy-export-missing-parent-dir/export.md", "# title")
                .unwrap_err(),
        );
        assert_eq!(error.code, CommandErrorCode::ExportFileWrite);
        assert_eq!(error.message, "写入导出文件失败。");
        assert!(!error.retryable);
        assert_eq!(error.details, None);
    }

    #[test]
    fn export_write_reports_byte_length_and_stores_content_verbatim() {
        let path = std::env::temp_dir().join(format!("canopy-export-{}.md", uuid::Uuid::new_v4()));
        let path = path.to_str().expect("temp path is valid UTF-8");
        let content = "# 标题\n\n## 用户\n\n  preserved 内容\n";

        let bytes_written = write_export_file(path, content).expect("export writes");
        assert_eq!(bytes_written, content.len() as u64);

        let stored = std::fs::read_to_string(path).expect("exported file is readable");
        assert_eq!(stored, content);
        std::fs::remove_file(path).expect("exported file is removed");
    }
}
