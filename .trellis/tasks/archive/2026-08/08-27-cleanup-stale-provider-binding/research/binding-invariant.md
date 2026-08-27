# Conversation Provider Binding Invariant Research

## Existing Schema and Behavior

- `src-tauri/migrations/0005_multi_provider.sql:54-58` adds `provider_id` with `ON DELETE SET NULL`, plus an independent nullable `model` and `reasoning_effort`.
- `src-tauri/src/conversations/dto.rs:217-223` hides `model` whenever `provider_id` is `NULL`, proving the database may contain a stale value.
- `src-tauri/src/generation/service.rs:80-118` validates that provider/model are both present or both absent and writes them in one transaction.
- `src-tauri/src/providers/service.rs:286-301` deletes providers without credentials directly; `:481-493` deletes credential-operation rows and providers during reconcile. Both converge on `ProviderRepository::delete_provider`.
- `src-tauri/tests/multi_provider_migration.rs` explicitly records the current post-delete state as `(None, Some("fixture-model"), Some("low"))` after migration 5.

## Chosen Ownership

The defect is caused by a referential lifecycle event, so prevention belongs in the migration/schema boundary rather than duplicated service cleanup. A `BEFORE DELETE ON providers` trigger can clear both conversation binding columns for every deletion path before the foreign-key action runs.

The existing generation service already rejects mismatched pairs for supported set/clear commands. This task does not add broad INSERT/UPDATE guards or rebuild the conversations table; it repairs released data and fixes provider-delete behavior only.

## Migration Shape

1. Normalize existing rows with `provider_id IS NULL` by setting `model = NULL`.
2. Create a named `BEFORE DELETE` trigger on `providers` that updates matching conversations to `provider_id = NULL, model = NULL`.
3. Leave `reasoning_effort` untouched.

This is forward-compatible with rolling application code back: old code already treats a null provider/model binding as “follow global provider”.
