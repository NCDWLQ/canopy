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
  -> infra::database (DATABASE_URL, MIGRATION_CATALOG,
     register_sql_plugin, managed_sqlite_pool)
  -> plugin-managed DbInstances / DbPool::Sqlite
  -> Rust application service (transactions and domain invariants)
  -> Rust repository (parameterized sqlx queries and row mapping)
  -> SQLite
```

`infra` has no product-module dependency. Conversation, provider, settings,
and generation code resolve the pool through `infra::database`; they do not
own the catalog or open a second production connection. Export writes are
filesystem-only and never resolve the managed pool. Production `app_builder`
and released-database upgrade tests must both call
`infra::database::register_sql_plugin` so `DATABASE_URL` and
`plugin_migrations()` cannot drift.

SQL ownership by table family:

- `conversations` / `nodes` — `conversations::repository`. Binding columns
  (`provider_id`, `model`, `reasoning_effort`) and `system_prompt` may be
  written after an already-validated payload; this SQL must not `FROM
  providers` or `JOIN providers`. `system_prompt` is independent of provider
  delete: the migration 7 trigger must not clear it.
- `providers` / `provider_credential_operations` — `providers::repository`.
- typed `app_settings` keys — `settings::repository` (`language`, `theme`,
  `auto_generate_title`, `title_model_binding`, `default_system_prompt`).
- `generation` does not own SQL. It composes provider validation and the
  conversation persistence-only setter in one service transaction.

- Register and preload one application database through the Tauri SQL plugin.
- Resolve its `sqlx::SqlitePool` from the plugin's public `DbInstances` and
  `DbPool::Sqlite` state via `infra::database::managed_sqlite_pool`. Repository
  adapters may borrow/clone that pool handle; they must not call
  `SqlitePool::connect` or create a second production pool.
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

infra::database::register_sql_plugin(builder)
// internally:
// tauri_plugin_sql::Builder::default()
//     .add_migrations(DATABASE_URL, plugin_migrations())
//     .build()
```

These versions describe the first validated lockfile, not an instruction to
upgrade independently. Change the plugin, direct dependency, and lockfile as
one reviewed compatibility update. Do not re-inline SQL plugin registration in
`lib.rs` or tests; extend `register_sql_plugin` instead.

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
managed-pool adapter, or persistence service. The pool and catalog live in
`src-tauri/src/infra/database.rs`. Conversation persistence lives in
`src-tauri/src/conversations/`. Real-migration tests live in
`src-tauri/tests/tree_persistence.rs`.

### 2. Signatures

The implemented persistence surface is:

```rust
infra::database::managed_sqlite_pool(&DbInstances) -> Result<SqlitePool, DatabaseError>

ConversationPersistenceService::new(SqlitePool)
create_conversation(NewConversation, NewNode) -> Result<ConversationTree, PersistenceError>
append_node(NewNode) -> Result<Node, PersistenceError>
append_user_node(NewNode) -> Result<Node, PersistenceError>
create_branch(NewNode) -> Result<Node, PersistenceError>
edit_node_as_branch(&str, NewNode) -> Result<Node, PersistenceError>
list_conversations() -> Result<Vec<ConversationSummary>, PersistenceError>
load_conversation_tree(&str) -> Result<ConversationTree, PersistenceError>
load_active_path(&str, &str) -> Result<ValidatedPath, PersistenceError>
archive_conversation(&str) -> Result<Conversation, PersistenceError>
unarchive_conversation(&str) -> Result<Conversation, PersistenceError>
rename_conversation(&str, &str) -> Result<Conversation, PersistenceError>
delete_conversation(&str) -> Result<(), PersistenceError>
```

Persistence-service inputs accept explicit opaque IDs and epoch-millisecond
timestamps. `conversations::commands::ConversationCommandService` owns
end-user input policy and production UUID/time generation through
`infra::identity`.

### 3. Contracts

