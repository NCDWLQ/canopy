# Database Guidelines

> SQLite persistence contracts for Canopy's tree-native conversations.

---

## Overview

SQLite is the durable source of truth. The React webview never executes SQL;
all persistence operations cross the typed TypeScript invoke bridge and a
typed Tauri command before reaching Rust.

The production data flow has one owner at each boundary:

```text
Tauri SQL plugin configuration (preload + migrations)
  -> plugin-managed DbInstances / DbPool::Sqlite
  -> Rust application service (transactions and domain invariants)
  -> Rust repository (parameterized sqlx queries and row mapping)
  -> SQLite
```

- Register and preload one application database through the Tauri SQL plugin.
- Resolve its `sqlx::SqlitePool` from the plugin's public `DbInstances` and
  `DbPool::Sqlite` state. Repository adapters may borrow/clone that pool handle;
  they must not call `SqlitePool::connect` or create a second production pool.
- Keep the direct `sqlx` dependency compatible with the version resolved by the
  pinned SQL plugin. Run `cargo tree` after dependency upgrades and reject an
  upgrade that resolves incompatible SQLite/sqlx stacks.
- Repositories own SQL and row-to-domain conversion. Services own operations
  spanning repositories, transactions, and domain validation. Tauri commands
  only validate command DTOs, invoke services, and map results/errors.
- Do not grant the webview SQL plugin `select` or `execute` permissions. React,
  Zustand, and the TypeScript invoke bridge must not import or call the SQL
  plugin API.
- Raw parameterized SQL is intentional. Do not introduce an ORM for the MVP.

## Scenario: Desktop SQLite Scaffold Boundary

### 1. Scope / Trigger

Use this contract when creating or upgrading the Tauri SQL foundation. The
scaffold registers and proves the migration runner without introducing product
tables, repositories, commands, or frontend SQL access.

### 2. Signatures

The initial validated dependency and registration shape is:

```toml
tauri-plugin-sql = { version = "2.4.0", features = ["sqlite"] }
sqlx = { version = "0.8.6", default-features = false, features = ["sqlite"] }
```

```rust
const DATABASE_URL: &str = "sqlite:canopy.db";

tauri_plugin_sql::Builder::default()
    .add_migrations(DATABASE_URL, migrations)
    .build()
```

These versions describe the first validated lockfile, not an instruction to
upgrade independently. Change the plugin, direct dependency, and lockfile as
one reviewed compatibility update.

### 3. Contracts

- `src-tauri/tauri.conf.json` preloads exactly `sqlite:canopy.db`.
- Rust registers the same URL and is the only SQL execution boundary.
- `src-tauri/migrations/0001_bootstrap.sql` creates only the private
  `_canopy_bootstrap` marker. The Node/Conversation schema belongs to its own
  feature migration.
- `src-tauri/capabilities/default.json` contains `core:default` only until a
  separately reviewed native capability is required. It never grants
  `sql:allow-select` or `sql:allow-execute`.
- No environment key or global Tauri CLI is required; project commands use the
  pnpm-local `@tauri-apps/cli`.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Plugin URL and preload URL differ | Reject the change before merge |
| `cargo tree` resolves two `sqlx` or SQLite stacks | Align the direct dependency with the plugin |
| Bootstrap migration creates a product table | Move that DDL to the product-schema task |
| Capability enables frontend SQL execution | Remove the permission; commands remain the boundary |
| Migration registration or application fails | Desktop startup/database use fails closed; later command mapping uses `migration_failure` |

### 5. Good / Base / Bad Cases

- **Good**: the debug desktop build applies the bootstrap migration, resolves
  one `sqlx` 0.8.6 stack, and exposes no SQL permission to the webview.
- **Base**: a clean local database contains only `_canopy_bootstrap` after the
  empty shell starts.
- **Bad**: TypeScript imports the SQL plugin or the scaffold migration creates
  `nodes` and `conversations` before their repository and regression suite
  exist.

