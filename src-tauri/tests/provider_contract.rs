use canopy_lib::providers::commands::{
    CancelGenerationRequest, CancelGenerationResult, DeleteProviderProfileRequest,
    DeleteProviderProfileResult, GenerateFromActivePathRequest, GenerationEventDto,
    GenerationTerminalDto, LoadProviderProfileRequest, ProviderProfileDto,
    SaveProviderProfileRequest, PROVIDER_COMMAND_NAMES,
};
use serde_json::Value;

#[test]
fn shared_provider_fixture_round_trips_rust_wire_types() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../contract-fixtures/provider-ipc.json"))
            .expect("provider fixture is valid JSON");
    assert_eq!(
        serde_json::to_value(PROVIDER_COMMAND_NAMES).unwrap(),
        fixture["command_names"]
    );

    macro_rules! request {
        ($name:literal, $type:ty) => {{
            let value = fixture["requests"][$name].clone();
            let decoded: $type = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(decoded).unwrap(), value);
        }};
    }
    request!("save_provider_profile", SaveProviderProfileRequest);
    request!("load_provider_profile", LoadProviderProfileRequest);
    request!("delete_provider_profile", DeleteProviderProfileRequest);
    request!("generate_from_active_path", GenerateFromActivePathRequest);
    request!("cancel_generation", CancelGenerationRequest);

    for name in ["profile_without_key", "profile_with_key"] {
        let value = fixture["successes"][name].clone();
        let dto: ProviderProfileDto = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(dto).unwrap(), value);
    }
    for (name, ty) in [("delete", "delete"), ("cancel", "cancel")] {
        let value = fixture["successes"][name].clone();
        if ty == "delete" {
            let dto: DeleteProviderProfileResult = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(dto).unwrap(), value);
        } else {
            let dto: CancelGenerationResult = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(dto).unwrap(), value);
        }
    }

    let completed = fixture["successes"]["generation_completed"].clone();
    let terminal: GenerationTerminalDto = serde_json::from_value(completed.clone()).unwrap();
    assert_eq!(serde_json::to_value(terminal).unwrap(), completed);

    let events: Vec<GenerationEventDto> =
        serde_json::from_value(fixture["events"].clone()).unwrap();
    assert_eq!(serde_json::to_value(events).unwrap(), fixture["events"]);
    for name in ["failed", "persistence_failed", "cancelled"] {
        let value = fixture["terminal_results"][name].clone();
        let terminal: GenerationTerminalDto = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(terminal).unwrap(), value);
    }
    for malformed in fixture["malformed_events"].as_array().unwrap() {
        assert!(serde_json::from_value::<GenerationEventDto>(malformed.clone()).is_err());
    }
    for malformed in fixture["malformed_results"].as_array().unwrap() {
        assert!(serde_json::from_value::<GenerationTerminalDto>(malformed.clone()).is_err());
    }
    assert!(!fixture.to_string().contains("authorization"));
    assert!(!fixture.to_string().contains("bearer"));
}