- `infra::database::MIGRATION_CATALOG` is the single ordered definition catalog
  used by plugin registration and real-migration tests.
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
- Conversation discovery derives `updated_at` from `MAX(nodes.created_at)`
  and orders every active and archived summary by `updated_at DESC, id ASC`.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Managed database entry is missing | `DatabaseError::Unavailable` → `database_unavailable` |
| Requested conversation, node, or active node is missing | `PersistenceError::NotFound` |
| A write targets an archived conversation or violates branch policy | `PersistenceError::InvalidInput` |
| Root, adjacency, ownership, duplicate, or cycle validation fails | `PersistenceError::TreeIntegrity` |
| Known constraint/trigger rejects a requested write | `PersistenceError::InvalidInput` |
| Stored role, boolean, or JSON cannot map to the closed domain type | `PersistenceError::InvalidStoredData` |
| SQLite result code `BUSY` or `LOCKED`, including extended forms | `database_unavailable`, retryable |
| Other SQL operation fails | Wrapped storage error mapped centrally to safe `internal` |

No failure returns a partial tree/path or retries through a whole-conversation
query.

### 5. Good / Base / Bad Cases

- **Good**: two siblings round-trip in deterministic order, and each active
  path contains its ancestors plus only its selected leaf.
- **Base**: one conversation and future root commit atomically through the
  deferred composite foreign key.
- **Bad**: a missing root, broken/cross-conversation chain,
  or cycle returns a typed failure rather than usable messages.

### 6. Tests Required

`src-tauri/tests/tree_persistence.rs` runs `MIGRATION_CATALOG` against a fresh,
one-connection SQLite pool with foreign keys enabled. It must assert:

- exact application table/index/trigger shape and deferred root ownership;
- atomic rollback, same-conversation parentage, one root, immutable history,
  conversation archive protection, node-archive rejection, and delete rejection;
- canonical metadata key order and domain round-trip;
- deterministic tree order and explicit sibling-sentinel absence;
- not-found, wrong-root, broken-chain,
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
  is_archived  INTEGER NOT NULL DEFAULT 0
                 CHECK (is_archived IN (0, 1)),
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
  is_archived     INTEGER NOT NULL DEFAULT 0 -- pre-release compatibility only
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

Migration `0003_conversation_archive.sql` adds `conversations.is_archived`,
normalizes every provisional node archive flag to zero, rejects later node
archive inserts/updates, rejects inserts into archived conversations, and
allows conversation archive only in the forward direction. The compatibility
node column remains checksum-safe storage from migration v2; it is not part of
the Rust domain or IPC contract.

Migration triggers must also enforce the invariants that foreign keys cannot
express alone:

- A node named by `conversations.root_node_id` has `parent_id IS NULL`, whether
  the root node or the conversation reference is inserted first.
- Every node field is immutable after insertion. The compatibility
  `nodes.is_archived` value is always zero after migration v3 and all future
  attempts to set it are rejected.
- Archive belongs only to the conversation. Archiving is idempotent, does not
  rewrite nodes, and keeps tree/path reads available. Unarchiving is the
  symmetric guarded operation (see "Guarded trigger-lifted mutations" below).
- Nodes cannot be deleted individually. The only delete path is
  whole-conversation `delete_conversation`, which removes nodes and the
  conversation row under the guarded pattern below. Repositories must also
  never use `INSERT OR REPLACE` for nodes.
- Conversation identity and `root_node_id` are immutable in application data.
  If a repair migration ever needs to change them, it must explicitly replace
  the trigger and revalidate root ownership, null parentage, and the one-root
  constraint before commit.

Use null-safe SQLite comparisons (`OLD.value IS NOT NEW.value`) in immutable
field triggers. Do not rely only on repository behavior for these guarantees.

### Guarded trigger-lifted mutations (delete / unarchive)

Application commands that must bypass a migration trigger
(`delete_conversation` lifts `nodes_reject_delete`; `unarchive_conversation`
lifts `conversations_archive_forward_only` from migration `0003`) follow one
mandatory pattern, all inside a single service transaction:

