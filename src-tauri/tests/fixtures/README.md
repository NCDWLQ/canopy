# v0.4.0 released database fixture

## Provenance

| Field             | Value                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Release tag       | `v0.4.0`                                                                                                                            |
| Release commit    | `cc8cc83` (`chore(release): sync Cargo.lock to 0.4.0`)                                                                              |
| Schema migrations | `0001`–`0006` (identical SQL bytes to tag `v0.4.0`)                                                                                 |
| Generator         | production `register_sql_plugin` + `plugins.sql.preload = ["sqlite:canopy.db"]` via Tauri mock app, then non-sensitive seed INSERTs |
| Fixture file      | `canopy-v0.4.0.db`                                                                                                                  |
| Fixture SHA-256   | `0deeb7d62dd3b33710039ec608b9b592f482e74b66e1eabc530313024ffd8442`                                                                  |

## Migration ledger (SQLx SHA-384 of SQL bytes)

| Version | Description          | SHA-384 (hex)                                                                                      |
| ------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| 1       | bootstrap            | `117677d64c216c159b21721a1bae58441c9c285f1cadb9b81174593ea259eba7fcadc15cf1b91fe2347bde0db4f0dc2e` |
| 2       | conversation_tree    | `dee9c8efdfe629592b314e78c05a5ae973850fb2a035c2b69ba3255331f5c55cad15308f53fb7204385881b3659640e2` |
| 3       | conversation_archive | `2fbb1d19e683a21cfc6e3e6752c51ceacd3c5a44474822b5606c2f075298dc8721cf7a2a7f64dd2d481575870b6c4063` |
| 4       | provider_profile     | `e739b4dd0771c817b43d94c33cc23bf837bbfceff64c3b7e86169a1d98de7e6153d81368097e0838b66fbf3a2984480a` |
| 5       | multi_provider       | `1e27faf0f41d0ec9e136689dbc6508e21652fbe3ff1d00d8d1a8b469d860b442d4e49488e711781046b8a56c43965441` |
| 6       | provider_models      | `2636f46d47b58de534242c2e2b167b14577982f6c846b037de8fe7e02443d71c61e0b9070c7a8f2314770e76641f2b50` |

Verify with `sha256sum tests/fixtures/canopy-v0.4.0.db` and
`SELECT version, hex(checksum) FROM _sqlx_migrations ORDER BY version`.

## Seed manifest (non-sensitive)

- **Provider** `provider-fixture-a`: OpenAI-compatible, model `fixture-model`, credential ref `test-credential-ref-placeholder` (placeholder only; no keyring secret).
- **Settings**: `active_provider_id=provider-fixture-a`, `language=zh-CN`, `theme=system`.
- **Bound conversation** `conversation-bound`: root `node-bound-root` + assistant child `node-bound-assistant`; binding `(provider-fixture-a, fixture-model, medium)`.
- **Stale binding baseline** `conversation-stale-binding`: root `node-stale-root`;
  fixture stores `(NULL, stale-orphan-model, low)`. Forward migration `0007`
  clears the orphan `model` on upgrade; the versioned fixture itself is never
  rewritten.
- **Content**: synthetic fixture strings only (`fixture user root`, etc.). No API keys, real user prompts, or host paths.

## Safety checks recorded at generation

- `PRAGMA foreign_key_check` empty.
- `strings canopy-v0.4.0.db` shows no `sk-` / `api_key` / home-directory path markers.
- Tests always `fs::copy` this file into a unique workspace-local temp app-config directory; the versioned bytes are never opened for write.

## Regenerate (maintainers only)

```bash
CANOPY_WRITE_V040_FIXTURE=1 cargo test --manifest-path src-tauri/Cargo.toml \
  --test generate_v040_fixture -- --ignored --nocapture
```

Only regenerate from migration SQL that still matches tag `v0.4.0` checksums above, then update this README’s fixture SHA-256.
