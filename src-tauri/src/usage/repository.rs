use sqlx::{SqliteConnection, SqlitePool};

use super::{
    domain::USAGE_SUMMARY_DAY_WINDOW, NewUsageRecord, UsageByDay, UsageByModel, UsageBySource,
    UsageError, UsageSummary, UsageTotals,
};

pub(crate) struct UsageRepository;

impl UsageRepository {
    pub(crate) async fn insert(
        connection: &mut SqliteConnection,
        record: &NewUsageRecord,
    ) -> Result<(), UsageError> {
        sqlx::query(
            "INSERT INTO usage_records (
                conversation_id, node_id, source, provider_id, model,
                input_tokens, output_tokens, total_tokens, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(record.conversation_id.as_deref())
        .bind(record.node_id.as_deref())
        .bind(record.source.as_str())
        .bind(&record.provider_id)
        .bind(&record.model)
        .bind(record.input_tokens)
        .bind(record.output_tokens)
        .bind(record.total_tokens)
        .bind(&record.created_at)
        .execute(&mut *connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn clear(connection: &mut SqliteConnection) -> Result<(), UsageError> {
        sqlx::query("DELETE FROM usage_records")
            .execute(&mut *connection)
            .await?;
        Ok(())
    }

    pub(crate) async fn summary(pool: &SqlitePool) -> Result<UsageSummary, UsageError> {
        let totals = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(COALESCE(total_tokens, input_tokens + output_tokens)), 0),
                COUNT(*)
             FROM usage_records",
        )
        .fetch_one(pool)
        .await?;

        let day_window = format!("-{offset} days", offset = USAGE_SUMMARY_DAY_WINDOW - 1);
        let by_day = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(
            "SELECT
                date(created_at, 'localtime') AS day,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)),
                COUNT(*)
             FROM usage_records
             WHERE date(created_at, 'localtime') >= date('now', 'localtime', ?1)
             GROUP BY day
             ORDER BY day ASC",
        )
        .bind(&day_window)
        .fetch_all(pool)
        .await?;