1. `DROP TRIGGER IF EXISTS <trigger>`;
2. perform the guarded mutation (`DELETE FROM nodes WHERE conversation_id`,
   `DELETE FROM conversations`, or `UPDATE ... SET is_archived = 0`);
3. `CREATE TRIGGER <trigger>` with the definition **copied verbatim** from the
   owning migration;
4. commit. Any early error return drops the transaction before commit, which
  rolls the `DROP` back with it — the guard never stays missing.

SQLite DDL is transactional, so this is atomic. The verbatim-copy rule exists
because a drifted redefinition would silently weaken the guard; persistence
tests must therefore assert that a direct `DELETE FROM nodes` (or raw
un-archive `UPDATE`) still ABORTs after the command succeeds, and that
`sqlite_schema` contains exactly one copy of each guard trigger.

## Repository and Transaction Patterns

Repository methods accept domain/DTO values, bind every value with `sqlx`, and
return domain records or typed repository errors. SQL strings do not cross the
repository boundary.

The minimum tree repository contract is:

- create a conversation and its root;
- append a child node;
- create a branch/edit node without modifying history;
- load an ordered conversation tree or ordered children, rejecting a missing
  designated root, missing parent, duplicate/foreign node, disconnected
  component, or cycle as `TreeIntegrity` rather than returning a partial tree;
- load and validate the root-to-active path;
- archive a whole conversation without changing any node bytes.

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
| `create_conversation` | `title`, `content` | User root and conversation created atomically; Rust assigns IDs/time/model/metadata |
| `append_node` | `conversation_id`, `parent_node_id`, `content` | User child; parent is an assistant leaf |
| `create_branch` | `conversation_id`, `parent_node_id`, `content` | User child; assistant parent already has a child and existing children remain unchanged |
| `edit_node_as_branch` | `conversation_id`, `source_node_id`, `content` | User sibling under the eligible source's assistant parent; source and descendants remain unchanged |
| `load_conversation_tree` | `conversation_id` | Conversation plus deterministically ordered node DTOs |
| `load_active_path` | `conversation_id`, `active_node_id` | Validated root-to-active DTO list, or a typed fail-closed error |
| `archive_conversation` | `conversation_id` | Idempotent whole-conversation archive; all node bytes remain unchanged |
| `generate_from_active_path` | `conversation_id`, `active_node_id` | Snapshot provider/model/effort at prepare from the conversation binding; HTTP prompt built only from `load_active_path`'s validated domain value. The request DTO does not carry provider/model. |

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
`active_node_id`. It anchors at the active node, walks parent links, and orders
the result from root to active. Archived conversations remain readable:

```sql
WITH RECURSIVE path AS (
  SELECT n.*, 0 AS depth, json_array(n.id) AS visited_ids,
         0 AS cycle_detected
  FROM nodes AS n
  WHERE n.id = ?1
    AND n.conversation_id = ?2

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
  WHERE child.cycle_detected = 0
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

A missing active node returns `not_found`. A disconnected,
cross-conversation, duplicate/cyclic, or wrong-root path
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
- Released migration SQL bytes are checksummed by SQLx. After a schema is
  published (currently `v0.4.0` = migrations `0001`–`0006`), do not edit those
  files for wording, comments, or formatting: any byte change breaks fixture
  ledger verification. Fix product defects with a new forward migration.
- Migration `0007_conversation_provider_binding_integrity.sql` repairs
  released rows where `provider_id IS NULL AND model IS NOT NULL`, then installs
  `provider_delete_clears_conversation_binding` so every provider delete clears
  `provider_id` and `model` together. `reasoning_effort` is independent and
  must not be cleared by that trigger.

### Scenario: Conversation provider binding integrity (migration 0007)

#### 1. Scope / Trigger

Use this contract when changing conversation `(provider_id, model)` binding
cleanup, provider-delete SQL, or migration `0007`.

#### 2. Signatures

```sql
-- 0007_conversation_provider_binding_integrity.sql
UPDATE conversations SET model = NULL
WHERE provider_id IS NULL AND model IS NOT NULL;

