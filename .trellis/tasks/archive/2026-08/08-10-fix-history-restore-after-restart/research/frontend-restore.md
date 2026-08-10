# Research: Frontend conversation restore after application restart

- Query: Trace frontend/application startup, conversation history discovery, typed IPC, and Zustand hydration to explain why history works during one process but is unavailable after restart. Identify exact evidence, regression tests, and validation steps.
- Scope: mixed (frontend startup/state plus the native command boundary required by frontend discovery)
- Date: 2026-08-10

## Findings

### Root cause (high confidence)

The durable records may still exist in SQLite, but the application has no way to discover their conversation IDs after a fresh renderer starts. The current frontend can load a tree only when a caller already possesses its ID. No list/recent-conversation command, startup restore effect, conversation-list state, browser-persisted cursor, or conversation event listener exists.

The complete current data flow is:

```text
create_conversation
  -> authoritative ConversationTreeView
  -> Zustand loadedTreeState
  -> usable for the lifetime of this renderer

process/webview restart
  -> module re-evaluation
  -> Zustand initialState (conversationId = null)
  -> ConversationWorkspace renders NewConversationForm
  -> no conversation discovery/load command is issued
```

This directly explains the symptom split:

- During the session, `createConversation` awaits the typed client and installs the returned tree in Zustand (`src/features/conversations/store/index.ts:580-587`). The controller also retains the authoritative returned IDs for generation (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:370-388`).
- On a fresh application process, the store is rebuilt from `initialState`, whose conversation/root/active IDs are all `null` and whose normalized maps are empty (`src/features/conversations/store/index.ts:167-178`). The store is created without Zustand persist middleware (`src/features/conversations/store/index.ts:267-272`), which agrees with the project rule that SQLite, not browser storage, is authoritative (`.trellis/spec/frontend/state-management.md:5-11`, `63-68`).
- The root renders only `App` (`src/main.tsx:13-16`), and `App` only renders `ConversationWorkspace` (`src/App.tsx:3-7`). The workspace's sole startup effect loads the provider profile, not conversations (`src/features/conversations/components/ConversationWorkspace.tsx:75-77`).
- With the clean store, `ConversationWorkspace` chooses `NewConversationForm` whenever `conversationId === null` (`src/features/conversations/components/ConversationWorkspace.tsx:266-275`). Its empty sidebar says "No conversation loaded" (`src/features/conversations/components/ConversationWorkspace.tsx:180-197`). There is no conversation-history list component or load affordance; `OutlineTree` is a node tree for one already-loaded conversation (`src/features/conversations/components/OutlineTree.tsx:6-13`, `89-97`).
- The controller exposes `loadConversation(id)`, but still requires an externally supplied ID (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:36-50`, `390-395`). In production component code, its only call is retrying the ID already present in the store (`src/features/conversations/components/ConversationWorkspace.tsx:160-163`). Repository-wide call-site search shows all other loads are tests or generation reconciliation.
- The typed frontend client freezes exactly seven commands and has only `loadConversationTree(conversationId)` for reads (`src/lib/tauri/client.ts:34-42`, `143-152`). The request schema and method cannot discover unknown IDs. The shared fixture confirms there is no list/recent command (`contract-fixtures/conversation-ipc.json:2-10`, `31-40`).
- The native boundary has the same limitation. Its frozen command list contains seven commands and no list/discovery operation (`src-tauri/src/conversations/commands.rs:18-26`); `LoadConversationTreeRequest` requires `conversation_id` (`src-tauri/src/conversations/commands.rs:59-63`); Tauri registers only those per-ID conversation commands (`src-tauri/src/lib.rs:23-38`).
- The repository can select one conversation by ID and all nodes for that ID (`src-tauri/src/conversations/repository.rs:61-73`, `92-105`), but has no query that enumerates conversations. Thus this cannot be fixed entirely in the React mount effect unless the ID is stored in a second, less authoritative location.
- Conversation history hydration is command/pull-based, not event-based. The only Tauri `Channel` in this source tree is provider generation (`src/lib/tauri/provider-client.ts:45-51`, `179-187`; `src-tauri/src/providers/commands.rs:223`). No conversation `listen`/event subscription can repopulate state on startup.

