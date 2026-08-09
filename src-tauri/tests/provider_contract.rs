use canopy_lib::providers::commands::{
    CancelGenerationRequest, CancelGenerationResult, CommitGenerationRequest,
    CommitGenerationResult, DeleteProviderProfileRequest, DeleteProviderProfileResult,
    GenerateFromActivePathRequest, GenerationEventDto, GenerationStartResult,
    LoadProviderProfileRequest, ProviderProfileDto, SaveProviderProfileRequest,
    PROVIDER_COMMAND_NAMES,
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
    request!("commit_generation", CommitGenerationRequest);

    let profiles = ["profile_without_key", "profile_with_key"];
    for name in profiles {
        let value = fixture["successes"][name].clone();
        let dto: ProviderProfileDto = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(dto).unwrap(), value);
    }
    let delete: DeleteProviderProfileResult =
        serde_json::from_value(fixture["successes"]["delete"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(delete).unwrap(),
        fixture["successes"]["delete"]
    );
    let start: GenerationStartResult =
        serde_json::from_value(fixture["successes"]["generation_start"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(start).unwrap(),
        fixture["successes"]["generation_start"]
    );
    let cancel: CancelGenerationResult =
        serde_json::from_value(fixture["successes"]["cancel"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(cancel).unwrap(),
        fixture["successes"]["cancel"]
    );
    for name in ["commit", "commit_rejected"] {
        let value = fixture["successes"][name].clone();
        let commit: CommitGenerationResult = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(commit).unwrap(), value);
    }

    let events: Vec<GenerationEventDto> =
        serde_json::from_value(fixture["events"].clone()).unwrap();
    assert_eq!(serde_json::to_value(events).unwrap(), fixture["events"]);
    for name in ["failed", "cancelled"] {
        let value = fixture["terminal_events"][name].clone();
        let event: GenerationEventDto = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), value);
    }
    for malformed in fixture["malformed_events"].as_array().unwrap() {
        assert!(serde_json::from_value::<GenerationEventDto>(malformed.clone()).is_err());
    }
    assert!(!fixture.to_string().contains("authorization"));
    assert!(!fixture.to_string().contains("bearer"));
}
