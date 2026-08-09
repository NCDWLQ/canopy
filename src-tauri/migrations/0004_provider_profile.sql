CREATE TABLE provider_profiles (
  id             TEXT PRIMARY KEY CHECK (id = 'default'),
  base_endpoint  TEXT NOT NULL,
  model          TEXT NOT NULL,
  credential_ref TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE provider_credential_operations (
  id                 TEXT PRIMARY KEY,
  operation          TEXT NOT NULL CHECK (operation IN ('save', 'delete')),
  base_endpoint      TEXT,
  model              TEXT,
  new_credential_ref TEXT,
  old_credential_ref TEXT,
  updated_at         INTEGER,
  CHECK (
    (operation = 'save' AND base_endpoint IS NOT NULL AND model IS NOT NULL AND updated_at IS NOT NULL)
    OR
    (operation = 'delete' AND base_endpoint IS NULL AND model IS NULL AND new_credential_ref IS NULL AND updated_at IS NULL)
  )
);