### Why a localStorage-only fix is insufficient

Persisting only the last ID in the webview might make one recent conversation load, but it would not discover all existing SQLite conversations, would fail if webview storage is cleared/migrated, and would not satisfy restoration of a conversation list. Persisting conversation records themselves is explicitly forbidden (`.trellis/spec/frontend/state-management.md:63-68`, `223`). The robust source of IDs must therefore be a typed SQLite-backed command.

### Required cross-layer shape

A minimal durable restoration path needs all of the following:

1. A native repository/service/command operation such as `list_conversations` that returns safe conversation summaries from SQLite with deterministic ordering. It should return enough data to choose and label histories (at least the existing `ConversationView`; add a timestamp only if product ordering requires it).
2. The command must be registered in Tauri and added to the shared IPC fixture, Rust DTO tests, TypeScript Zod schema, and injected `ConversationClient`. The boundary ownership is required by `.trellis/spec/frontend/type-safety.md:53-80` and `.trellis/spec/frontend/directory-structure.md:55-64`.
3. Conversation-list/startup state and actions in the conversation feature. On mount, list SQLite conversations; when non-empty, either display the list and load a selected item or deterministically load the agreed default. The existing component must not interpret `conversationId === null` as definitively "no history" until discovery finishes.
4. Explicit empty/loading/error/ready states for discovery. A discovery failure must not be rendered as an empty database or silently show only the create form.
5. Request-race protection for overlapping startup/list/load operations. The provider store already demonstrates a local monotonic `requestEpoch` pattern (`src/features/providers/store/index.ts:44-67`); conversation restore currently lacks an equivalent and blindly commits any completed `loadConversation` (`src/features/conversations/store/index.ts:569-577`).

### Ordering and active-path decisions

Two product choices are not represented durably today:

- The `conversations` table has no creation/update timestamp (`src-tauri/migrations/0002_conversation_tree.sql:1-8`), although root and other nodes have `created_at` (`src-tauri/migrations/0002_conversation_tree.sql:10-19`). A list can sort by root-node time for creation order, or by `MAX(nodes.created_at)` for activity order, but that policy must be explicit and have an ID tie-breaker. Do not rely on unspecified SQLite row order.
- `loadedTreeState` always selects and expands only the structural root (`src/features/conversations/store/index.ts:180-195`). Therefore adding auto-load alone restores the full outline but the message pane initially shows only the root-to-root path. If "normally displayed" means reopening the previously selected branch, the current schema has no durable active-node cursor. Either accept root selection, choose a deterministic leaf, or add a narrowly scoped durable cursor. This is secondary to the confirmed discovery failure.

Archived conversations are already readable once loaded (`src/features/conversations/components/ConversationWorkspace.tsx:220-225`, `298-302`), so listing/filtering archived records should be an explicit contract rather than silently making them undiscoverable.

### Existing tests and the gap they leave

- `src/App.test.tsx:4-16` mocks a conversation client with no methods, and `src/App.test.tsx:18-27` asserts that a clean application immediately renders "Start a conversation." This test currently encodes the broken startup behavior and will need a discovery-aware mock/expectation.
- `src/features/conversations/components/ConversationWorkspace.test.tsx:134-145` defines a client with only the seven existing methods. Tests that render history first imperatively preload Zustand with a known ID before render (`src/features/conversations/components/ConversationWorkspace.test.tsx:195-201`, `214-219`, `248-258`). They therefore never exercise a clean-store startup restore.
- Store tests prove a known-ID load works and selects the root (`src/features/conversations/store/store.test.ts:128-140`), and preserve an existing safe projection on a failed subsequent load (`src/features/conversations/store/store.test.ts:183-206`), but do not discover IDs or reconstruct state after module/store reset.
- Frontend IPC tests explicitly assert exactly seven request shapes (`src/lib/tauri/client.test.ts:40-93`). Rust fixture tests make the same exact-list assertion (`src-tauri/tests/command_boundary.rs:78-107`), and the unit test freezes the command count at seven (`src-tauri/src/conversations/commands.rs:483-493`). These must change together when discovery is added.

