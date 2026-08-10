# Research: Backend Conversation Persistence and Restart Restore

- Query: Locate conversation-history writes, the production database location, desktop/backend startup discovery and read paths, root-cause candidates for restart restore failure, related tests, and validation ideas.
- Scope: mixed (project code plus pinned Tauri/SQL dependency source)
- Date: 2026-08-10

## Findings

### Executive conclusion

The production SQLite database is durable and contains persisted conversation data. The broken link is discovery/rehydration, not the core write transaction:

1. The backend and typed bridge only expose `load_conversation_tree(conversation_id)`; there is no command/repository query that lists or discovers conversation IDs.
2. The conversation ID and normalized tree live only in an in-memory Zustand store whose startup state is empty.
3. `ConversationWorkspace` loads the provider profile on mount, but does not discover or load any conversation.
4. Consequently, after a process restart no layer possesses an ID with which to call the otherwise-working tree loader.

This is directly consistent with the frontend state spec: SQLite is the durable source and conversation records must be reloaded through typed commands rather than browser/Zustand persistence (`.trellis/spec/frontend/state-management.md:5-11`, `:63-70`). The required SQLite rehydration path was never implemented.

### Files found

- `src-tauri/src/database.rs` — owns `sqlite:canopy.db`, the migration catalog, and access to the plugin-managed pool.
- `src-tauri/tauri.conf.json` — fixes the desktop identifier and preloads the production SQLite URL.
- `src-tauri/src/lib.rs` — registers Tauri commands and the SQL plugin during desktop construction.
- `src-tauri/src/conversations/repository.rs` — contains all conversation/node INSERTs and ID-scoped reads.
- `src-tauri/src/conversations/service.rs` — owns atomic write transactions and tree/path read transactions.
- `src-tauri/src/conversations/commands.rs` — defines the complete seven-command conversation IPC surface; every history read requires a conversation ID.
- `src-tauri/src/providers/generation.rs` — commits accepted assistant generations through the conversation persistence service.
- `src/lib/tauri/client.ts` and `src/lib/tauri/schemas.ts` — typed frontend bridge; it mirrors the same seven commands and has no discovery/list method.
- `src/features/conversations/store/index.ts` — in-memory single-conversation projection and explicit ID-based load action.
- `src/features/conversations/components/ConversationWorkspace.tsx` — root feature mount; only provider profile restoration runs at startup.
- `src-tauri/tests/support/mod.rs` — shared persistence tests use `sqlite::memory:`, so they cannot prove close/reopen survival or restart discovery.
- `src-tauri/tests/tree_persistence.rs` — proves same-pool tree round trips and integrity, but not process/pool restart.
- `src/features/conversations/store/store.test.ts` — proves explicit ID-based store loading only.
- `src/features/conversations/components/ConversationWorkspace.test.tsx` and `src/App.test.tsx` — render with pre-seeded store state or the blank new-conversation startup state; neither covers startup discovery.
- `contract-fixtures/conversation-ipc.json` and `src/lib/tauri/client.test.ts` — freeze the exact seven-command IPC contract, confirming that list/discovery is absent.
- `/home/jwh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-sql-2.4.0/src/{lib.rs,wrapper.rs}` — pinned plugin source showing preload, migration, path mapping, and clean shutdown behavior.
- `/home/jwh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/src/path/desktop.rs` — pinned Tauri source defining `app_config_dir` as the OS config directory plus bundle identifier.

### Durable write path

The production URL is one stable constant, `sqlite:canopy.db` (`src-tauri/src/database.rs:6`). The desktop config preloads the exact same URL (`src-tauri/tauri.conf.json:26-29`), and `app_builder` registers the migration catalog with the SQL plugin before running the application (`src-tauri/src/lib.rs:41-58`, `:61-65`). Commands clone the already-managed SQLite pool by the same URL (`src-tauri/src/database.rs:50-55`; `src-tauri/src/conversations/commands.rs:394-403`).

Conversation creation is durable and atomic:

- The command generates stable UUID IDs/time and calls the persistence service (`src-tauri/src/conversations/commands.rs:160-187`).
- The service opens one transaction, inserts the conversation and root node, validates their relationship, and commits (`src-tauri/src/conversations/service.rs:23-55`).
- Repository SQL inserts `conversations` and reads the inserted row back (`src-tauri/src/conversations/repository.rs:12-29`); node writes insert every message field including `created_at` and metadata (`:31-59`).