### 6. Tests Required

- Run the bootstrap SQL against a fresh SQLite database and assert the exact
  application-owned table set is `[_canopy_bootstrap]`.
- Run `cargo tree` and assert one compatible `tauri-plugin-sql`, `sqlx`,
  `sqlx-sqlite`, and `libsqlite3-sys` stack.
- Run Rust fmt, Clippy with warnings denied, tests, `pnpm tauri info`, and a
  debug no-bundle Tauri build.
- Scan capabilities and frontend sources for SQL select/execute permissions or
  raw plugin use.

### 7. Wrong vs Correct

#### Wrong

```json
{ "permissions": ["core:default", "sql:allow-select"] }
```

#### Correct

```json
{ "permissions": ["core:default"] }
```

The correct form keeps persistence behind typed Rust commands even though the
SQL plugin owns the production pool and migration lifecycle.

## Scenario: Conversation Tree Persistence Boundary

### 1. Scope / Trigger

Use this contract when changing the conversation migration, repository SQL,
managed-pool adapter, or persistence service. The implementation lives in
`src-tauri/src/database.rs`, `src-tauri/src/conversations/`, and
`src-tauri/tests/tree_persistence.rs`.

### 2. Signatures

The implemented persistence surface is:

```rust
managed_sqlite_pool(&DbInstances) -> Result<SqlitePool, PersistenceError>

ConversationPersistenceService::new(SqlitePool)
create_conversation(NewConversation, NewNode) -> Result<ConversationTree, PersistenceError>
append_node(NewNode) -> Result<Node, PersistenceError>
load_conversation_tree(&str) -> Result<ConversationTree, PersistenceError>
load_active_path(&str, &str) -> Result<ValidatedPath, PersistenceError>
archive_node(&str, &str) -> Result<Node, PersistenceError>
```

Service inputs accept explicit opaque IDs and epoch-millisecond timestamps.
The future command layer owns ID/time generation and end-user input policy.

### 3. Contracts

- `database::MIGRATION_CATALOG` is the single ordered definition catalog used
  by plugin registration and real-migration tests.
- Production resolves `DATABASE_URL` from plugin-managed `DbInstances` and
  clones the `DbPool::Sqlite` handle. Only test support constructs a pool.
- Repository functions receive `&mut SqliteConnection`, bind every value, and
  map rows into closed domain types.
- The service owns every multi-statement unit, including an insert followed by
  readback. Both steps execute in one transaction so a concurrent archive or
  other writer cannot change the returned result between statements.
- Metadata crosses the domain boundary as `serde_json::Value` and is stored as
  canonical compact JSON with recursively sorted object keys.
- Only validated query results can construct `ValidatedPath`.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Managed database entry is missing | `PersistenceError::DatabaseUnavailable` |
| Requested conversation or active node is missing/archived | `PersistenceError::NotFound` |
| Root, adjacency, ownership, duplicate, or cycle validation fails | `PersistenceError::TreeIntegrity` |
| Known constraint/trigger rejects a requested write | `PersistenceError::InvalidInput` |
| Stored role, boolean, or JSON cannot map to the closed domain type | `PersistenceError::InvalidStoredData` |
| Other SQL operation fails | Wrapped storage error with no public IPC mapping yet |

No failure returns a partial tree/path or retries through a whole-conversation
query.

### 5. Good / Base / Bad Cases

- **Good**: two siblings round-trip in deterministic order, and each active
  path contains its ancestors plus only its selected leaf.
- **Base**: one conversation and future root commit atomically through the
  deferred composite foreign key.
- **Bad**: a missing root, archived ancestor, broken/cross-conversation chain,
  or cycle returns a typed failure rather than usable messages.

### 6. Tests Required

`src-tauri/tests/tree_persistence.rs` runs `MIGRATION_CATALOG` against a fresh,
one-connection SQLite pool with foreign keys enabled. It must assert:

- exact application table/index/trigger shape and deferred root ownership;
- atomic rollback, same-conversation parentage, one root, immutable history,
  archive protection, and delete rejection;
- canonical metadata key order and domain round-trip;
- deterministic tree order and explicit sibling-sentinel absence;
- not-found, wrong-root, archived-ancestor, broken-chain,
  cross-conversation-chain, and cycle fail-closed behavior;
- the managed adapter returns the same pool handle's visible database state.

### 7. Wrong vs Correct

#### Wrong

```rust
repository.insert_node(&pool, &node).await?;
repository.load_node(&pool, &node.id).await
```

The two statements can observe different archive state under concurrent
writes.

#### Correct

```rust
let mut transaction = pool.begin().await?;
let stored = repository.insert_node(&mut transaction, &node).await?;
transaction.commit().await?;
Ok(stored)
```

The repository's insert/readback and the service result share one transaction.

## Physical Schema

All DDL is migration-owned. Enable `PRAGMA foreign_keys = ON` for every
connection. Identifiers use `snake_case`; IDs are opaque text IDs; timestamps
are Unix epoch milliseconds. Logical JSON is canonical JSON text, not a
PostgreSQL-style `jsonb` declaration.

The initial migration must express this schema (constraint and index names may
be added, but their semantics must not be weakened):

```sql
CREATE TABLE conversations (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  FOREIGN KEY (root_node_id, id)
    REFERENCES nodes (id, conversation_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE nodes (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL
                    CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content         TEXT NOT NULL,
  model           TEXT,
  created_at      INTEGER NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}'
                    CHECK (json_valid(metadata)),
  is_archived     INTEGER NOT NULL DEFAULT 0
                    CHECK (is_archived IN (0, 1)),
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE (id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations (id),
  FOREIGN KEY (parent_id, conversation_id)
    REFERENCES nodes (id, conversation_id)
);

CREATE UNIQUE INDEX nodes_one_root_per_conversation
  ON nodes (conversation_id)
  WHERE parent_id IS NULL;

CREATE INDEX nodes_children_order
  ON nodes (conversation_id, parent_id, created_at, id);

CREATE INDEX nodes_conversation_order
  ON nodes (conversation_id, created_at, id);

CREATE TRIGGER nodes_reject_designated_root_parent
BEFORE INSERT ON nodes
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_must_be_structural_root');
END;

CREATE TRIGGER nodes_reject_designated_root_archived_on_insert
BEFORE INSERT ON nodes
WHEN NEW.is_archived = 1
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_cannot_be_archived');
END;

CREATE TRIGGER nodes_immutable_history
BEFORE UPDATE ON nodes
WHEN OLD.id IS NOT NEW.id
  OR OLD.parent_id IS NOT NEW.parent_id
  OR OLD.conversation_id IS NOT NEW.conversation_id
  OR OLD.role IS NOT NEW.role
  OR OLD.content IS NOT NEW.content
  OR OLD.model IS NOT NEW.model
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.metadata IS NOT NEW.metadata
BEGIN
  SELECT RAISE(ABORT, 'node_history_is_immutable');
END;

CREATE TRIGGER nodes_reject_designated_root_archive
BEFORE UPDATE OF is_archived ON nodes
WHEN NEW.is_archived = 1
 AND EXISTS (
   SELECT 1 FROM conversations AS c
   WHERE c.id = NEW.conversation_id AND c.root_node_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'designated_root_cannot_be_archived');
END;

CREATE TRIGGER nodes_reject_delete
BEFORE DELETE ON nodes
BEGIN
  SELECT RAISE(ABORT, 'node_history_cannot_be_deleted');
END;

CREATE TRIGGER conversations_immutable_identity_and_root
BEFORE UPDATE OF id, root_node_id ON conversations
WHEN OLD.id IS NOT NEW.id OR OLD.root_node_id IS NOT NEW.root_node_id
BEGIN
  SELECT RAISE(ABORT, 'conversation_identity_and_root_are_immutable');
END;
```

