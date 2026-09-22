use serde::{Deserialize, Serialize};

use crate::llm::TokenUsage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageRange {
    #[serde(rename = "last_7_days")]
    Last7Days,
    #[serde(rename = "last_30_days")]
    Last30Days,
    All,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageInterval {
    pub start_day: Option<String>,
    pub through_day: String,
}

impl UsageInterval {
    pub fn resolve(range: UsageRange, through_day: &str) -> Option<Self> {
        let (year, month, day) = parse_iso_day(through_day)?;
        let offset = match range {
            UsageRange::Last7Days => -6,
            UsageRange::Last30Days => -29,
            UsageRange::All => 0,
        };
        let start_day = (offset != 0).then(|| format_iso_day(add_days(year, month, day, offset)));
        Some(Self {
            start_day,
            through_day: through_day.to_owned(),
        })
    }
}

pub fn is_iso_day(value: &str) -> bool {
    parse_iso_day(value).is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageSource {
    Chat,
    Title,
}

impl UsageSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Title => "title",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewUsageRecord {
    pub conversation_id: Option<String>,
    pub node_id: Option<String>,
    pub source: UsageSource,
    pub provider_id: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub created_at: String,
}

impl NewUsageRecord {
    pub fn from_token_usage(
        conversation_id: Option<String>,
        node_id: Option<String>,
        source: UsageSource,
        provider_id: String,
        model: String,
        usage: TokenUsage,
        created_at: String,
    ) -> Self {
        let input_tokens = i64::try_from(usage.input_tokens).unwrap_or(i64::MAX);
        let output_tokens = i64::try_from(usage.output_tokens).unwrap_or(i64::MAX);
        let total_tokens = usage
            .total_tokens
            .and_then(|value| i64::try_from(value).ok())
            .unwrap_or_else(|| input_tokens.saturating_add(output_tokens));
        Self {
            conversation_id,
            node_id,
            source,
            provider_id,
            model,
            input_tokens,
            output_tokens,
            total_tokens,
            created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UsageTotals {
    pub input: i64,
    pub output: i64,
    pub total: i64,
    pub records: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UsageByDay {
    pub day: String,
    pub input: i64,
    pub output: i64,
    pub total: i64,
    pub records: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UsageByModel {
    pub provider_id: String,
    pub model: String,
    pub input: i64,
    pub output: i64,
    pub total: i64,
    pub records: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UsageBySource {
    pub source: String,
    pub input: i64,
    pub output: i64,
    pub total: i64,
    pub records: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct UsageSummary {
    pub totals: UsageTotals,
    pub by_day: Vec<UsageByDay>,
    pub by_model: Vec<UsageByModel>,
    pub by_source: Vec<UsageBySource>,
}

/// Convert Unix epoch milliseconds to an RFC 3339 UTC timestamp.
pub fn rfc3339_utc_from_millis(millis: i64) -> String {
    let millis = millis.max(0);
    let seconds = millis / 1000;
    let milli = (millis % 1000) as u32;
    let days = seconds.div_euclid(86_400);
    let tod = seconds.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_unix_days(days);
    let hour = tod / 3_600;
    let minute = (tod % 3_600) / 60;
    let second = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

pub fn rfc3339_utc_now() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    rfc3339_utc_from_millis(i64::try_from(millis).unwrap_or(i64::MAX))
}

/// Inverse of Howard Hinnant's `days_from_civil`, Unix epoch day 0 = 1970-01-01.
fn civil_from_unix_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month, day)
}

fn parse_iso_day(value: &str) -> Option<(i32, u32, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = value[0..4].parse().ok()?;
    let month = value[5..7].parse().ok()?;
    let day = value[8..10].parse().ok()?;
    let parsed = (year, month, day);
    (format_iso_day(civil_from_unix_days(unix_days_from_civil(year, month, day))) == value)
        .then_some(parsed)
}

fn add_days(year: i32, month: u32, day: u32, offset: i64) -> (i32, u32, u32) {
    civil_from_unix_days(unix_days_from_civil(year, month, day) + offset)
}

fn unix_days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let month = i64::from(month);
    let day = i64::from(day);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn format_iso_day((year, month, day): (i32, u32, u32)) -> String {
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::{is_iso_day, rfc3339_utc_from_millis, UsageInterval, UsageRange};

    #[test]
    fn rfc3339_formats_unix_epoch() {
        assert_eq!(rfc3339_utc_from_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            rfc3339_utc_from_millis(1_704_067_200_000),
            "2024-01-01T00:00:00.000Z"
        );
        assert_eq!(
            rfc3339_utc_from_millis(1_704_067_200_123),
            "2024-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn usage_intervals_are_inclusive_and_calendar_aware() {
        assert_eq!(
            UsageInterval::resolve(UsageRange::Last7Days, "2026-03-01")
                .unwrap()
                .start_day
                .as_deref(),
            Some("2026-02-23")
        );
        assert_eq!(
            UsageInterval::resolve(UsageRange::Last30Days, "2024-03-01")
                .unwrap()
                .start_day
                .as_deref(),
            Some("2024-02-01")
        );
        assert!(UsageInterval::resolve(UsageRange::All, "2026-03-01")
            .unwrap()
            .start_day
            .is_none());
        assert!(is_iso_day("2024-02-29"));
        assert!(!is_iso_day("2026-02-29"));
        assert!(!is_iso_day("2026-2-1"));
    }
}