Later user nodes follow the same transaction boundary (`src-tauri/src/conversations/service.rs:79-124`). Accepted assistant output is also durable: generation completion calls `append_completed_assistant` only after the exact commit acknowledgement (`src-tauri/src/providers/generation.rs:341-370`), and that service validates the assistant then inserts and commits it (`src-tauri/src/conversations/service.rs:251-292`). Thus both sides of ordinary conversation history use the same SQLite `nodes` table.

The schema preserves these rows: `conversations` owns the root and `nodes` stores conversation ownership, role, content, model, timestamp, and metadata (`src-tauri/migrations/0002_conversation_tree.sql:1-28`). Trigger guardrails make node history immutable and reject deletion (`:62-74`, `:87-91`).

### Production storage location and restart behavior

The pinned SQL plugin maps relative SQLite connection strings into Tauri's app config directory: it resolves `app.path().app_config_dir()`, creates the directory, appends the portion after `sqlite:`, creates the database if absent, and connects the pool (`/home/jwh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-plugin-sql-2.4.0/src/wrapper.rs:68-92`, `:316-332`). Tauri 2.11.5 defines `app_config_dir` as `config_dir()/bundle_identifier` (`/home/jwh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/src/path/desktop.rs:235-242`). Canopy's identifier is `app.canopy.desktop` (`src-tauri/tauri.conf.json:3-5`).

Therefore the production file is generically:

```text
<OS config directory>/app.canopy.desktop/canopy.db
```

On this Linux workstation it resolves to `/home/jwh/.config/app.canopy.desktop/canopy.db`. A read-only inspection on 2026-08-10 found:

- a valid SQLite database with all four migrations successful;
- 5 conversations, all unarchived;
- 21 persisted nodes.

This is strong environment-specific evidence that reported history was written and survived process exit. No prompts/message content were inspected for this research. The plugin preload loop connects, runs registered migrations, and stores each pool in managed state (`tauri-plugin-sql-2.4.0/src/lib.rs:145-169`); on `RunEvent::Exit` it closes pools (`:174-183`). Nothing in this startup/shutdown path recreates or clears the file.

### Existing read path and the missing discovery link

The backend can load a complete tree when an ID is already known. `ConversationPersistenceService::load_conversation_tree` opens a transaction, loads one conversation by ID, loads its nodes ordered by `created_at, id`, validates the full tree, and commits (`src-tauri/src/conversations/service.rs:176-195`; `src-tauri/src/conversations/repository.rs:61-72`, `:92-105`). The Tauri command is likewise ID-scoped (`src-tauri/src/conversations/commands.rs:59-63`, `:250-260`, `:450-459`).

However, the conversation command constant is an exhaustive seven-item list with create, mutation, ID-scoped tree/path load, and archive only (`src-tauri/src/conversations/commands.rs:18-26`). Both desktop registration lists omit discovery (`src-tauri/src/lib.rs:8-20`, `:23-38`). The shared IPC fixture freezes the same exact list (`contract-fixtures/conversation-ipc.json:2-10`), and the frontend client mirrors it exactly (`src/lib/tauri/client.ts:34-42`, `:83-175`). Repository search found no `list_conversations` query, DTO, command, schema, or client method.

The frontend then loses the only lookup key at restart:

- Zustand is created without persistence middleware and starts with `conversationId`, `rootNodeId`, and `activeNodeId` all null (`src/features/conversations/store/index.ts:1`, `:167-178`, `:267-272`).
- Its loader works only when a caller supplies an ID (`:569-577`).
- The controller merely exposes that explicit-ID loader (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:390-395`).
- On workspace mount, the only restore effect calls `loadProviderProfile`; there is no conversation effect (`src/features/conversations/components/ConversationWorkspace.tsx:41-77`).
- With `conversationId === null`, the component renders the new-conversation form (`:266-274`). `App` only mounts this workspace (`src/App.tsx:1-8`).

The only production UI call to `controller.loadConversation` is the retry handler, which itself requires the current in-memory ID (`src/features/conversations/components/ConversationWorkspace.tsx:160-163`). After restart that branch cannot run because the ID is null. This makes the restore failure deterministic.

### Ranked root-cause candidates

1. **Confirmed primary: no durable conversation discovery contract.** SQLite has records, but there is no backend list query or typed IPC/client command to retrieve IDs after memory resets. The only reader requires an ID.
2. **Confirmed primary: no startup rehydration action.** Workspace startup restores the provider only; the conversation store remains at its empty in-memory initial state and immediately presents “Start a conversation.”
3. **Likely follow-on display defect: loading a tree always selects its root.** `loadedTreeState` assigns `activeNodeId: tree.rootNodeId` (`src/features/conversations/store/index.ts:180-195`). Because the pane renders only the root-to-active path, an automatically restored multi-message conversation would initially show only the root even after discovery is added. There is no persisted last-active node/branch. The implementation needs an explicit policy: persist a selected active node, or deterministically choose a safe leaf (for example the latest activity leaf).
4. **Ordering contract is missing.** `conversations` has no creation/update timestamp (`src-tauri/migrations/0002_conversation_tree.sql:1-8`; `src-tauri/migrations/0003_conversation_archive.sql:1-3`). A history list can derive created/latest activity from node timestamps, but ordering, archived inclusion, and tie-breaks must be specified. Do not depend on SQLite `rowid` as a product contract.
5. **Low-probability compatibility risk, not supported as the current root cause: config/identifier drift.** The physical path depends on OS config-dir resolution plus `app.canopy.desktop`. Changing the identifier or launching a differently configured build would point at a different file. Current config, pinned plugin behavior, and the populated expected file all align, so there is no evidence of path drift in the reported environment.
6. **Unlikely: SQL preload race or database clearing.** Plugin setup synchronously connects/migrates/manages the pool before normal command use, and shutdown only closes it. Existing rows after restart contradict a destructive-startup explanation.

### Related tests and current gaps

- `src-tauri/tests/tree_persistence.rs:275-356` proves deterministic tree/path round trips, but the write and read share the same in-memory pool.
- `src-tauri/tests/tree_persistence.rs:422-479` proves archived trees remain readable, again in one pool lifetime.
- All shared persistence fixtures use `sqlite::memory:` (`src-tauri/tests/support/mod.rs:13-37`), so closing/reopening a file is not exercised.
- `src-tauri/tests/command_boundary.rs:432-483` is the only file-backed SQLite test found; it tests lock error mapping and deletes the temporary file, not restart persistence.
- `src/features/conversations/store/store.test.ts:128-159` proves an explicit-ID tree load and selected-path behavior, but the test supplies the ID itself.
- `src/features/conversations/components/ConversationWorkspace.test.tsx:195-219` preloads the store before rendering. It does not simulate a fresh module/store plus backend history.
- `src/App.test.tsx:18-27` explicitly expects the blank “Start a conversation” state and mocks no conversation restore behavior.
- `src/lib/tauri/client.test.ts:40-93` asserts the exact seven-command list; a new discovery command requires updating the shared fixture and both Rust/TypeScript contract checks.
- No test found closes a production-shaped pool, constructs a second pool against the same file, discovers conversations, and loads their nodes. No test found asserts conversation discovery on workspace mount.

### Recommended validation design

1. **Backend file-reopen regression (root-cause test).** Create a uniquely named temporary SQLite file, apply the real `MIGRATION_CATALOG`, create two conversations and several nodes through `ConversationPersistenceService`, close/drop pool A, open pool B on the same file, then call the new discovery service followed by `load_conversation_tree`. Assert exact summaries, IDs, archive flags, deterministic ordering, and exact node bytes/order. The test should fail before the discovery API exists and prove actual cross-pool durability after the fix.
2. **Repository/service discovery tests.** Cover empty DB, multiple active/archived conversations, deterministic latest-activity/tie ordering, invalid stored data, and that listing does not need or return message content. If timestamps are derived from nodes, assert root-only and multi-node conversations explicitly.
3. **Cross-layer IPC contract.** Add the discovery command to `CONVERSATION_COMMAND_NAMES`, Tauri registration, Rust DTO fixture decoding/serialization, `conversation-ipc.json`, Zod schemas, client mapping, and `client.test.ts`. Assert the command uses the plugin-managed pool and preserves the stable error contract.
4. **Fresh-start frontend regression.** Render `ConversationWorkspace` from the untouched empty store with a mock client whose discovery result contains persisted conversations. Assert discovery is invoked once (React StrictMode-safe), the selected conversation tree is loaded, the history list appears in the agreed order, and the visible path contains the expected messages without duplicates or sibling bleed.
5. **Empty/error/archive frontend cases.** Empty discovery should retain the new-conversation form. Retryable database errors should show a retry path without fabricating or clearing history. Define whether archived items are visible and verify they remain read-only.
6. **Active-path restore regression.** Seed a branched tree where the root is not the desired visible endpoint. Assert the agreed active-node policy restores a complete root-to-leaf path and excludes sibling sentinels. If adding a persisted cursor, test compatibility/backfill when existing conversations have no cursor.
7. **Manual packaged smoke test.** Create/send in a packaged or debug desktop app, record only non-sensitive IDs/counts, fully exit, relaunch, and verify the same config file is used, the list is auto-discovered, and each selected tree has the same message count/order. Run once for development and packaged launch to catch identifier/config drift.

### Compatibility-oriented implementation shape

- Prefer a read-only `list_conversations` repository/service/command over persisting conversation rows in browser storage. This follows the existing SQLite ownership contract.
- Existing databases already have sufficient conversation and node data. A list query can be compatible without destructive migration by joining/aggregating node timestamps. If durable active-node or explicit conversation timestamps are added, use a forward migration with deterministic backfill; never require deleting `canopy.db`.
- Keep discovery summaries narrow (ID, title, archive state, agreed activity timestamp/cursor fields), then load the selected full tree through the existing validated tree reader.
- Specify list ordering and active-node selection before implementation; those choices affect whether “restored” history is visibly complete and deterministic.

### External references and versions

- `tauri-plugin-sql` is declared and locked at 2.4.0 (`src-tauri/Cargo.toml:28-31`; `src-tauri/Cargo.lock:4803-4807`). The pinned crate source cited above is authoritative for this build's app-config path mapping, preload, migration, and shutdown behavior.
- Direct `sqlx` is 0.8.6 (`src-tauri/Cargo.toml:28`; `src-tauri/Cargo.lock:4261-4265`).
- `tauri` resolves to 2.11.5 in the lockfile (`src-tauri/Cargo.lock:4653-4657`), despite the compatible `2.11.3` manifest requirement (`src-tauri/Cargo.toml:29`, `:39`). The pinned Tauri source cited above is authoritative for this build's `app_config_dir` behavior.

### Related specs

- `.trellis/spec/backend/database-guidelines.md:145-172` — implemented persistence surface and plugin-managed-pool ownership; notably contains no conversation listing operation.
- `.trellis/spec/backend/database-guidelines.md:497-509` — SQL plugin is the single preloader/migration runner and released data requires forward-compatible migrations.
- `.trellis/spec/backend/quality-guidelines.md:31-44`, `:64-83` — real-migration tests, deterministic IDs/timestamps, and cross-layer DTO fixtures.
- `.trellis/spec/frontend/state-management.md:5-11`, `:48-72` — Zustand owns one loaded projection, SQLite is durable authority, and rehydration must occur through typed commands rather than browser persistence.
- `.trellis/spec/frontend/hook-guidelines.md:58-71`, `:77-85` — typed bridge effects, stale async completion handling, and deterministic hook tests.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:7-53` — map source/store/retrieve/display boundaries and keep one typed payload owner.

## Caveats / Not Found

- There is no current product contract for which conversation should auto-open, history-list ordering, archived visibility, or which branch/active node should be restored. These are required design decisions, not facts recoverable from current code.
- The on-disk counts are a one-workstation diagnostic observation, not an automated test and not a guarantee about other users' paths. The generic path is OS config directory plus the fixed bundle identifier.
- No conversation-list UI exists in the inspected source; the current sidebar is an outline for one loaded tree, not a history/conversation list.
- No evidence was found that writes are lost, migrations clear data, the configured identifier changes between desktop launches, or the SQL plugin opens an in-memory production database.
