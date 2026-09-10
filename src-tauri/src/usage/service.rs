use sqlx::SqlitePool;

use super::{
    domain::rfc3339_utc_now, repository::UsageRepository, NewUsageRecord, UsageError, UsageSource,
    UsageSummary,
};
use crate::llm::TokenUsage;

#[derive(Clone)]
pub struct UsageService {
    pool: SqlitePool,
}

impl std::fmt::Debug for UsageService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("UsageService")
            .finish_non_exhaustive()
    }
}

impl UsageService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, record: NewUsageRecord) -> Result<(), UsageError> {
        let mut transaction = self.pool.begin().await?;
        UsageRepository::insert(&mut transaction, &record).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn clear(&self) -> Result<(), UsageError> {
        let mut transaction = self.pool.begin().await?;
        UsageRepository::clear(&mut transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn summary(&self) -> Result<UsageSummary, UsageError> {
        UsageRepository::summary(&self.pool).await
    }

    /// Persist usage when present. Failures are logged and never returned to
    /// the generation caller — a stats write must not block a completed reply.
    pub async fn record_best_effort(
        &self,
        conversation_id: Option<&str>,
        node_id: Option<&str>,
        source: UsageSource,
        provider_id: &str,
        model: &str,
        usage: Option<TokenUsage>,
    ) {
        let Some(usage) = usage else {
            return;
        };
        let record = NewUsageRecord::from_token_usage(
            conversation_id.map(str::to_owned),
            node_id.map(str::to_owned),
            source,
            provider_id.to_owned(),
            model.to_owned(),
            usage,
            rfc3339_utc_now(),
        );
        if self.insert(record).await.is_err() {
            match conversation_id {
                Some(conversation_id) => {
                    log::warn!(
                        "operation=insert_usage_record code=usage_persist_failed conversation_id={conversation_id} source={source}",
                        source = source.as_str()
                    );
                }
                None => {
                    log::warn!(
                        "operation=insert_usage_record code=usage_persist_failed source={source}",
                        source = source.as_str()
                    );
                }
            }
        }
    }
}
