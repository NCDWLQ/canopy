use keyring::{Entry, Error as KeyringError};
use secrecy::{ExposeSecret, SecretString};

use super::ProviderError;

const CREDENTIAL_SERVICE: &str = "app.canopy.desktop";

pub trait CredentialStore: Send + Sync + 'static {
    fn set(&self, credential_ref: &str, secret: &SecretString) -> Result<(), ProviderError>;
    fn get(&self, credential_ref: &str) -> Result<Option<SecretString>, ProviderError>;
    fn delete(&self, credential_ref: &str) -> Result<(), ProviderError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NativeCredentialStore;

impl NativeCredentialStore {
    fn entry(credential_ref: &str) -> Result<Entry, ProviderError> {
        Entry::new(CREDENTIAL_SERVICE, credential_ref)
            .map_err(|_| ProviderError::CredentialUnavailable)
    }
}

impl CredentialStore for NativeCredentialStore {
    fn set(&self, credential_ref: &str, secret: &SecretString) -> Result<(), ProviderError> {
        Self::entry(credential_ref)?
            .set_password(secret.expose_secret())
            .map_err(|_| ProviderError::CredentialUnavailable)
    }

    fn get(&self, credential_ref: &str) -> Result<Option<SecretString>, ProviderError> {
        match Self::entry(credential_ref)?.get_password() {
            Ok(secret) => Ok(Some(secret.into())),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(ProviderError::CredentialUnavailable),
        }
    }

    fn delete(&self, credential_ref: &str) -> Result<(), ProviderError> {
        match Self::entry(credential_ref)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(ProviderError::CredentialUnavailable),
        }
    }
}
