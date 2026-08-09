CREATE TABLE IF NOT EXISTS _canopy_bootstrap (
  version INTEGER PRIMARY KEY CHECK (version > 0)
);

INSERT OR IGNORE INTO _canopy_bootstrap (version) VALUES (1);
