# Tree Persistence

## Goal

Prove Canopy's tree-native conversation model against real SQLite before any
IPC or UI work: conversations and nodes persist as one tree, branches remain
first-class siblings, and loading model context returns only the validated path
from the designated root to the requested active node.

## Background

- The desktop foundation already registers and preloads `sqlite:canopy.db`
  through `tauri-plugin-sql` and deliberately exposes no frontend SQL
  capability.
- `src-tauri/migrations/0001_bootstrap.sql` contains only the private bootstrap
  marker; product tables were deferred to this task.
- The approved first-week architecture defines SQLite as the durable source of
  truth, raw parameterized `sqlx` repositories, Rust-owned transactions, and a
  fail-closed recursive path query.
- The locked stack resolves `tauri-plugin-sql 2.4.0`, `sqlx 0.8.6`, and one
  `libsqlite3-sys` implementation. The plugin publicly manages pools through
  `DbInstances` and `DbPool::Sqlite`.

## Requirements

### Migration and invariants

- Add the first product migration for `conversations` and `nodes` using the
  exact constraints, indexes, and triggers defined by
  `.trellis/spec/backend/database-guidelines.md`.
- Keep migration definitions in one ordered Rust catalog used by Tauri plugin
  registration and by tests; do not create a second production migration
  runner.
- Enable SQLite foreign-key enforcement for every test connection and preserve
  the deferred conversation-to-future-root foreign key without enabling
  `PRAGMA defer_foreign_keys`.
- Enforce one structural root per conversation, same-conversation parentage,
  immutable node history, immutable conversation root identity, protected
  designated roots, and archive-instead-of-delete behavior in SQLite.

### Rust persistence boundary

- Introduce the conversation domain records, closed role type, and
  persistence-layer error taxonomy needed to map SQLite rows safely.
- Obtain the production `SqlitePool` by cloning the pool stored at
  `sqlite:canopy.db` in the plugin-managed `DbInstances`; production code must
  not call `SqlitePool::connect` or create another pool.
- Keep parameterized SQL and row decoding in the conversation repository.
- Keep multi-step transactions in a persistence service. The service inputs
  may accept explicit opaque IDs and timestamps in this task so tests remain
  deterministic; the later command/domain-boundary task will own ID/time
  generation and input policy.
- Provide persistence operations to create a conversation with its designated
  root atomically, append a child/branch, load a deterministic conversation
  tree, load and validate the root-to-active path, and archive an eligible
  non-root node.
- Store metadata as validated canonical JSON text and expose parsed
  `serde_json::Value` inside Rust domain records.

### Path safety

- The active-path query must require both `conversation_id` and
  `active_node_id`, walk parent links with exact visited-ID cycle detection,
  exclude archived nodes, and order results root to active.
- Validate the designated root, terminal active node, conversation ownership,
  uniqueness, adjacency, and cycle state after reading the recursive result.
- Missing or archived active nodes return a typed not-found persistence error.
  A wrong root, broken chain, cross-conversation relationship, archived
  ancestor, duplicate, or cycle returns a typed tree-integrity persistence
  error.
- No path failure may fall back to a whole-conversation scan, a partial path,
  or another branch.

### Verification

- Run the real ordered migration definitions against a fresh SQLite database
  and exercise the same repository/service code used by production.
- Use stable IDs and timestamps; do not depend on wall-clock ordering.
- Include a two-branch sentinel fixture and explicit assertions that the
  inactive sibling is absent from each active path.
- Include test-only corruption setup proving the cycle-safe query terminates
  and returns tree integrity instead of hanging or returning partial history.
- Preserve the existing frontend and Rust quality gates and verify one
  compatible SQL plugin/sqlx/SQLite dependency stack.

## Acceptance Criteria

- [x] A fresh database applies the bootstrap and conversation-tree migrations
      in order and exposes the expected tables, indexes, triggers, and foreign
      keys.
- [x] Conversation/root creation commits atomically; a deliberately invalid
      root rolls back both records.
- [x] Appending two children to one parent creates first-class sibling branches
      without copying or modifying existing rows.
- [x] Loading a conversation tree is deterministic by `created_at, id` and
      preserves parsed metadata and archive state.
- [x] Loading each branch path returns exactly its root-to-active sequence and
      explicitly excludes the sibling sentinel.
- [x] Missing/archived active nodes fail as not found; wrong-root and cyclic
      fixtures fail as tree integrity; none returns a fallback history.
- [x] Cross-conversation parents, self-parenting, multiple roots, designated
      root archive/parentage, immutable-field updates, and node deletion are
      rejected by real SQLite constraints/triggers.
- [x] An eligible non-root archive succeeds without altering historical
      content or parentage.
- [x] Production pool access uses the plugin-managed `DbInstances` entry for
      `sqlite:canopy.db`; only tests construct their own SQLite pool.
- [x] Rust fmt, warning-free Clippy, Rust tests, the existing frontend check,
      dependency-tree inspection, and a debug no-bundle Tauri build pass.

## Out of Scope

- Tauri commands, public `CommandError` serialization, shared TypeScript DTOs,
  or raw invoke bridge code.
- ID/timestamp generation policy and end-user content/role validation.
- The edit-historical-message-as-branch command transaction; this belongs to
  the following domain-boundary vertical slice.
- Zustand state, conversation components, shadcn product UI, or frontend
  integration.
- Provider configuration, model requests, streaming, or context submission.
- Released-database upgrades, down migrations, destructive repair tools, or
  production packaging.
