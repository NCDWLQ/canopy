use uuid::Uuid;

pub fn is_canonical_uuid_v4(value: &str) -> bool {
    Uuid::parse_str(value)
        .ok()
        .filter(|parsed| parsed.get_version() == Some(uuid::Version::Random))
        .filter(|parsed| parsed.get_variant() == uuid::Variant::RFC4122)
        .is_some_and(|parsed| parsed.to_string() == value)
}

#[cfg(test)]
mod tests {
    use super::is_canonical_uuid_v4;

    #[test]
    fn accepts_canonical_uuid_v4() {
        assert!(is_canonical_uuid_v4("11111111-1111-4111-8111-111111111111"));
    }

    #[test]
    fn rejects_non_canonical_or_non_v4_values() {
        for invalid in [
            "",
            "generation",
            "11111111-1111-3111-8111-111111111111",
            "11111111-1111-4111-7111-111111111111",
            "11111111-1111-4111-8111-11111111111A",
            "11111111-1111-4111-8111-111111111111\n",
        ] {
            assert!(!is_canonical_uuid_v4(invalid));
        }
    }
}
