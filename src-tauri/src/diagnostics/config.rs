use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

use crate::error::CommandError;

pub const DEFAULT_MAX_FILE_MIB: u32 = 5;
pub const DEFAULT_MAX_FILES: u32 = 5;
pub const HARD_MAX_FILE_MIB: u32 = 20;
pub const HARD_MAX_FILES: u32 = 10;
pub const HARD_MAX_TOTAL_MIB: u32 = 100;
pub const SLOT_VERSION: u32 = 1;
pub const SLOT_MAX_BYTES: usize = 4096;
pub const SLOT_A_NAME: &str = "logging-policy-a.json";
pub const SLOT_B_NAME: &str = "logging-policy-b.json";
pub const LOG_FILE_NAME: &str = "canopy";

const MIB_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigStatus {
    Default,
    Custom,
    Recovered,
    InvalidFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SinkStatus {
    Persistent,
    ConsoleFallback,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct LoggingPolicy {
    pub max_file_mib: u32,
    pub max_files: u32,
}

impl LoggingPolicy {
    pub const DEFAULT: Self = Self {
        max_file_mib: DEFAULT_MAX_FILE_MIB,
        max_files: DEFAULT_MAX_FILES,
    };

    pub fn try_from_limits(max_file_mib: u32, max_files: u32) -> Result<Self, PolicyValidation> {
        if max_file_mib == 0 || max_files == 0 {
            return Err(PolicyValidation::NonPositive);
        }
        if max_file_mib > HARD_MAX_FILE_MIB || max_files > HARD_MAX_FILES {
            return Err(PolicyValidation::OverLimit);
        }
        let total = max_file_mib
            .checked_mul(max_files)
            .ok_or(PolicyValidation::Overflow)?;
        if total > HARD_MAX_TOTAL_MIB {
            return Err(PolicyValidation::TotalBudget);
        }
        Ok(Self {
            max_file_mib,
            max_files,
        })
    }

    pub fn max_file_bytes(self) -> u64 {
        u64::from(self.max_file_mib) * MIB_BYTES
    }

    pub fn rotation_keep_archives(self) -> Option<usize> {
        match self.max_files {
            0 | 1 => None,
            n => Some(usize::try_from(n.saturating_sub(1)).unwrap_or(0)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyValidation {
    NonPositive,
    OverLimit,
    Overflow,
    TotalBudget,
}

#[derive(Debug, Clone, Copy)]
pub struct LoggingLimits {
    pub default_max_file_mib: u32,
    pub default_max_files: u32,
    pub max_file_mib: u32,
    pub max_files: u32,
    pub max_total_mib: u32,
}

impl LoggingLimits {
    pub const AUTHORITATIVE: Self = Self {
        default_max_file_mib: DEFAULT_MAX_FILE_MIB,
        default_max_files: DEFAULT_MAX_FILES,
        max_file_mib: HARD_MAX_FILE_MIB,
        max_files: HARD_MAX_FILES,
        max_total_mib: HARD_MAX_TOTAL_MIB,
    };
}

#[derive(Debug, Clone, Copy)]
pub struct ActiveLoggingState {
    pub policy: LoggingPolicy,
    pub sink_status: SinkStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveredConfig {
    pub policy: LoggingPolicy,
    pub status: ConfigStatus,
    pub revision: u64,
    pub authoritative_slot: SlotKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotKind {
    A,
    B,
}

impl SlotKind {
    fn file_name(self) -> &'static str {
        match self {
            Self::A => SLOT_A_NAME,
            Self::B => SLOT_B_NAME,
        }
    }

    fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredLoggingPolicy {
    version: u32,
    revision: u64,
    max_file_mib: u32,
    max_files: u32,
}

pub struct LoggingSaveLock(pub Mutex<()>);

impl LoggingSaveLock {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }
}

impl Default for LoggingSaveLock {
    fn default() -> Self {
        Self::new()
    }
}

pub fn load_startup_policy<R: Runtime>(app: &AppHandle<R>) -> RecoveredConfig {
    match config_dir(app) {
        Ok(dir) => read_recovered_config(&dir),
        Err(_) => default_recovered(),
    }
}

pub fn read_recovered_config(dir: &Path) -> RecoveredConfig {
    let slot_a = read_slot(dir, SlotKind::A);
    let slot_b = read_slot(dir, SlotKind::B);
    match (slot_a, slot_b) {
        (None, None) => default_recovered(),
        (Some(Ok(a)), Some(Ok(b))) => {
            let (winner, slot) = if a.revision > b.revision {
                (a, SlotKind::A)
            } else if b.revision > a.revision {
                (b, SlotKind::B)
            } else {
                (a, SlotKind::A)
            };
            RecoveredConfig {
                policy: winner.policy,
                status: ConfigStatus::Custom,
                revision: winner.revision,
                authoritative_slot: slot,
            }
        }
        (Some(Ok(valid)), None) => custom_from(valid, SlotKind::A),
        (None, Some(Ok(valid))) => custom_from(valid, SlotKind::B),
        (Some(Ok(valid)), Some(Err(_))) => recovered_from(valid, SlotKind::A),
        (Some(Err(_)), Some(Ok(valid))) => recovered_from(valid, SlotKind::B),
        _ => RecoveredConfig {
            policy: LoggingPolicy::DEFAULT,
            status: ConfigStatus::InvalidFallback,
            revision: 0,
            authoritative_slot: SlotKind::A,
        },
    }
}

fn custom_from(valid: ValidSlot, slot: SlotKind) -> RecoveredConfig {
    RecoveredConfig {
        policy: valid.policy,
        status: ConfigStatus::Custom,
        revision: valid.revision,
        authoritative_slot: slot,
    }
}

fn recovered_from(valid: ValidSlot, slot: SlotKind) -> RecoveredConfig {
    RecoveredConfig {
        policy: valid.policy,
        status: ConfigStatus::Recovered,
        revision: valid.revision,
        authoritative_slot: slot,
    }
}

pub(crate) fn default_recovered() -> RecoveredConfig {
    RecoveredConfig {
        policy: LoggingPolicy::DEFAULT,
        status: ConfigStatus::Default,
        revision: 0,
        authoritative_slot: SlotKind::A,
    }
}

fn read_slot_present(dir: &Path, slot: SlotKind) -> bool {
    dir.join(slot.file_name()).is_file()
}

struct ValidSlot {
    policy: LoggingPolicy,
    revision: u64,
}

fn read_slot(dir: &Path, slot: SlotKind) -> Option<Result<ValidSlot, ()>> {
    let path = dir.join(slot.file_name());
    if !path.exists() {
        return None;
    }
    Some(parse_slot_file(&path))
}

fn parse_slot_file(path: &Path) -> Result<ValidSlot, ()> {
    let mut file = File::open(path).map_err(|_| ())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|_| ())?;
    parse_slot_bytes(&buffer)
}

fn parse_slot_bytes(buffer: &[u8]) -> Result<ValidSlot, ()> {
    if buffer.len() > SLOT_MAX_BYTES {
        return Err(());
    }
    let stored: StoredLoggingPolicy = serde_json::from_slice(buffer).map_err(|_| ())?;
    if stored.version != SLOT_VERSION {
        return Err(());
    }
    let policy =
        LoggingPolicy::try_from_limits(stored.max_file_mib, stored.max_files).map_err(|_| ())?;
    Ok(ValidSlot {
        policy,
        revision: stored.revision,
    })
}

pub fn save_policy(dir: &Path, policy: LoggingPolicy) -> Result<RecoveredConfig, CommandError> {
    fs::create_dir_all(dir).map_err(|_| save_failed())?;
    let current = read_recovered_config(dir);
    let next_revision = current.revision.checked_add(1).ok_or_else(save_failed)?;
    let inactive = if current.status == ConfigStatus::Default && current.revision == 0 {
        match (
            read_slot_present(dir, SlotKind::A),
            read_slot_present(dir, SlotKind::B),
        ) {
            (false, _) => SlotKind::A,
            (true, false) => SlotKind::B,
            _ => current.authoritative_slot.other(),
        }
    } else {
        current.authoritative_slot.other()
    };
    write_slot(
        dir,
        inactive,
        &StoredLoggingPolicy {
            version: SLOT_VERSION,
            revision: next_revision,
            max_file_mib: policy.max_file_mib,
            max_files: policy.max_files,
        },
    )?;
    Ok(RecoveredConfig {
        policy,
        status: ConfigStatus::Custom,
        revision: next_revision,
        authoritative_slot: inactive,
    })
}

fn write_slot(
    dir: &Path,
    slot: SlotKind,
    stored: &StoredLoggingPolicy,
) -> Result<(), CommandError> {
    let path = dir.join(slot.file_name());
    let payload = serde_json::to_vec(stored).map_err(|_| save_failed())?;
    if payload.len() > SLOT_MAX_BYTES {
        return Err(save_failed());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|_| save_failed())?;
    file.write_all(&payload).map_err(|_| save_failed())?;
    file.flush().map_err(|_| save_failed())?;
    file.sync_all().map_err(|_| save_failed())?;
    Ok(())
}

pub fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    app.path().app_config_dir().map_err(|_| load_failed())
}

fn save_failed() -> CommandError {
    CommandError {
        code: crate::error::CommandErrorCode::Internal,
        message: "无法保存日志设置。".to_owned(),
        retryable: true,
        details: None,
    }
}

fn load_failed() -> CommandError {
    CommandError {
        code: crate::error::CommandErrorCode::Internal,
        message: "无法加载日志设置。".to_owned(),
        retryable: true,
        details: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_slot_bytes, read_recovered_config, save_policy, ConfigStatus, LoggingPolicy,
        PolicyValidation, SLOT_MAX_BYTES,
    };
    use std::fs;

    fn temp_dir() -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("canopy-logging-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn defaults_and_hard_limits() {
        assert_eq!(LoggingPolicy::DEFAULT.max_file_mib, 5);
        assert_eq!(LoggingPolicy::DEFAULT.max_files, 5);
        assert_eq!(LoggingPolicy::DEFAULT.max_file_bytes(), 5 * 1024 * 1024);
        assert_eq!(LoggingPolicy::DEFAULT.rotation_keep_archives(), Some(4));
        assert_eq!(
            LoggingPolicy::try_from_limits(1, 1)
                .unwrap()
                .rotation_keep_archives(),
            None
        );
        assert_eq!(
            LoggingPolicy {
                max_file_mib: 5,
                max_files: 0
            }
            .rotation_keep_archives(),
            None
        );
        assert_eq!(LoggingPolicy::try_from_limits(20, 5).unwrap().max_files, 5);
        assert_eq!(
            LoggingPolicy::try_from_limits(0, 5).unwrap_err(),
            PolicyValidation::NonPositive
        );
        assert_eq!(
            LoggingPolicy::try_from_limits(21, 1).unwrap_err(),
            PolicyValidation::OverLimit
        );
        assert_eq!(
            LoggingPolicy::try_from_limits(11, 10).unwrap_err(),
            PolicyValidation::TotalBudget
        );
        assert_eq!(
            LoggingPolicy::try_from_limits(u32::MAX, 2).unwrap_err(),
            PolicyValidation::OverLimit
        );
    }

    #[test]
    fn absent_slots_use_defaults() {
        let dir = temp_dir();
        let recovered = read_recovered_config(&dir);
        assert_eq!(recovered.status, ConfigStatus::Default);
        assert_eq!(recovered.policy, LoggingPolicy::DEFAULT);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn highest_revision_wins_and_ties_prefer_slot_a() {
        let dir = temp_dir();
        fs::write(
            dir.join("logging-policy-a.json"),
            r#"{"version":1,"revision":3,"max_file_mib":4,"max_files":4}"#,
        )
        .unwrap();
        fs::write(
            dir.join("logging-policy-b.json"),
            r#"{"version":1,"revision":7,"max_file_mib":6,"max_files":3}"#,
        )
        .unwrap();
        let recovered = read_recovered_config(&dir);
        assert_eq!(recovered.status, ConfigStatus::Custom);
        assert_eq!(recovered.policy.max_file_mib, 6);
        assert_eq!(recovered.revision, 7);

        fs::write(
            dir.join("logging-policy-a.json"),
            r#"{"version":1,"revision":7,"max_file_mib":2,"max_files":2}"#,
        )
        .unwrap();
        let tied = read_recovered_config(&dir);
        assert_eq!(tied.policy.max_file_mib, 2);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn one_corrupt_slot_recovers_the_valid_record() {
        let dir = temp_dir();
        fs::write(
            dir.join("logging-policy-a.json"),
            r#"{"version":1,"revision":4,"max_file_mib":8,"max_files":4}"#,
        )
        .unwrap();
        fs::write(dir.join("logging-policy-b.json"), "{not-json").unwrap();
        let recovered = read_recovered_config(&dir);
        assert_eq!(recovered.status, ConfigStatus::Recovered);
        assert_eq!(recovered.policy.max_file_mib, 8);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn both_invalid_slots_fall_back_to_defaults() {
        let dir = temp_dir();
        fs::write(dir.join("logging-policy-a.json"), "{}").unwrap();
        fs::write(
            dir.join("logging-policy-b.json"),
            r#"{"version":2,"revision":1,"max_file_mib":5,"max_files":5}"#,
        )
        .unwrap();
        let recovered = read_recovered_config(&dir);
        assert_eq!(recovered.status, ConfigStatus::InvalidFallback);
        assert_eq!(recovered.policy, LoggingPolicy::DEFAULT);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn oversized_unknown_and_non_integer_records_are_rejected() {
        assert!(parse_slot_bytes(&vec![b'x'; SLOT_MAX_BYTES + 1]).is_err());
        assert!(parse_slot_bytes(
            br#"{"version":1,"revision":1,"max_file_mib":5,"max_files":5,"extra":true}"#
        )
        .is_err());
        assert!(parse_slot_bytes(
            br#"{"version":1,"revision":1,"max_file_mib":5.5,"max_files":5}"#
        )
        .is_err());
        assert!(
            parse_slot_bytes(br#"{"version":1,"revision":1,"max_file_mib":5,"max_files":5}"#)
                .is_ok()
        );
    }

    #[test]
    fn torn_inactive_write_preserves_previous_record() {
        let dir = temp_dir();
        save_policy(&dir, LoggingPolicy::try_from_limits(8, 4).unwrap()).unwrap();
        let first = read_recovered_config(&dir);
        fs::write(
            dir.join(first.authoritative_slot.other().file_name()),
            r#"{"version":1,"revision""#,
        )
        .unwrap();
        let recovered = read_recovered_config(&dir);
        assert_eq!(recovered.policy.max_file_mib, 8);
        assert_eq!(recovered.revision, first.revision);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn revision_overflow_fails_closed() {
        let dir = temp_dir();
        fs::write(
            dir.join("logging-policy-a.json"),
            r#"{"version":1,"revision":18446744073709551615,"max_file_mib":5,"max_files":5}"#,
        )
        .unwrap();
        let err = save_policy(&dir, LoggingPolicy::DEFAULT).unwrap_err();
        assert_eq!(err.code, crate::error::CommandErrorCode::Internal);
        assert_eq!(read_recovered_config(&dir).revision, u64::MAX);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_writes_inactive_slot_and_increments_revision() {
        let dir = temp_dir();
        let first = save_policy(&dir, LoggingPolicy::try_from_limits(3, 3).unwrap()).unwrap();
        let second = save_policy(&dir, LoggingPolicy::try_from_limits(4, 4).unwrap()).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        assert_ne!(first.authoritative_slot, second.authoritative_slot);
        assert_eq!(read_recovered_config(&dir).policy.max_file_mib, 4);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_saves_under_lock_keep_a_single_valid_record() {
        use super::LoggingSaveLock;
        use std::sync::Arc;

        let dir = Arc::new(temp_dir());
        let lock = Arc::new(LoggingSaveLock::new());
        std::thread::scope(|scope| {
            for count in 2..6 {
                let dir = Arc::clone(&dir);
                let lock = Arc::clone(&lock);
                scope.spawn(move || {
                    let _guard = lock.0.blocking_lock();
                    save_policy(
                        dir.as_path(),
                        LoggingPolicy::try_from_limits(count, 2).unwrap(),
                    )
                    .unwrap();
                });
            }
        });
        let recovered = read_recovered_config(dir.as_path());
        assert_eq!(recovered.revision, 4);
        assert_eq!(recovered.status, ConfigStatus::Custom);
        assert!(LoggingPolicy::try_from_limits(
            recovered.policy.max_file_mib,
            recovered.policy.max_files
        )
        .is_ok());
        let _ = fs::remove_dir_all(dir.as_path());
    }
}