CREATE TRIGGER provider_delete_clears_conversation_binding
BEFORE DELETE ON providers
FOR EACH ROW
BEGIN
  UPDATE conversations
  SET provider_id = NULL, model = NULL
  WHERE provider_id = OLD.id;
END;
```

#### 3. Contracts

- Repair released rows that had `provider_id IS NULL AND model IS NOT NULL`.
- Every production provider delete path (immediate no-credential delete,
  credential reconcile delete, and direct SQL delete) clears both binding
  columns; `reasoning_effort`, title, archive state, and nodes are untouched.
- Do not weaken this to a one-shot `UPDATE` without the delete trigger.
- Supported set/clear conversation binding commands remain paired at the
  service layer; DTO `binding_model` may stay as a defensive read mapping.

#### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Upgrade from v0.4.0 fixture stale row | `model` becomes NULL; other conversation fields unchanged |
| `DELETE FROM providers` with bound conversations | `(provider_id, model) = (NULL, NULL)`; effort preserved |
| Restart after migration 7 | Ledger complete; repaired rows not rewritten again |

### Scenario: Released-database upgrade harness

#### 1. Scope / Trigger

Use this contract when adding or changing forward migrations after `v0.4.0`,
or when changing SQL plugin registration / preload wiring. Fresh in-memory
`sqlx::raw_sql` loops prove catalog application only; they do **not** prove
released-file upgrade through the Tauri SQL plugin lifecycle.

#### 2. Signatures

```text
src-tauri/tests/fixtures/canopy-v0.4.0.db
src-tauri/tests/fixtures/README.md          # provenance + SHA-256 + ledger
src-tauri/tests/released_database_upgrade.rs
infra::database::register_sql_plugin(Builder) -> Builder
```

#### 3. Contracts

- Fixture schema and `_sqlx_migrations` ledger must match tag `v0.4.0`
  (`cc8cc83`) migrations `0001`–`0006`, including SHA-384 checksums recorded
  in the fixture README.
- Tests copy the fixture into a unique workspace-local app-config directory
  (via a unique mock Tauri identifier and isolated `XDG_CONFIG_HOME`); never
  open the versioned fixture for write.
- The upgrade path must call `register_sql_plugin` with production
  `plugins.sql.preload = ["sqlite:canopy.db"]`. Replaying `MIGRATION_CATALOG`
  with `sqlx::raw_sql` does not satisfy this gate.
- After setup, assert migration ledger completeness (including forward
  versions beyond 6), representative seed rows, `PRAGMA foreign_key_check`
  empty, tree triggers still reject illegal writes, migration 7 clears the
  fixture stale binding baseline, then drop the app/pool and rebuild once
  against the same temp file to prove idempotence. Cleanup must remove only
  the unique test directory on success and failure (Drop-based guard).
- Fixture contents are non-sensitive only: no API keys, keyring secrets, real
  user prompts, or host paths. Credential references use obvious placeholders.
- The fixture retains a known stale conversation binding baseline
  (`provider_id IS NULL AND model IS NOT NULL`); migration `0007` repairs it
  on upgrade. Do not rewrite the versioned fixture bytes for that cleanup.

#### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Fixture SHA-256 ≠ README constant | Fail the harness before upgrade |
| Ledger versions 1–6 missing / wrong SHA-384 | Fail the harness |
| Registration uses a duplicated/raw_sql path | Reject the change; share `register_sql_plugin` |
| Upgrade or second start mutates already-applied rows unexpectedly | Fail idempotence assertion |
| Test leaves `XDG_CONFIG_HOME` pointing at a real user config root | Reject; isolate under `src-tauri/target/` |

#### 5. Good / Base / Bad Cases

- **Good**: copy fixture → plugin setup applies current catalog (including
  `0007+`) → ledger and repaired seeds hold → restart is a no-op beyond
  already-applied versions.
- **Base**: released ledger rows for versions 1–6 keep their documented
  SHA-384 checksums after upgrade; later catalog versions appear as new
  ledger entries.
- **Bad**: editing `0005` comments to “fix wording” and breaking the released
  checksum, or treating mock empty `DbInstances` as upgrade coverage.

#### 6. Tests Required

- `cargo test --manifest-path src-tauri/Cargo.toml --test released_database_upgrade`
- Keep fresh-catalog suites (`tree_persistence`, `multi_provider_migration`)
  green alongside the released path.
- When regenerating the fixture (`generate_v040_fixture`, ignored + env gate),
  refresh README SHA-256 and ledger checksums in the same change.

#### 7. Wrong vs Correct

##### Wrong

```rust
for migration in MIGRATION_CATALOG {
    sqlx::raw_sql(migration.sql).execute(&pool).await?;
}
```

##### Correct

```rust
let app = register_sql_plugin(tauri::Builder::default())
    .build(/* mock context with plugins.sql.preload */)?;