The self-reference remains immediate: a parent must already exist when a child
is inserted. Combined with immutable parent links, this prevents cycles without
a recursive write-time check. Only the conversation-to-future-root composite
foreign key is deferred so conversation creation can insert both records in one
transaction. Do not enable `PRAGMA defer_foreign_keys`; it would defer the
parent constraint and invalidate this cycle-prevention argument.

Migration triggers must also enforce the invariants that foreign keys cannot
express alone:

- A node named by `conversations.root_node_id` has `parent_id IS NULL`, whether
  the root node or the conversation reference is inserted first.
- Node identity, `parent_id`, `conversation_id`, `role`, `content`, `model`,
  `created_at`, and `metadata` are immutable after insertion. `is_archived` is
  the only supported semantic node update in the MVP.
- A conversation's designated root cannot be inserted as archived or archived
  by a later update.
- Nodes cannot be deleted in application data; archiving is the
  history-preserving removal mechanism. Repositories must also never use
  `INSERT OR REPLACE` for nodes.
- Conversation identity and `root_node_id` are immutable in application data.
  If a repair migration ever needs to change them, it must explicitly replace
  the trigger and revalidate root ownership, null parentage, and the one-root
  constraint before commit.

Use null-safe SQLite comparisons (`OLD.value IS NOT NEW.value`) in immutable
field triggers. Do not rely only on repository behavior for these guarantees.

## Repository and Transaction Patterns

Repository methods accept domain/DTO values, bind every value with `sqlx`, and
return domain records or typed repository errors. SQL strings do not cross the
repository boundary.

The minimum tree repository contract is:

- create a conversation and its root;
- append a child node;
- create a branch/edit node without modifying history;
- load an ordered conversation tree or ordered children;
- load and validate the root-to-active path;
- archive an eligible non-root node.

Create a conversation in one deferred transaction:

1. Insert `conversations` with its future `root_node_id`.
2. Insert the root node with the same `conversation_id` and a null `parent_id`.
3. Validate the designated root and commit, allowing the deferred composite
   foreign key to be checked at commit.

Services own transactions that span repository calls. Editing a historical
message is insert-only: create a new node beneath the original node's parent
(or use the explicit root-edit domain operation if one is later designed), then
continue the new branch from it. Never update the original content, reparent its
descendants, copy a whole conversation, or delete sibling history.

## Tauri Command Boundary

Before backend and component work proceeds in parallel, the main integration
workstream freezes these command names and DTOs in the shared IPC contract:

| Command | Required input | Result / invariant |
|---|---|---|
| `create_conversation` | title and root node content/role/model/metadata | Conversation and root DTOs created atomically; Rust assigns IDs and time |
| `append_node` | `conversation_id`, `parent_id`, role/content/model/metadata | New child DTO; parent must belong to the conversation |
| `create_branch` | `conversation_id`, assistant `parent_id`, new node data | New child branch; existing children remain unchanged |
| `edit_node_as_branch` | `conversation_id`, `source_node_id`, replacement content/model/metadata | New sibling with the source role and parent; source and descendants remain unchanged |
| `load_conversation_tree` | `conversation_id` | Conversation plus deterministically ordered node DTOs |
| `load_active_path` | `conversation_id`, `active_node_id` | Validated root-to-active DTO list, or a typed fail-closed error |
| `archive_node` | `conversation_id`, `node_id` | Updated archive state; the designated root is rejected |
| `generate_from_active_path` | `conversation_id`, `active_node_id`, provider/model selection | Provider output built only from `load_active_path`'s validated domain value |

DTOs use string IDs, integer epoch-millisecond timestamps, explicit nullable
fields, and parsed JSON metadata at IPC (the repository alone encodes canonical
JSON text). Input DTOs never accept SQL, database paths, caller-selected
timestamps, or arbitrary stored rows. Commands do not expose the plugin pool or
repository types. Every failure uses the shared `CommandError` contract.

