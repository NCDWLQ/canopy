# Backend Module Refactor Audit

> Audited at commit `ab7349a` on 2026-08-27. Repository content was treated as data. No source code was modified during the audit.

## Scope and Baseline

- Stack: React/TypeScript frontend with a Tauri 2 / Rust backend and SQLite via `tauri-plugin-sql`.
- Backend size: 7,653 Rust lines under `src-tauri/src`; `conversations` is about 2,474 lines and `providers` about 4,467 lines.
- Verified command: `cargo test --manifest-path src-tauri/Cargo.toml --all-features`.
- Baseline result: 108 Rust tests passed, 0 failed.
- Existing coverage includes real ordered migrations, command/DTO fixtures, provider credential reconciliation, protocol loopback HTTP, generation persistence/races, search and tree integrity.

## Vetted Findings

### ARCH-01 — Remove the business dependency cycle first

- **Evidence**: `src-tauri/src/conversations/commands.rs:14` imports provider model validation; `src-tauri/src/providers/generation.rs:11-14` imports conversation domain/service/command types; `src-tauri/src/providers/error.rs:3-4` wraps conversation persistence errors; `src-tauri/src/database.rs:4-5` returns a conversation-owned error.
- **Impact**: physical file moves cannot produce independent modules while both business domains and the shared database adapter know each other's internals.
- **Effort**: L.
- **Risk**: HIGH because error mapping and generation are critical paths.
- **Confidence**: HIGH.
- **Recommendation**: extract platform database/identity boundaries, then move cross-domain orchestration into `generation` so core domains become acyclic.

### ARCH-02 — Promote generation to a top-level application module

- **Evidence**: `src-tauri/src/providers/commands.rs:570-658` owns generation IPC and Channel orchestration; `src-tauri/src/providers/generation.rs:167-355` combines runtime lease, conversation context, provider snapshot, HTTP, final persistence and cancellation; `src-tauri/src/providers/titles.rs:40-109` combines settings, conversation persistence, provider HTTP and Tauri events.
- **Impact**: provider profile changes, protocol changes, reply lifecycle changes and title workflow changes all modify one module and one oversized error type.
- **Effort**: L.
- **Risk**: HIGH because Started/Delta/ThinkingDelta ordering, cancellation/finalization races and exactly-once persistence are externally visible.
- **Confidence**: HIGH.
- **Recommendation**: `generation` owns runtime/orchestration/title workflows and a `GenerationError`; it composes `conversations`, `providers`, `settings` and `llm` without reverse imports.

### ARCH-03 — Extract typed settings storage and services

- **Evidence**: `src-tauri/src/providers/repository.rs:8-12` defines five unrelated setting keys and `:177-227` owns generic settings SQL; `src-tauri/src/providers/service.rs:72-197` owns automatic title, language and theme; `src-tauri/src/providers/commands.rs:153-163` exposes them in `list_providers`.
- **Impact**: unrelated UI preferences expand provider domain/service/locking and make the provider response the accidental application-settings API.
- **Effort**: M.
- **Risk**: MED because title binding cleanup must remain transactional with provider updates/deletes.
- **Confidence**: HIGH.
- **Recommendation**: create typed `settings` domain/repository/service; keep a compatibility aggregator for the frozen `list_providers` wire response.

### ARCH-04 — Separate LLM protocol transport from provider persistence

- **Evidence**: `src-tauri/src/providers/anthropic.rs`, `openai_compatible.rs` and `model_list.rs` contain HTTP/protocol behavior, while `domain.rs`, `repository.rs`, `credentials.rs` and `service.rs` contain profile and keyring persistence.
- **Impact**: the current module groups code by the word “provider” even though profile persistence and model inference transport change for different reasons.
- **Effort**: M.
- **Risk**: MED because request bodies, streaming parsers, endpoint policy and error mapping are security/correctness boundaries.
- **Confidence**: HIGH.
- **Recommendation**: move protocol, endpoint validation, transport-neutral prompt types, adapters and model discovery into DB-free/Tauri-free `llm`; retain explicit enum dispatch.

### TEST-01 — Test the production command registry, not a copied list

- **Evidence**: `src-tauri/src/lib.rs:8-28` defines a test-only conversation registry while `:30-59` defines production registration; `:110` tests the copy. Only a subset of provider commands receive mock IPC registration checks (`:221`, `:261`, `:313`).
- **Impact**: a command can be dropped from production registration while copied-list tests remain green.
- **Effort**: M.
- **Risk**: LOW.
- **Confidence**: HIGH.
- **Recommendation**: make production registration the only handler builder and probe every frozen command through it before moving handlers.

