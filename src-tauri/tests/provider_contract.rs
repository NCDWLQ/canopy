use canopy_lib::providers::commands::{
    CancelGenerationRequest, CancelGenerationResult, DeleteProviderRequest, DeleteProviderResult,
    GenerateFromActivePathRequest, GenerationEventDto, GenerationTerminalDto,
    ListProviderModelsRequest, ListProvidersRequest, ListProvidersResult, ProviderDto,
    RevealProviderApiKeyRequest, RevealProviderApiKeyResult, SaveProviderRequest,
    SetActiveProviderRequest, SetActiveProviderResult, SetLanguageRequest, SetLanguageResult,
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
    request!("list_providers", ListProvidersRequest);
    request!("save_provider", SaveProviderRequest);
    request!("delete_provider", DeleteProviderRequest);
    request!("set_active_provider", SetActiveProviderRequest);
    request!("set_language", SetLanguageRequest);
    request!("reveal_provider_api_key", RevealProviderApiKeyRequest);
    request!("list_provider_models", ListProviderModelsRequest);
    request!("generate_from_active_path", GenerateFromActivePathRequest);
    request!("cancel_generation", CancelGenerationRequest);

    let provider: ProviderDto =
        serde_json::from_value(fixture["successes"]["provider"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(provider).unwrap(),
        fixture["successes"]["provider"]
    );
    let listed: ListProvidersResult =
        serde_json::from_value(fixture["successes"]["providers"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(listed).unwrap(),
        fixture["successes"]["providers"]
    );
    let deleted: DeleteProviderResult =
        serde_json::from_value(fixture["successes"]["delete"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(deleted).unwrap(),
        fixture["successes"]["delete"]
    );
    let active: SetActiveProviderResult =
        serde_json::from_value(fixture["successes"]["active"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(active).unwrap(),
        fixture["successes"]["active"]
    );
    let language: SetLanguageResult =
        serde_json::from_value(fixture["successes"]["set_language"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(language).unwrap(),
        fixture["successes"]["set_language"]
    );
    let revealed: RevealProviderApiKeyResult =
        serde_json::from_value(fixture["successes"]["reveal_api_key"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(revealed).unwrap(),
        fixture["successes"]["reveal_api_key"]
    );
    let cancelled: CancelGenerationResult =
        serde_json::from_value(fixture["successes"]["cancel"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(cancelled).unwrap(),
        fixture["successes"]["cancel"]
    );

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