### Regression tests to add

1. **Repository/service restart durability:** create two conversations and their nodes against a file-backed SQLite database, close/drop the first pool, open a new pool on the same file, call list then load each returned ID, and assert titles, node content, branch membership, deterministic ordering, and no duplicates. This distinguishes actual restart persistence from same-pool behavior.
2. **Rust command/contract:** add `list_conversations` to `contract-fixtures/conversation-ipc.json`; assert exact snake-case request/response DTOs, active/archived behavior, stable ordering and tie-breaks, empty list, malformed stored row/error mapping, and Tauri registration.
3. **Typed client:** injected transport returns `unknown`; assert the new list response is runtime validated and projected to camelCase, rejects malformed/duplicate summaries, and participates in the shared exact command order.
4. **Store restart restore:** seed a mock durable client, reset the Zustand store to its fresh-process state, run the new initialize/restore action, and assert list + selected tree are reconstructed solely from client results. Repeat the reset/restore and assert no duplicates or contamination from the previous projection.
5. **Workspace clean mount:** render with a clean store and client returning persisted summaries/tree. Without manually calling `loadConversation`, assert a startup loading state first, then the conversation list and persisted message/tree content. Assert `NewConversationForm` remains the empty-database state only when the list is empty.
6. **Multiple conversations:** return two histories with sentinel content, switch between them, and assert the selected tree contains only that conversation's nodes. Cover archived readability and ordering.
7. **Failures/races:** list rejection must show retryable recovery rather than "no history"; a listed ID whose tree was concurrently removed must fail safely; a stale startup response must not overwrite a later user-selected/created conversation. Exercise development `StrictMode` because the app root uses it (`src/main.tsx:13-16`).
8. **Secondary active-path test:** codify the chosen restore rule (root, deterministic leaf, or durable last active node) so restart behavior is intentional rather than an incidental consequence of `loadedTreeState`.

### Validation steps

1. Use a temporary file-backed database, not only `sqlite::memory:`, and seed at least two conversations with sibling branches and distinct sentinels.
2. Launch/load via the first application/service instance, create and append data, then fully dispose that instance.
3. Construct a fresh database pool, native command service, frontend client, and clean Zustand store. Do not carry an ID or JS object from the first instance into the second.
4. Invoke discovery, select/load every returned conversation, and verify title, archive state, full node count, deterministic outline, selected root-to-active path, and inactive-sibling exclusion.
5. Verify the zero-history, corrupt-row, missing-listed-tree, and database-unavailable states are distinct and retryable where appropriate.
6. Run the focused frontend contract/store/component suites, Rust command/tree persistence suites, `pnpm typecheck`, production frontend build, and Tauri/Rust test gate after implementation.

## Files Found

