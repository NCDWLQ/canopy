use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

pub trait IdentityTimeSource: Clone + Send + Sync + 'static {
    fn new_id(&self) -> String;
    fn now_millis(&self) -> i64;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemIdentityTimeSource;

impl IdentityTimeSource for SystemIdentityTimeSource {
    fn new_id(&self) -> String {
        Uuid::new_v4().to_string()
    }

    fn now_millis(&self) -> i64 {
        let milliseconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        i64::try_from(milliseconds).unwrap_or(i64::MAX)
    }
}