These names/shapes are changed only through the main integration workstream,
which updates Rust, TypeScript decoding, fixtures, and component mocks together.
Frontend components call feature actions; only the typed bridge calls these
commands.

## Root-to-Active Path Query

The path repository method requires both `conversation_id` and
`active_node_id`. It anchors at the active node, walks parent links, excludes
archived nodes, and orders the result from root to active:

```sql
WITH RECURSIVE path AS (
  SELECT n.*, 0 AS depth, json_array(n.id) AS visited_ids,
         0 AS cycle_detected
  FROM nodes AS n
  WHERE n.id = ?1
    AND n.conversation_id = ?2
    AND n.is_archived = 0

  UNION ALL

  SELECT parent.*, child.depth + 1,
         json_insert(child.visited_ids, '$[#]', parent.id),
         EXISTS (
           SELECT 1
           FROM json_each(child.visited_ids)
           WHERE value = parent.id
         )
  FROM nodes AS parent
  JOIN path AS child
    ON child.parent_id = parent.id
   AND child.conversation_id = parent.conversation_id
  WHERE parent.is_archived = 0
    AND child.cycle_detected = 0
)
SELECT *
FROM path
ORDER BY depth DESC, id ASC;
```

`visited_ids` uses SQLite JSON values rather than delimiter-joined IDs, so
cycle detection remains exact for every valid opaque text ID. The row that
closes a cycle has `cycle_detected = 1`; the recursive term then stops. These
query-only columns are consumed by repository validation and are not mapped
into a `Node` or exposed over IPC.

After reading the rows, validate all of the following before returning a path:

1. The active node was found for the requested conversation.
2. Exactly one terminal row has `parent_id IS NULL`.
3. That terminal row is first and equals `conversations.root_node_id`.
4. No row has `cycle_detected = 1`; IDs are unique; and for every adjacent
   root-to-leaf pair, the child's `parent_id` equals the preceding parent's
   `id`.
5. The final row equals `active_node_id` and every row belongs to
   `conversation_id`.

A missing or archived active node returns `not_found`. A disconnected,
cross-conversation, archived-ancestor, duplicate/cyclic, or wrong-root path
returns `tree_integrity`. Fail closed: never
substitute the whole conversation, another branch, or a partial path. Provider
request construction consumes only this validated ordered result.

## Migrations

- The Tauri SQL plugin configuration is the production migration runner and
  database preloader; there is no second application migration path.
- Migrations are ordered, checked into `src-tauri`, and applied before commands
  can access repositories. A migration failure prevents normal database use and
  maps to the stable `migration_failure` command error.
- Migration tests run the same ordered migration definitions against a fresh
  temporary SQLite database with foreign keys enabled.
- The first migration is pre-release and may assume an empty development
  database. After the first release, schema changes are forward-only and must
  be tested from the previous released schema. Use forward repair migrations,
  not destructive down migrations, for user databases.
- If the selected plugin migration path cannot preserve the deferred root
  foreign key, stop and revise the design before implementation. Do not weaken
  root ownership or cross-conversation constraints to make migration tooling
  pass.

## Common Mistakes

- Creating a Rust `SqlitePool` alongside the plugin-managed pool.
- Granting SQL plugin permissions to the webview or issuing SQL from TypeScript.
- Declaring `metadata jsonb`; SQLite stores validated canonical JSON as `TEXT`.
- Omitting `conversation_id` from the parent foreign key or path query, allowing
  cross-conversation relationships.
- Using a recursive query result without root and adjacency validation.
- Falling back to all messages when a path is missing or corrupt, which can
  leak sibling content into a provider prompt.
- Treating an edit as `UPDATE nodes SET content = ...`; edits create branches.
- Deleting nodes or using `INSERT OR REPLACE`, which bypasses append-only
  history instead of archiving it.
- Using string interpolation for SQL values instead of bound parameters.
- Enabling `PRAGMA defer_foreign_keys` and accidentally allowing mutually
  dependent parent inserts in one transaction.
