# Research: history restore regression and startup discovery

- Query: Inspect history, persistence tests, workspace startup, and Tauri SQL path behavior to explain why persisted conversations disappear after an application restart; identify the smallest regression test.
- Scope: mixed
- Date: 2026-08-10

## Findings

### Verdict

The durable conversation rows are very likely still present. The failing behavior is a missing startup-discovery path: after a new renderer/process starts, Zustand begins with `conversationId: null`, no code discovers an ID from SQLite, and the workspace therefore renders the new-conversation form. The only read command, `load_conversation_tree`, requires a caller-supplied conversation ID that the restarted frontend no longer has.

This is not evidence of a recent SQLite location regression. It is an omission present since the conversation workspace was introduced and explicitly left out of later integration scope.

### Files found

- `src/features/conversations/components/ConversationWorkspace.tsx` — workspace composition and mount effects; only the provider profile is loaded on mount.
- `src/features/conversations/store/index.ts` — transient Zustand state and explicit ID-based tree load.
- `src/features/conversations/hooks/useWorkspaceGenerationController.ts` — exposes an ID-based `loadConversation` operation, but nothing calls it during startup.
- `src/lib/tauri/client.ts` — typed frontend command bridge; it has no conversation discovery/list operation.
- `src-tauri/src/conversations/commands.rs` — frozen seven-command Rust boundary; tree load requires `conversation_id`.
- `src-tauri/src/conversations/repository.rs` — SQL reads one known conversation or its nodes; there is no conversation-list query.
- `src-tauri/src/conversations/service.rs` — full-tree loading works once an ID is supplied.
- `src-tauri/src/database.rs` — one shared production URL, `sqlite:canopy.db`.
- `src-tauri/tauri.conf.json` — stable bundle identifier and SQL preload configuration.
- `src-tauri/src/lib.rs` — registers migrations for the same database URL.
- `src-tauri/tests/support/mod.rs` — all repository test pools are `sqlite::memory:`.
- `src-tauri/tests/tree_persistence.rs` — proves round trips through one live in-memory pool, not close/reopen discovery.
- `src/features/conversations/components/ConversationWorkspace.test.tsx` — manually loads a tree into the store before rendering history.
- `src/App.test.tsx` — current startup expectation is the empty/new-conversation screen.
- `.trellis/tasks/archive/2026-08/08-09-generation-workspace-integration/prd.md` — explicitly states that `list_conversations` does not exist and must remain out of scope.
- `.trellis/tasks/archive/2026-08/08-09-frontend-workspace/prd.md` — explicitly forbids conversation persistence in Zustand/browser storage.
- `.trellis/workspace/canopy/journal-1.md` — maps the tree persistence and typed domain work to commits `d651093` and `0d66976` and records the later workspace integration.

### Code-path evidence

1. A fresh frontend process cannot retain the old ID by design.
   - `src/features/conversations/store/index.ts:167-178` initializes `conversationId`, `rootNodeId`, and `activeNodeId` to `null` in an ordinary `create(...)` Zustand store. No persistence middleware is used.
   - `.trellis/tasks/archive/2026-08/08-09-frontend-workspace/prd.md:27-29` declares SQLite the sole durable source of truth and forbids local-storage/Zustand persistence for conversations. Persisting the ID or full tree in browser storage would violate this contract.

2. Startup performs no conversation discovery.
   - `src/features/conversations/components/ConversationWorkspace.tsx:41-48` constructs the clients.
   - `src/features/conversations/components/ConversationWorkspace.tsx:75-77` has the only startup data effect, and it loads only the provider profile.
   - `src/features/conversations/components/ConversationWorkspace.tsx:266-274` renders `NewConversationForm` whenever `conversationId === null`, which is always true after a process restart.
   - `src/features/conversations/hooks/useWorkspaceGenerationController.ts:390-395` can load a tree only when some caller already supplies an ID; no mount-time caller exists.

3. No backend/IPC operation can discover persisted conversations.
   - `src-tauri/src/conversations/commands.rs:18-26` freezes exactly seven conversation commands; no list/latest/discovery command exists.
   - `src-tauri/src/conversations/commands.rs:59-63` makes `conversation_id` mandatory for a tree-load request, and `src-tauri/src/conversations/commands.rs:250-259` forwards only that exact ID.
   - `src/lib/tauri/client.ts:34-42` mirrors the same seven-command surface, while `src/lib/tauri/client.ts:143-152` requires `conversationId` to load a tree.
   - `src-tauri/src/conversations/repository.rs:61-72` loads one conversation by ID, and `src-tauri/src/conversations/repository.rs:92-105` loads nodes only for one ID. There is no query over all conversations.
   - `src-tauri/src/conversations/service.rs:176-195` demonstrates that durable tree reads are already complete and validated once an ID is known. The missing link is discovery, not node decoding or tree reconstruction.