let pool = managed_sqlite_pool(app.state::<DbInstances>().inner()).await?;
```

### Scenario: Conversation system prompt (migration 0008)

#### 1. Scope / Trigger

Use this contract when changing `conversations.system_prompt`,
`app_settings.default_system_prompt`, or migration `0008`. Generation
injection lives in `generation::service` and must not own SQL.

#### 2. Signatures

```sql
-- 0008_conversation_system_prompt.sql
ALTER TABLE conversations ADD COLUMN system_prompt TEXT;
```

```text
app_settings key: default_system_prompt   -- absent = no global default
conversations.system_prompt TEXT NULL     -- NULL = inherit global default
```

#### 3. Contracts

- `NULL` on the conversation column is the only inherit marker. There is no
  "explicitly unused" sentinel and no built-in preset prompt.
- Clearing a conversation override writes SQL `NULL`. Clearing the global
  default deletes the `app_settings` key (same pattern as
  `delete_title_model_binding`).
- Provider-delete trigger from migration 7 must not clear `system_prompt`.
- `ConversationSummary` / history list DTOs do not carry `system_prompt`.
- Nodes stay immutable. Do not persist the prompt as a mutable system root.

#### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Upgrade from v0.4.0 fixture | `system_prompt` column exists; seed rows stay `NULL` |
| Conversation write while archived | `archived_conversation_write` → `invalid_input` |
| Blank / whitespace-only input | persist `NULL` / delete the settings key |
| Prompt > 1 MiB UTF-8 | `invalid_input` (`system_prompt` or `prompt`) |
| Restart after migration 8 | Ledger complete; seed rows not rewritten |

#### 5. Good / Base / Bad Cases

- **Good**: set override, load tree, clear to `NULL`; global key delete
  restores inherit.
- **Base**: missing column before 0008 is repaired by the forward migration;
  unset rows stay `NULL`.
- **Bad**: editing 0001–0007 bytes; storing the prompt as a system node;
  treating empty string and `NULL` as different inherit states.

#### 6. Tests Required

- `tree_persistence` asserts the column exists and
  set/clear/archived-reject round-trips.
- `released_database_upgrade` asserts ledger version 8 and seed
  `system_prompt IS NULL`.

#### 7. Wrong vs Correct

##### Wrong

```sql
-- persist inherit as empty string, or mutate a system root node
UPDATE conversations SET system_prompt = '' WHERE id = ?1;
UPDATE nodes SET content = ?1 WHERE role = 'system';
```

##### Correct

```sql
UPDATE conversations SET system_prompt = ?1 WHERE id = ?2;
-- bind None to inherit; never UPDATE node history
```

## Common Mistakes

- Creating a Rust `SqlitePool` alongside the plugin-managed pool.
- Treating `sqlx::raw_sql(MIGRATION_CATALOG)` as released-database upgrade
  coverage, or registering the SQL plugin twice with divergent migration lists.
- Editing published migration SQL bytes (including comments) after a release
  tag instead of adding a forward migration.
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