### TEST-02 — Add command-level generation and auto-title characterization

- **Evidence**: `src-tauri/tests/provider_contract.rs:88` verifies serde shapes but not actual generation command sequencing; `src-tauri/src/providers/titles.rs:190+` tests title cleanup only; `.trellis/spec/backend/provider-guidelines.md` requires the full automatic-title workflow.
- **Impact**: module moves can silently lose event order, failure stage, exactly-once persistence, title task start, DB update or global emit while lower-level tests remain green.
- **Effort**: M.
- **Risk**: MED for generation, LOW for title behavior.
- **Confidence**: HIGH.
- **Recommendation**: establish narrow injectable command/title seams and characterize current behavior before relocating the implementations.

### ARCH-05 — Move export ownership without changing its compatibility quirk

- **Evidence**: `src-tauri/src/conversations/commands.rs:525-530` performs pure file output, but the Tauri handler at `:907-914` first resolves the managed database; existing mock IPC tests expect database failure for this command.
- **Impact**: file export is unrelated to conversation persistence and inflates a 1,041-line command file.
- **Effort**: S.
- **Risk**: LOW if the current database preflight is intentionally retained.
- **Confidence**: HIGH.
- **Recommendation**: move DTO/policy/handler to `exports`, preserve the DB availability check in this task, and consider removing it only in a later behavior-change task.

### DOCS-01 — Update stale architecture specs after implementation

- **Evidence**: `.trellis/spec/backend/directory-structure.md` still shows an early minimal provider adapter; provider/type-safety/error specs contain pre-multi-provider command and event descriptions.
- **Impact**: implementation agents may follow obsolete ownership and accidentally restore the legacy structure.
- **Effort**: S.
- **Risk**: LOW.
- **Confidence**: HIGH.
- **Recommendation**: update specs after the new boundaries pass final validation, preserving historical runtime invariants.

## Test Assets to Preserve

- `src-tauri/tests/tree_persistence.rs` and `multi_provider_migration.rs`: schema/migration/data compatibility.
- `src-tauri/tests/provider_profile.rs`: keyring isolation, credential operation recovery and provider-setting interactions.
- `src-tauri/tests/provider_http.rs` and `anthropic_http.rs`: endpoint, header, redirect, SSE and error semantics.
- `src-tauri/tests/generation_persistence.rs` plus generation unit tests: archive/role validation, cancellation/finalization races and exactly-once persistence.
- `src-tauri/tests/command_boundary.rs`, `provider_contract.rs` and `contract-fixtures/provider-ipc.json`: command names, DTOs and errors.
- `src/lib/tauri/client.test.ts`, `provider-client.test.ts`, `title-events.test.ts`: frontend decoding/state-machine compatibility.

## Deliberately Deferred or Rejected

- **New migration to clear stale conversation model values**: valid data-quality improvement, rejected for this task because the user selected schema-neutral behavior preservation. Plan separately with released-schema upgrade tests.
- **Remove database availability from `write_export_file`**: valid correctness improvement, rejected here because it changes an externally tested error path.
- **Dynamic provider trait/plugin system**: not justified for two protocols; the existing explicit enum-match decision remains appropriate.
- **Top-level search module**: search is a cohesive conversation capability, not an independent domain.
- **Windows “DO NOT REMOVE” source comment as a security finding**: rejected as a conventional maintenance comment with no runtime security impact.

## Migration File Baseline

```text
36d658e39c2142d5cdf5601696b96508eaae4e993f5cf79ba5db02a9686bd046  0001_bootstrap.sql
c80730e97cc516197830598c3491f8da035fa7f94307228abb9e749f60361ee2  0002_conversation_tree.sql
e3961f6a8e3031720691b1a9623f147b3d26e429a32c5e7277005f6937f89f9c  0003_conversation_archive.sql
5bdb11745ecbd427b5cd8dfbf53a3cbc840d193b142c716fc3bf5930ea0baca5  0004_provider_profile.sql
a4276bc14f6549ff6e8f03102fc06db7f015464a8896fc6851078f7440a52f1e  0005_multi_provider.sql
d5d622c1bde75af535551c4e6a601d97270155e502c7255997f20b23ff871861  0006_provider_models.sql
```

