use serde::{Deserialize, Serialize};

/// Path and content for a Markdown export. The path always originates from
/// the native save dialog; the webview never gains direct filesystem access.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct WriteExportFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct WriteExportFileResponse {
    pub bytes_written: u64,
}