        let by_model = sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(
            "SELECT
                provider_id,
                model,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)) AS total,
                COUNT(*)
             FROM usage_records
             GROUP BY provider_id, model
             ORDER BY total DESC, provider_id ASC, model ASC",
        )
        .fetch_all(pool)
        .await?;

        let by_source = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(
            "SELECT
                source,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)),
                COUNT(*)
             FROM usage_records
             GROUP BY source
             ORDER BY source ASC",
        )
        .fetch_all(pool)
        .await?;

        Ok(UsageSummary {
            totals: UsageTotals {
                input: totals.0,
                output: totals.1,
                total: totals.2,
                records: totals.3,
            },
            by_day: by_day
                .into_iter()
                .map(|(day, input, output, total, records)| UsageByDay {
                    day,
                    input,
                    output,
                    total,
                    records,
                })
                .collect(),
            by_model: by_model
                .into_iter()
                .map(
                    |(provider_id, model, input, output, total, records)| UsageByModel {
                        provider_id,
                        model,
                        input,
                        output,
                        total,
                        records,
                    },
                )
                .collect(),
            by_source: by_source
                .into_iter()
                .map(|(source, input, output, total, records)| UsageBySource {
                    source,
                    input,
                    output,
                    total,
                    records,
                })
                .collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use crate::infra::database::MIGRATION_CATALOG;
    use crate::usage::{NewUsageRecord, UsageService, UsageSource};

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    async fn migrated_pool() -> sqlx::SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        for migration in MIGRATION_CATALOG {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    fn record(
        source: UsageSource,
        provider_id: &str,
        model: &str,
        input: i64,
        output: i64,
        created_at: &str,
    ) -> NewUsageRecord {
        NewUsageRecord {
            conversation_id: Some("conversation".to_owned()),
            node_id: Some("node".to_owned()),
            source,
            provider_id: provider_id.to_owned(),
            model: model.to_owned(),
            input_tokens: input,
            output_tokens: output,
            total_tokens: input + output,
            created_at: created_at.to_owned(),
        }
    }

    #[test]
    fn summary_groups_by_explicit_timestamps_and_model() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            let service = UsageService::new(pool.clone());
            service
                .insert(record(
                    UsageSource::Chat,
                    "openai",
                    "gpt-5",
                    10,
                    5,
                    "2026-01-15T12:00:00.000Z",
                ))
                .await
                .unwrap();
            service
                .insert(record(
                    UsageSource::Title,
                    "openai",
                    "gpt-5",
                    4,
                    1,
                    "2026-01-15T12:00:00.000Z",
                ))
                .await
                .unwrap();
            service
                .insert(record(
                    UsageSource::Chat,
                    "anthropic",
                    "claude",
                    20,
                    8,
                    "2026-01-17T12:00:00.000Z",
                ))
                .await
                .unwrap();
            service
                .insert(record(
                    UsageSource::Chat,
                    "openai",
                    "gpt-5",
                    100,
                    50,
                    "2020-01-01T12:00:00.000Z",
                ))
                .await
                .unwrap();

            let expected_day_a: String =
                sqlx::query_scalar("SELECT date('2026-01-15T12:00:00.000Z', 'localtime')")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let expected_day_b: String =
                sqlx::query_scalar("SELECT date('2026-01-17T12:00:00.000Z', 'localtime')")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            let summary = service.summary().await.unwrap();
            assert_eq!(summary.totals.input, 134);
            assert_eq!(summary.totals.output, 64);
            assert_eq!(summary.totals.total, 198);
            assert_eq!(summary.totals.records, 4);

            let recent_days: Vec<&str> =
                summary.by_day.iter().map(|row| row.day.as_str()).collect();
            assert!(recent_days.contains(&expected_day_a.as_str()));
            assert!(recent_days.contains(&expected_day_b.as_str()));
            assert!(!recent_days.contains(&"2020-01-01"));

            let day_a = summary
                .by_day
                .iter()
                .find(|row| row.day == expected_day_a)
                .unwrap();
            if expected_day_a == expected_day_b {
                assert_eq!(day_a.records, 3);
                assert_eq!(day_a.total, 48);
            } else {
                assert_eq!(day_a.records, 2);
                assert_eq!(day_a.input, 14);
                assert_eq!(day_a.output, 6);
                assert_eq!(day_a.total, 20);
                let day_b = summary
                    .by_day
                    .iter()
                    .find(|row| row.day == expected_day_b)
                    .unwrap();
                assert_eq!(day_b.records, 1);
                assert_eq!(day_b.total, 28);
            }

            assert_eq!(summary.by_model[0].provider_id, "openai");
            assert_eq!(summary.by_model[0].model, "gpt-5");
            assert_eq!(summary.by_model[0].total, 170);
            assert_eq!(summary.by_model[0].records, 3);
            assert_eq!(summary.by_model[1].provider_id, "anthropic");
            assert_eq!(summary.by_model[1].model, "claude");
            assert_eq!(summary.by_model[1].total, 28);

            assert_eq!(summary.by_source.len(), 2);
            let chat = summary
                .by_source
                .iter()
                .find(|row| row.source == "chat")
                .unwrap();
            assert_eq!(chat.input, 130);
            assert_eq!(chat.output, 63);
            assert_eq!(chat.total, 193);
            assert_eq!(chat.records, 3);
            let title = summary
                .by_source
                .iter()
                .find(|row| row.source == "title")
                .unwrap();
            assert_eq!(title.input, 4);
            assert_eq!(title.output, 1);
            assert_eq!(title.total, 5);
            assert_eq!(title.records, 1);

            service.clear().await.unwrap();
            let emptied = service.summary().await.unwrap();
            assert_eq!(emptied.totals.records, 0);
            assert!(emptied.by_day.is_empty());
            assert!(emptied.by_model.is_empty());
            assert!(emptied.by_source.is_empty());
        });
    }
}