4. Existing tests do not exercise a restart boundary.
   - `src-tauri/tests/support/mod.rs:13-37` creates a fresh `sqlite::memory:` pool. Closing it destroys the database, so this helper cannot test process restart.
   - `src-tauri/tests/tree_persistence.rs:275-340` creates and reloads a sibling-branch fixture through the same pool/service lifetime. It proves deterministic tree reads and sibling isolation, but not file persistence or rediscovery after reopening.
   - `src/features/conversations/components/ConversationWorkspace.test.tsx:195-201`, `248-258`, and `368-372` explicitly call `useConversationStore.getState().loadConversation(...)` before mounting the workspace. These tests bypass the missing startup step.
   - `src/App.test.tsx:18-27` positively asserts that a fresh app renders “Start a conversation,” locking in the faulty restart behavior whenever durable history exists.

### Commit/history evidence

- `d651093624e83d656bc5ac53210bd237278ea118` (`feat: implement tree persistence`) introduced the durable SQLite tree vertical slice. `.trellis/workspace/canopy/journal-1.md:64-79` describes it as transactional SQLite persistence with real-migration regressions.
- `0d66976478dad17f3114bfcddb1301f1b4e0673e` (`feat: implement domain boundary`) introduced the typed command boundary. `.trellis/workspace/canopy/journal-1.md:85-100` records the commit, and the current frozen list at `src-tauri/src/conversations/commands.rs:18-26` shows that boundary has no discovery command.
- `db6f548c863558a2cdc90f771f22bd58430db084` (`feat: add conversation workspace`) is the main-line commit that introduced `ConversationWorkspace`. Inspection of that commit's file object shows `ConversationWorkspace.tsx:13-38` created the client/store but contained no `useEffect`; `ConversationWorkspace.tsx:70-73` only offered retry for an already-known `store.conversationId`. Its `src/App.test.tsx:9-18` asserted the new-conversation screen on startup. The parallel feature-branch commit is `848f333515df0a62516d93fb19882541678471f1` with the same behavior.
- The omission remained intentional in the later generation integration: `.trellis/tasks/archive/2026-08/08-09-generation-workspace-integration/prd.md:24-25` says, “There is still no `list_conversations` command” and forbids inventing browser persistence or synthetic history. That task was implemented by `9b2fd85bcab9` and documented by `d07f20ec4a3c` according to `.trellis/workspace/canopy/journal-1.md:128-144`.
- `5044b5f5089e1ab8f5f327b30ddb1bcfe69211f6` is not the cause; its commit message is `fix: disable incompatible WebKit DMA-BUF renderer`. `.trellis/workspace/canopy/journal-1.md:150-164` records it as the integration/AppImage-rendering session, but it did not add a startup history contract.

Therefore this is best classified as a missing product behavior present since workspace inception, not a later regression that deletes previously working startup code.

### Tauri path/config assessment

The checked configuration is internally consistent:

- `src-tauri/src/database.rs:6` defines `DATABASE_URL` as `sqlite:canopy.db`.
- `src-tauri/src/lib.rs:41-47` registers migrations under that same URL.
- `src-tauri/tauri.conf.json:3-5` fixes the bundle identifier as `app.canopy.desktop`, and `src-tauri/tauri.conf.json:26-29` preloads the identical URL.
- The pinned `tauri-plugin-sql` 2.4.0 source resolves SQLite URLs under `app.path().app_config_dir()` (`.../tauri-plugin-sql-2.4.0/src/wrapper.rs:68-91`) and inserts each preload into `DbInstances` after connecting/migrating (`.../src/lib.rs:145-169`). On application exit it closes pools rather than deleting database files (`.../src/lib.rs:174-182`).

This agrees with the official Tauri SQL documentation: SQLite paths are relative to `AppConfig`, and a matching `plugins.sql.preload` entry applies migrations during plugin initialization. `AppConfig` resolves under the platform config directory plus the bundle identifier. External references:

- [Tauri SQL plugin usage and migration preload](https://v2.tauri.app/plugin/sql/)
- [Tauri `BaseDirectory::AppConfig` resolution](https://docs.rs/tauri/2.0.0/tauri/path/enum.BaseDirectory.html#variant.AppConfig)

There is no URL, preload, or bundle-identifier mismatch in the repository that would explain loss specifically after restart. Changing the identifier between distributed builds would relocate the database, but no such change is present in the inspected history/context.

### Smallest regression test

Add one behavior test to `src/features/conversations/components/ConversationWorkspace.test.tsx` at the component/client boundary, after introducing the minimal typed discovery method (prefer `listConversations()` if the product must show a conversation list):

1. Reset the Zustand store to its fresh-process state (`conversationId: null`).
2. Mock `client.listConversations()` to return at least one persisted `ConversationView`, and mock `client.loadConversationTree(id)` to return the existing branched `tree` fixture.
3. Render `<ConversationWorkspace conversationClient={client} ... />` without preloading the store.
4. Await and assert:
   - discovery was called exactly once;
   - `loadConversationTree` was called with the discovered conversation ID;
   - the persisted root/message sentinel is visible;
   - “Start a conversation” is absent;
   - the inactive sibling sentinel is absent from the active message path.

This is the lowest existing layer that reproduces the user-visible failure: if the mount-time discovery effect is removed, the test returns to the new-conversation form and fails. It also catches the current bug without depending on browser storage, wall-clock timing, or a real Tauri webview.

The backend discovery query needs its own deterministic repository/contract test, but that is companion coverage rather than the smallest user-visible regression. If a true disk-boundary guard is desired, add a separate test helper that creates a named temporary SQLite file, migrates and writes through one pool, closes it, reopens the same file through a new pool/service, then lists and loads the tree. The existing in-memory helper cannot supply that proof.

### Likely minimal implementation shape

- Add a repository/service/command/DTO/bridge operation that discovers conversations from SQLite. Do not persist conversation history or IDs in browser storage.
- Define deterministic ordering. The `conversations` table has no timestamp (`src-tauri/migrations/0002_conversation_tree.sql:1-8`), but the root node has `created_at` (`:10-19`), so a minimal “most recent” policy can join each conversation to its designated root and order by root `created_at DESC`, then conversation ID as a stable tie-breaker. If the UI must display all history, return the ordered list rather than only a latest-tree shortcut.
- On workspace mount, discover once and load the selected/latest conversation. Continue using the existing validated `load_conversation_tree` path for messages.
- Loading currently selects the structural root (`src/features/conversations/store/index.ts:180-195`). Restoring the exact previously active branch is a separate state contract because no active-node selection is persisted today.

## Related specs

- `.trellis/spec/backend/database-guidelines.md:9-35` — SQLite is durable source of truth and frontend access must remain behind typed Rust commands.
- `.trellis/spec/backend/database-guidelines.md:67-88` — one exact database URL/preload and fail-closed startup/migration behavior.
- `.trellis/spec/backend/database-guidelines.md:128-172` — repository/service/managed-pool ownership for conversation persistence.
- `.trellis/spec/backend/database-guidelines.md:199-211` — real-migration tests and deterministic tree ordering requirements.
- `.trellis/spec/frontend/state-management.md` — normalized authoritative tree state; no browser persistence for conversation history.
- `.trellis/spec/frontend/quality-guidelines.md:35-56` — behavioral feature integration coverage and lowest-layer regression rule.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:11-44` — define and test the full source-to-display boundary.

## Caveats / Not Found

- No code or test was found that previously auto-loaded a conversation at application startup; this is an omission, not a removed implementation.
- No deletion, reset, truncate, or database recreation path was found in normal application startup. The SQL plugin creates the file only when it does not exist.
- Existing tests do not prove file-backed close/reopen persistence, so a separate low-probability filesystem/plugin issue cannot be ruled out solely by the suite. Configuration and plugin-source evidence make it less likely than the certain frontend discovery gap.
- “Restore the exact last active node” cannot be inferred from current durable data. The application stores the tree, but not a last-opened conversation or active-node cursor. A deterministic latest-conversation/root selection is the smallest compatible behavior; exact selection restoration needs an explicit durable preference contract.
- Archived-conversation inclusion and empty-database behavior need a product decision. Existing domain behavior keeps archived conversations readable, so silently excluding them from all history would conflict with that established contract.
