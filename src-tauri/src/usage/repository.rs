use sqlx::{SqliteConnection, SqlitePool};

use super::{
    domain::UsageInterval, NewUsageRecord, UsageByDay, UsageByModel, UsageBySource, UsageError,
    UsageSummary, UsageTotals,
};

pub(crate) struct UsageRepository;

// Keep every aggregate on the same inclusive local-calendar interval. Both
// placeholders are bound in the same order for each query below.
const USAGE_INTERVAL_PREDICATE: &str = "WHERE (?1 IS NULL OR date(created_at, 'localtime') >= ?1)
               AND date(created_at, 'localtime') <= ?2";

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

    pub(crate) async fn local_day(pool: &SqlitePool) -> Result<String, UsageError> {
        Ok(sqlx::query_scalar("SELECT date('now', 'localtime')")
            .fetch_one(pool)
            .await?)
    }

    pub(crate) async fn summary(
        pool: &SqlitePool,
        interval: &UsageInterval,
    ) -> Result<UsageSummary, UsageError> {
        let totals_query = format!(
            "SELECT
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(COALESCE(total_tokens, input_tokens + output_tokens)), 0),
                COUNT(*)
             FROM usage_records
             {USAGE_INTERVAL_PREDICATE}"
        );
        let totals = sqlx::query_as::<_, (i64, i64, i64, i64)>(&totals_query)
            .bind(&interval.start_day)
            .bind(&interval.through_day)
            .fetch_one(pool)
            .await?;

        let by_day_query = format!(
            "SELECT
                date(created_at, 'localtime') AS day,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)),
                COUNT(*)
             FROM usage_records
             {USAGE_INTERVAL_PREDICATE}
             GROUP BY day
             ORDER BY day ASC"
        );
        let by_day = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(&by_day_query)
            .bind(&interval.start_day)
            .bind(&interval.through_day)
            .fetch_all(pool)
            .await?;

        let by_model_query = format!(
            "SELECT
                provider_id,
                model,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)) AS total,
                COUNT(*)
             FROM usage_records
             {USAGE_INTERVAL_PREDICATE}
             GROUP BY provider_id, model
             ORDER BY total DESC, provider_id ASC, model ASC"
        );
        let by_model = sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(&by_model_query)
            .bind(&interval.start_day)
            .bind(&interval.through_day)
            .fetch_all(pool)
            .await?;

        let by_source_query = format!(
            "SELECT
                source,
                SUM(input_tokens),
                SUM(output_tokens),
                SUM(COALESCE(total_tokens, input_tokens + output_tokens)),
                COUNT(*)
             FROM usage_records
             {USAGE_INTERVAL_PREDICATE}
             GROUP BY source
             ORDER BY source ASC"
        );
        let by_source = sqlx::query_as::<_, (String, i64, i64, i64, i64)>(&by_source_query)
            .bind(&interval.start_day)
            .bind(&interval.through_day)
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
    use crate::usage::{NewUsageRecord, UsageRange, UsageService, UsageSource};

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

    async fn local_day(pool: &sqlx::SqlitePool, timestamp: &str) -> String {
        sqlx::query_scalar("SELECT date(?1, 'localtime')")
            .bind(timestamp)
            .fetch_one(pool)
            .await
            .unwrap()
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
            let expected_old_day: String =
                sqlx::query_scalar("SELECT date('2020-01-01T12:00:00.000Z', 'localtime')")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            let summary = service
                .summary(UsageRange::All, Some(&expected_day_b))
                .await
                .unwrap();
            assert_eq!(summary.totals.input, 134);
            assert_eq!(summary.totals.output, 64);
            assert_eq!(summary.totals.total, 198);
            assert_eq!(summary.totals.records, 4);

            let days: Vec<&str> = summary.by_day.iter().map(|row| row.day.as_str()).collect();
            assert!(days.contains(&expected_day_a.as_str()));
            assert!(days.contains(&expected_day_b.as_str()));
            assert!(days.contains(&expected_old_day.as_str()));

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
            let emptied = service
                .summary(UsageRange::All, Some(&expected_day_b))
                .await
                .unwrap();
            assert_eq!(emptied.totals.records, 0);
            assert!(emptied.by_day.is_empty());
            assert!(emptied.by_model.is_empty());
            assert!(emptied.by_source.is_empty());
        });
    }

    #[test]
    fn summary_applies_one_inclusive_interval_to_every_aggregate() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            let service = UsageService::new(pool.clone());
            for (source, provider, model, input, output, day) in [
                (UsageSource::Chat, "openai", "gpt", 1, 1, "2026-09-03"),
                (
                    UsageSource::Title,
                    "anthropic",
                    "claude",
                    2,
                    2,
                    "2026-09-04",
                ),
                (UsageSource::Chat, "openai", "gpt", 3, 3, "2026-09-10"),
                (
                    UsageSource::Title,
                    "anthropic",
                    "claude",
                    4,
                    4,
                    "2026-09-11",
                ),
                (UsageSource::Chat, "openai", "gpt", 5, 5, "2020-01-01"),
                (
                    UsageSource::Title,
                    "anthropic",
                    "claude",
                    6,
                    6,
                    "2026-08-11",
                ),
                (UsageSource::Chat, "openai", "gpt", 7, 7, "2026-08-12"),
            ] {
                service
                    .insert(record(
                        source,
                        provider,
                        model,
                        input,
                        output,
                        &format!("{day}T00:00:00.000Z"),
                    ))
                    .await
                    .unwrap();
            }

            let day_before_seven = local_day(&pool, "2026-09-03T00:00:00.000Z").await;
            let seven_start = local_day(&pool, "2026-09-04T00:00:00.000Z").await;
            let through_day = local_day(&pool, "2026-09-10T00:00:00.000Z").await;
            let future_day = local_day(&pool, "2026-09-11T00:00:00.000Z").await;
            let old_day = local_day(&pool, "2020-01-01T00:00:00.000Z").await;
            let day_before_thirty = local_day(&pool, "2026-08-11T00:00:00.000Z").await;
            let thirty_start = local_day(&pool, "2026-08-12T00:00:00.000Z").await;

            let seven = service
                .summary(UsageRange::Last7Days, Some(&through_day))
                .await
                .unwrap();
            assert_eq!(seven.totals.total, 10);
            assert_eq!(seven.totals.records, 2);
            assert_eq!(
                seven
                    .by_day
                    .iter()
                    .map(|row| row.day.as_str())
                    .collect::<Vec<_>>(),
                [seven_start.as_str(), through_day.as_str()]
            );
            assert_eq!(seven.by_model.len(), 2);
            assert_eq!(seven.by_source.len(), 2);
            assert_eq!(
                seven.by_model.iter().map(|row| row.total).sum::<i64>(),
                seven.totals.total
            );
            assert_eq!(
                seven.by_source.iter().map(|row| row.total).sum::<i64>(),
                seven.totals.total
            );

            let thirty = service
                .summary(UsageRange::Last30Days, Some(&through_day))
                .await
                .unwrap();
            assert_eq!(thirty.totals.total, 26);
            assert_eq!(thirty.totals.records, 4);
            assert_eq!(
                thirty
                    .by_day
                    .iter()
                    .map(|row| row.day.as_str())
                    .collect::<Vec<_>>(),
                [
                    thirty_start.as_str(),
                    day_before_seven.as_str(),
                    seven_start.as_str(),
                    through_day.as_str()
                ]
            );
            assert!(!thirty.by_day.iter().any(|row| row.day == day_before_thirty));
            assert_eq!(
                thirty.by_day.iter().map(|row| row.total).sum::<i64>(),
                thirty.totals.total
            );
            assert_eq!(
                thirty.by_model.iter().map(|row| row.total).sum::<i64>(),
                thirty.totals.total
            );
            assert_eq!(
                thirty.by_source.iter().map(|row| row.total).sum::<i64>(),
                thirty.totals.total
            );

            let all = service
                .summary(UsageRange::All, Some(&through_day))
                .await
                .unwrap();
            assert_eq!(all.totals.total, 48);
            assert_eq!(all.totals.records, 6);
            assert!(all.by_day.iter().any(|row| row.day == old_day));
            assert!(!all.by_day.iter().any(|row| row.day == future_day));
        });
    }
}
