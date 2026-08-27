use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    conversations::PersistenceError, infra::database::DatabaseError, providers::ProviderError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandErrorCode {
    InvalidInput,
    NotFound,
    TreeIntegrity,
    DatabaseUnavailable,
    MigrationFailure,
    ProviderAuthentication,
    RateLimited,
    ProviderUnavailable,
    NetworkFailure,
    Cancelled,
    ExportFileWrite,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct CommandError {
    pub code: CommandErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl CommandError {
    pub fn invalid_input(field: &'static str, reason: &'static str) -> Self {
        Self {
            code: CommandErrorCode::InvalidInput,
            message: "请求包含无效输入。".to_owned(),
            retryable: false,
            details: Some(json!({ "field": field, "reason": reason })),
        }
    }

    pub fn internal() -> Self {
        Self {
            code: CommandErrorCode::Internal,
            message: "发生意外错误。".to_owned(),
            retryable: false,
            details: None,
        }
    }

    pub fn cancelled() -> Self {
        Self {
            code: CommandErrorCode::Cancelled,
            message: "生成已取消。".to_owned(),
            retryable: false,
            details: None,
        }
    }

    /// A file write requested by an export failed. The source IO error is
    /// dropped: its display text may embed the full target path, which the
    /// error envelope must not expose.
    pub fn export_file_write() -> Self {
        Self {
            code: CommandErrorCode::ExportFileWrite,
            message: "写入导出文件失败。".to_owned(),
            retryable: false,
            details: None,
        }
    }
}

impl From<ProviderError> for CommandError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::InvalidInput { field, reason } => Self::invalid_input(field, reason),
            ProviderError::ProfileNotFound => Self {
                code: CommandErrorCode::NotFound,
                message: "未找到服务提供商配置。".to_owned(),
                retryable: false,
                details: Some(json!({ "entity": "provider_profile" })),
            },
            ProviderError::CredentialMissing | ProviderError::Authentication => Self {
                code: CommandErrorCode::ProviderAuthentication,
                message: "需要服务提供商身份验证。".to_owned(),
                retryable: false,
                details: None,
            },
            ProviderError::CredentialUnavailable => Self {
                code: CommandErrorCode::ProviderUnavailable,
                message: "安全凭据存储当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
            ProviderError::GenerationAlreadyActive => {
                Self::invalid_input("conversation_id", "generation_already_active")
            }
            ProviderError::RateLimited { retry_after_ms } => Self {
                code: CommandErrorCode::RateLimited,
                message: "已达到服务提供商的速率限制。".to_owned(),
                retryable: true,
                details: retry_after_ms.map(|value| json!({ "retry_after_ms": value })),
            },
            ProviderError::Unavailable | ProviderError::Protocol => Self {
                code: CommandErrorCode::ProviderUnavailable,
                message: "服务提供商当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
            ProviderError::Network => Self {
                code: CommandErrorCode::NetworkFailure,
                message: "服务提供商网络请求失败。".to_owned(),
                retryable: true,
                details: None,
            },
            ProviderError::Cancelled => Self::cancelled(),
            ProviderError::RuntimeInvariant => Self::internal(),
            ProviderError::Persistence(error) => Self::from(error),
            ProviderError::Storage(error) if is_transient_storage_error(&error) => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "服务提供商数据库当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
            ProviderError::Storage(_) => Self::internal(),
        }
    }
}

impl From<DatabaseError> for CommandError {
    fn from(error: DatabaseError) -> Self {
        match error {
            DatabaseError::Unavailable => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "对话数据库当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
        }
    }
}

impl From<PersistenceError> for CommandError {
    fn from(error: PersistenceError) -> Self {
        match error {
            PersistenceError::NotFound { entity } => Self {
                code: CommandErrorCode::NotFound,
                message: "未找到请求的资源。".to_owned(),
                retryable: false,
                details: Some(json!({ "entity": entity })),
            },
            PersistenceError::InvalidInput { operation, .. } => Self {
                code: CommandErrorCode::InvalidInput,
                message: "不允许执行请求的操作。".to_owned(),
                retryable: false,
                details: Some(json!({ "reason": operation })),
            },
            PersistenceError::TreeIntegrity { reason } => Self {
                code: CommandErrorCode::TreeIntegrity,
                message: "无法验证对话树。".to_owned(),
                retryable: false,
                details: Some(json!({ "reason": reason })),
            },
            PersistenceError::InvalidStoredData { field } => Self {
                code: CommandErrorCode::TreeIntegrity,
                message: "对话树包含无效的存储数据。".to_owned(),
                retryable: false,
                details: Some(json!({ "field": field })),
            },
            PersistenceError::DatabaseUnavailable => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "对话数据库当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
            PersistenceError::Storage(error) if is_transient_storage_error(&error) => Self {
                code: CommandErrorCode::DatabaseUnavailable,
                message: "对话数据库当前不可用。".to_owned(),
                retryable: true,
                details: None,
            },
            PersistenceError::Storage(_) => Self::internal(),
        }
    }
}

fn is_transient_storage_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed | sqlx::Error::Io(_) => true,
        sqlx::Error::Database(database_error) => database_error
            .code()
            .and_then(|code| code.parse::<i32>().ok())
            .is_some_and(|code| matches!(code & 0xff, 5 | 6)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CommandError, CommandErrorCode};
    use crate::{conversations::PersistenceError, infra::database::DatabaseError};

    #[test]
    fn persistence_errors_map_to_safe_closed_codes() {
        let missing = CommandError::from(PersistenceError::NotFound { entity: "node" });
        assert_eq!(missing.code, CommandErrorCode::NotFound);
        assert_eq!(missing.message, "未找到请求的资源。");
        assert!(!missing.retryable);
        assert_eq!(missing.details, Some(json!({ "entity": "node" })));

        let unavailable = CommandError::from(PersistenceError::DatabaseUnavailable);
        assert_eq!(unavailable.code, CommandErrorCode::DatabaseUnavailable);
        assert_eq!(unavailable.message, "对话数据库当前不可用。");
        assert!(unavailable.retryable);
        assert_eq!(unavailable.details, None);

        let infra_unavailable = CommandError::from(DatabaseError::Unavailable);
        assert_eq!(
            infra_unavailable.code,
            CommandErrorCode::DatabaseUnavailable
        );
        assert_eq!(infra_unavailable.message, "对话数据库当前不可用。");
        assert!(infra_unavailable.retryable);
        assert_eq!(infra_unavailable.details, None);

        let corrupt = CommandError::from(PersistenceError::InvalidStoredData { field: "role" });
        assert_eq!(corrupt.code, CommandErrorCode::TreeIntegrity);
        assert_eq!(corrupt.message, "对话树包含无效的存储数据。");
    }

    #[test]
    fn absent_details_are_omitted_from_serialization() {
        assert_eq!(
            serde_json::to_value(CommandError::internal()).expect("error serializes"),
            json!({
                "code": "internal",
                "message": "发生意外错误。",
                "retryable": false
            })
        );
    }
}
