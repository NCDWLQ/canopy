# Phase 6 implementation notes

Recorded 2026-08-27 after shim removal. These are verified implementation
details, not new product decisions.

## Combined files (allowed by design.md)

- Provider wire DTOs live in `providers/commands.rs` beside the permanent
  `list_providers` façade. There is no `providers/dto.rs`.
- Settings errors live in `settings/error.rs`.

## Permanent mappings that look like shims

- `SettingsError::CorruptValue` still maps to `CommandError` through
  `ProviderError::Llm(LlmError::Protocol)` so the wire envelope stays
  `provider_unavailable` / `服务提供商当前不可用。` / retryable. This is the
  historical mapping required by the PRD, not a temporary re-export.
- `list_providers` remains the aggregate IPC façade (providers + active +
  auto-title + title binding + language + theme).
- `write_export_file` retains the managed-database preflight.
- Fixture catalogs `CONVERSATION_COMMAND_NAMES` / `PROVIDER_COMMAND_NAMES`
  still list moved command names so frozen fixtures stay byte-compatible.

## Deferred (unchanged)

- Removing export's database preflight.
- A migration to clear stale conversation `model` values after provider
  deletion.
- Dynamic protocol plugins.
- Frontend API regrouping.
