use canopy_lib::{
    error::CommandError,
    usage::{
        commands::{
            ClearUsageRecordsRequest, ClearUsageRecordsResult, GetUsageSummaryRequest,
            USAGE_COMMAND_NAMES,
        },
        UsageSummary,
    },
};
use serde_json::Value;

#[test]
fn shared_usage_fixture_round_trips_rust_wire_types() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../contract-fixtures/usage-ipc.json"))
            .expect("usage fixture is valid JSON");
    assert_eq!(
        serde_json::to_value(USAGE_COMMAND_NAMES).unwrap(),
        fixture["command_names"]
    );

    let request: GetUsageSummaryRequest =
        serde_json::from_value(fixture["requests"]["get_usage_summary"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        fixture["requests"]["get_usage_summary"]
    );
    let explicit_request: GetUsageSummaryRequest =
        serde_json::from_value(fixture["requests"]["get_usage_summary_explicit"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(explicit_request).unwrap(),
        fixture["requests"]["get_usage_summary_explicit"]
    );
    let clear_request: ClearUsageRecordsRequest =
        serde_json::from_value(fixture["requests"]["clear_usage_records"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(clear_request).unwrap(),
        fixture["requests"]["clear_usage_records"]
    );

    let summary: UsageSummary =
        serde_json::from_value(fixture["successes"]["get_usage_summary"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(summary).unwrap(),
        fixture["successes"]["get_usage_summary"]
    );
    let cleared: ClearUsageRecordsResult =
        serde_json::from_value(fixture["successes"]["clear_usage_records"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(cleared).unwrap(),
        fixture["successes"]["clear_usage_records"]
    );

    let unavailable: CommandError =
        serde_json::from_value(fixture["errors"]["database_unavailable"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(unavailable).unwrap(),
        fixture["errors"]["database_unavailable"]
    );
    let internal: CommandError =
        serde_json::from_value(fixture["errors"]["internal"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(internal).unwrap(),
        fixture["errors"]["internal"]
    );
}

#[test]
fn usage_summary_request_rejects_unknown_ranges_during_deserialization() {
    assert!(serde_json::from_value::<GetUsageSummaryRequest>(
        serde_json::json!({ "range": "week" })
    )
    .is_err());
}
