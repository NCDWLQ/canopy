CREATE TABLE usage_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  node_id       TEXT,
  source        TEXT NOT NULL
                  CHECK (source IN ('chat', 'title')),
  provider_id   TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens  INTEGER,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX idx_usage_records_provider_model ON usage_records(provider_id, model);
