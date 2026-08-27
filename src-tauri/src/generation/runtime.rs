use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tokio_util::sync::CancellationToken;

use super::GenerationError;

struct GenerationEntry {
    generation_id: String,
    cancellation: CancellationToken,
    phase: GenerationPhase,
}

enum GenerationPhase {
    Running,
    Finalizing,
    Cancelling,
}

#[derive(Clone)]
pub struct GenerationRuntime {
    entries: Arc<Mutex<HashMap<String, GenerationEntry>>>,
}

impl Default for GenerationRuntime {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl GenerationRuntime {
    pub fn reserve(
        &self,
        conversation_id: String,
        generation_id: String,
    ) -> Result<GenerationLease, GenerationError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| GenerationError::RuntimeInvariant)?;
        if entries.contains_key(&conversation_id) {
            return Err(GenerationError::AlreadyActive);
        }
        if entries
            .values()
            .any(|entry| entry.generation_id == generation_id)
        {
            return Err(GenerationError::RuntimeInvariant);
        }

        let cancellation = CancellationToken::new();
        entries.insert(
            conversation_id.clone(),
            GenerationEntry {
                generation_id: generation_id.clone(),
                cancellation: cancellation.clone(),
                phase: GenerationPhase::Running,
            },
        );
        Ok(GenerationLease {
            runtime: self.clone(),
            conversation_id,
            generation_id,
            cancellation,
        })
    }

    pub fn cancel(&self, generation_id: &str) -> Result<bool, GenerationError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| GenerationError::RuntimeInvariant)?;
        let Some(entry) = entries
            .values_mut()
            .find(|entry| entry.generation_id == generation_id)
        else {
            return Ok(false);
        };
        if !matches!(entry.phase, GenerationPhase::Running) {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Cancelling;
        entry.cancellation.cancel();
        Ok(true)
    }

    pub fn begin_finalizing(&self, generation_id: &str) -> Result<bool, GenerationError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| GenerationError::RuntimeInvariant)?;
        let Some(entry) = entries
            .values_mut()
            .find(|entry| entry.generation_id == generation_id)
        else {
            return Ok(false);
        };
        if !matches!(entry.phase, GenerationPhase::Running) || entry.cancellation.is_cancelled() {
            return Ok(false);
        }
        entry.phase = GenerationPhase::Finalizing;
        Ok(true)
    }

    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.entries.lock().map_or(0, |entries| entries.len())
    }

    #[cfg(test)]
    pub(crate) fn is_finalizing(&self, generation_id: &str) -> bool {
        self.entries.lock().is_ok_and(|entries| {
            entries.values().any(|entry| {
                entry.generation_id == generation_id
                    && matches!(entry.phase, GenerationPhase::Finalizing)
            })
        })
    }
}

pub struct GenerationLease {
    runtime: GenerationRuntime,
    conversation_id: String,
    generation_id: String,
    cancellation: CancellationToken,
}

impl GenerationLease {
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }

    pub(crate) fn begin_finalizing(&self) -> Result<bool, GenerationError> {
        self.runtime.begin_finalizing(&self.generation_id)
    }
}

impl Drop for GenerationLease {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.runtime.entries.lock() {
            if entries
                .get(&self.conversation_id)
                .is_some_and(|entry| entry.generation_id == self.generation_id)
            {
                entries.remove(&self.conversation_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::GenerationRuntime;

    const GENERATION_A: &str = "11111111-1111-4111-8111-111111111111";
    const GENERATION_B: &str = "33333333-3333-4333-8333-333333333333";

    #[test]
    fn runtime_is_per_conversation_and_cancel_is_exact_and_one_shot() {
        let runtime = GenerationRuntime::default();
        let first = runtime
            .reserve("conversation-a".to_owned(), GENERATION_A.to_owned())
            .unwrap();
        let second = runtime
            .reserve("conversation-b".to_owned(), GENERATION_B.to_owned())
            .unwrap();
        assert!(runtime
            .reserve("conversation-a".to_owned(), GENERATION_B.to_owned())
            .is_err());
        assert!(runtime
            .reserve("conversation-c".to_owned(), GENERATION_B.to_owned())
            .is_err());
        assert!(!runtime.cancel("unknown").unwrap());
        assert!(runtime.cancel(GENERATION_A).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(first.cancellation().is_cancelled());
        assert!(!second.cancellation().is_cancelled());
        drop(first);
        drop(second);
        assert_eq!(runtime.active_count(), 0);
    }

    #[test]
    fn finalization_wins_cancel_race_and_holds_the_slot() {
        let runtime = GenerationRuntime::default();
        let lease = runtime
            .reserve("conversation".to_owned(), GENERATION_A.to_owned())
            .unwrap();
        assert!(runtime.begin_finalizing(GENERATION_A).unwrap());
        assert!(!runtime.cancel(GENERATION_A).unwrap());
        assert!(runtime
            .reserve("conversation".to_owned(), GENERATION_B.to_owned())
            .is_err());
        drop(lease);
        assert!(runtime
            .reserve("conversation".to_owned(), GENERATION_B.to_owned())
            .is_ok());
    }
}
