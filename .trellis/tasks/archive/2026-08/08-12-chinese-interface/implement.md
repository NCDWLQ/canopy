# Implementation Plan

## 1. Establish the baseline

- [x] Confirm the working tree contains only this task's planned changes before product edits.
- [x] Run focused existing frontend tests to establish the current baseline for affected components.
- [x] Treat `research/copy-catalog.md` as the approved source of truth for every product-copy replacement.
- [x] Search every exact English value before replacing it, including test expectations and shared defaults.

## 2. Localize document and shared UI defaults

- [x] Change the HTML language declaration to `zh-CN`.
- [x] Translate dialog close and spinner loading accessible defaults without changing primitive behavior.

## 3. Localize conversation UI

- [x] Translate workspace/history/sidebar copy, tooltips, states, generation/archive controls and composer reasons.
- [x] Translate composer, pane, outline and message branch/edit copy, including accessible names.
- [x] Present role enums through an exhaustive Chinese label map while retaining canonical enum values.
- [x] Keep the existing Chinese generation lifecycle copy and align terminology.

## 4. Localize global settings

- [x] Translate settings and provider configuration copy, alerts, fields, helper text, actions and confirmation dialogue.
- [x] Preserve technical names and values such as OpenAI, API, URLs and model IDs.

## 5. Localize errors without changing contracts

- [x] Translate frontend-created invalid-input, internal, tree-integrity, reconciliation and availability messages at their current owners.
- [x] Translate centralized Rust `CommandError` safe summaries while preserving codes, retryability, details and serialized shape.
- [x] Stop rendering raw machine error codes in the user-facing error heading.
- [x] Update affected IPC/runtime fixtures only where their messages represent production output; retain arbitrary transport fixtures when they intentionally test preservation.

## 6. Update tests

- [x] Update component and integration queries/assertions to Chinese accessible copy while preserving behavioral coverage.
- [x] Update store, hook and bridge expectations for translated local errors.
- [x] Update Rust serialization/mapping tests for translated runtime summaries.
- [x] Retain tree branch isolation, archived/read-only behavior, secret clearing/redaction and generation lifecycle coverage.

## 7. Audit and validate

- [x] Run targeted searches for English user-facing literals and manually classify remaining matches against the allowed list.
- [x] Run task-owned Prettier checks. Full `pnpm format:check` is blocked only by the pre-existing, out-of-scope `.claude/settings.local.json`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [x] Review the final diff for product-copy consistency and accidental contract changes.

## Risky files and rollback points

- `src-tauri/src/error.rs`: message-only edits; stop if code/retryability/details or serialization shape changes.
- `src/lib/tauri/*`: local fallback messages and tests only; do not weaken Zod validation or error preservation.
- Conversation generation/store files: copy-only changes; do not alter state transitions or timers.
- Shared UI primitives: accessible-label-only changes; do not modify Radix composition.
- Roll back the single localization commit if a behavioral regression is found; there is no data migration to undo.