- `src/main.tsx` — creates a fresh StrictMode React root; no startup provider or hydration logic.
- `src/App.tsx` — thin composition boundary rendering only the conversation workspace.
- `src/App.test.tsx` — currently expects the clean application to show the new-conversation form.
- `src/features/conversations/components/ConversationWorkspace.tsx` — loads provider profile on mount, renders one loaded tree, and has no history discovery/list UI.
- `src/features/conversations/components/NewConversationForm.tsx` — current clean-store destination.
- `src/features/conversations/components/OutlineTree.tsx` — outline for nodes within one known conversation, not a conversation list.
- `src/features/conversations/hooks/useWorkspaceGenerationController.ts` — exposes known-ID loading and generation reconciliation but no startup discovery.
- `src/features/conversations/store/index.ts` — non-persisted single-conversation projection initialized empty; known-ID load only.
- `src/features/providers/store/index.ts` — existing request-epoch pattern relevant to safe startup hydration.
- `src/features/conversations/types/index.ts` — existing conversation/tree view types; no list/restoration state.
- `src/lib/tauri/client.ts` — typed conversation IPC client with exactly seven commands and no discovery call.
- `src/lib/tauri/schemas.ts` — runtime validation for per-ID operations; no list schema.
- `contract-fixtures/conversation-ipc.json` — shared exact seven-command contract.
- `src-tauri/src/conversations/commands.rs` — native DTO/command service; reads require a conversation ID.
- `src-tauri/src/conversations/repository.rs` — supports per-ID conversation/tree queries but no enumeration.
- `src-tauri/src/conversations/service.rs` — per-ID tree load and validation.
- `src-tauri/src/lib.rs` — registers the seven conversation commands.
- `src-tauri/migrations/0002_conversation_tree.sql` — durable conversations/nodes schema; timestamps exist on nodes only.
- `src-tauri/migrations/0003_conversation_archive.sql` — conversation-level archive state.
- `src-tauri/tauri.conf.json` — preloads the durable `sqlite:canopy.db` database.

## Code Patterns

- Durable authority is SQLite; Zustand is a loaded projection and intentionally has no browser persistence (`.trellis/spec/frontend/state-management.md:5-21`, `63-68`).
- Persistence actions call the typed Tauri client and reconcile authoritative DTOs (`.trellis/spec/frontend/state-management.md:48-57`).
- Raw invoke and runtime validation belong exclusively in `src/lib/tauri` (`.trellis/spec/frontend/directory-structure.md:55-64`; `.trellis/spec/frontend/type-safety.md:15-33`).
- Conversation tree loading is safe and deterministic once an ID is known: native repository node order is `(created_at, id)` (`src-tauri/src/conversations/repository.rs:92-105`), the service validates the tree (`src-tauri/src/conversations/service.rs:176-195`), the frontend client validates/maps it (`src/lib/tauri/client.ts:143-152`, `265-328`), and the store installs the projection (`src/features/conversations/store/index.ts:180-195`, `569-577`).
- Request epoching already exists in the provider store and is preferable to allowing stale startup responses to overwrite newer intent (`src/features/providers/store/index.ts:44-67`).

## External References

None required. The defect is fully explained by repository-local startup, state, IPC, and database contracts. Dependency/API behavior was not assumed beyond the code already present.

## Related Specs

- `.trellis/spec/frontend/state-management.md` — SQLite durability, non-persisted Zustand projections, and typed rehydration.
- `.trellis/spec/frontend/type-safety.md` — frozen typed conversation IPC boundary and shared fixture obligations.
- `.trellis/spec/frontend/directory-structure.md` — feature/store/client ownership boundaries.
- `.trellis/spec/frontend/quality-guidelines.md` — behavioral tree/path verification.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — source-to-retrieval-to-display boundary tracing.
- `.trellis/tasks/08-10-fix-history-restore-after-restart/prd.md` — requires automatic discovery/load after complete process restart and correct list/content restoration.

## Caveats / Not Found

- This frontend trace establishes that persisted history is undiscoverable even if SQLite writes are correct. It does not independently prove that the production database file survives process restart; that requires the file-backed reopen regression above and the backend persistence investigation.
- No `design.md` or `implement.md` was present in the active task during this research; only `prd.md` supplied task-specific requirements.
- No conversation list/history selector component, list/recent IPC DTO, or durable active-conversation/active-node cursor was found.
- Static source inspection was sufficient to establish the missing path. Tests were not executed because this research role is write-restricted to the task's `research/` directory; proposed tests are listed above for the implementation/check phases.
