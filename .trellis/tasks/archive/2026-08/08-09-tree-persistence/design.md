# Tree Persistence Design

## Architecture and Boundaries

This task implements the storage half of the approved flow:

```text
Tauri SQL plugin startup
  -> database adapter obtains plugin-managed SqlitePool
  -> conversation persistence service owns transactions
  -> conversation repository owns SQL and row mapping
  -> SQLite conversations/nodes
```

No Tauri product command or frontend surface is added. Future commands will
obtain the managed pool, build the service, generate IDs/timestamps, validate
command input, and map persistence errors to the stable `CommandError` contract.

## Module Shape

The implementation should introduce only modules with working behavior:

```text
src-tauri/
├── migrations/
│   ├── 0001_bootstrap.sql
│   └── 0002_conversation_tree.sql
└── src/
    ├── database.rs
    ├── lib.rs
    └── conversations/
        ├── mod.rs
        ├── domain.rs
        ├── error.rs
        ├── repository.rs
        └── service.rs
```

- `database.rs` owns `DATABASE_URL`, the ordered migration catalog, conversion
  to plugin migration definitions, and safe extraction of the managed SQLite
  pool from `DbInstances`.
- `domain.rs` owns `Conversation`, `Node`, `Role`, new-record inputs, and a
  `ValidatedPath` wrapper that can only be constructed after repository
  validation.
- `error.rs` owns persistence-only errors such as not found, invalid stored
  data, tree integrity, managed database unavailable, and wrapped `sqlx`
  failures. It does not define public IPC codes yet.
- `repository.rs` owns parameterized statements and row decoding. It accepts a
  pool/transaction executor supplied by the service and never opens a
  connection.
- `service.rs` owns the deferred create-conversation/root transaction and the
  public persistence operations used by later application services.

Unit tests may remain beside small domain/error code. Real SQLite migration and
repository tests belong under `src-tauri/tests/` with shared support introduced
only if reused.

## Migration Catalog

Define one application-owned ordered catalog containing version, description,
and included SQL text. `plugin_migrations()` converts that catalog into
`tauri_plugin_sql::Migration` values for `app_builder`. Test setup iterates the
same catalog and executes each SQL body against its isolated SQLite pool.

This does not create a second production runner: only the plugin applies
migrations to `canopy.db`. Tests deliberately apply the same definitions to an
ephemeral database so constraints and repositories can be exercised without a
desktop process.

The product migration follows the published DDL contract verbatim in behavior:

- circular conversation/root ownership uses the one deferred composite foreign
  key;
- the parent relationship remains immediate;
- partial and ordering indexes match the repository queries;
- triggers enforce root shape, immutable history, archive protection, delete
  rejection, and immutable conversation identity/root.

## Pool Ownership

`tauri-plugin-sql 2.4.0` exposes `DbInstances(pub RwLock<HashMap<String,
DbPool>>)` and `DbPool::Sqlite(SqlitePool)`. The adapter acquires a read lock,
looks up the exact `sqlite:canopy.db` key, matches the SQLite variant, clones the
pool handle, and releases the guard before repository work.

A missing entry or unexpected pool kind returns a typed database-unavailable
persistence error. Production code contains no call to `SqlitePool::connect`.
The test factory may create a one-connection in-memory pool with foreign keys
enabled; one connection keeps PRAGMA state and corruption fixtures
deterministic.

## Domain and Repository Contracts

`Conversation` mirrors the durable conversation identity/title/root. `Node`
contains the opaque IDs, closed role, content/model, epoch-millisecond
timestamp, parsed metadata, and archive state. Database booleans decode only
from `0` or `1`; role strings and metadata are validated during row mapping.
Unexpected stored values are integrity failures, not silently coerced values.

The repository provides operations for:

- inserting and reading a conversation;
- inserting and reading nodes through bound parameters;
- loading nodes deterministically by `created_at, id`;
- executing the recursive active-path query with its query-only depth,
  visited-ID, and cycle columns;
- archiving an eligible node.

The persistence service provides the semantic operations from the PRD. It
starts the deferred transaction for conversation/root creation, inserts the
future root reference first, inserts the root, validates the root, and commits.
Any error rolls back by dropping/explicitly rolling back the transaction.

Appending a branch is insert-only. The caller supplies a new opaque node ID and
timestamp; SQLite validates same-conversation parentage. No operation updates
content/role/parent metadata or copies an existing conversation.

## Root-to-Active Algorithm

Use the cycle-safe recursive CTE from the database spec, anchored by both
active node and conversation. It walks upward, accumulates exact JSON visited
IDs, records the row that closes a cycle, and stops recursion after that row.
Order the rows root-to-active before domain mapping.

Before constructing `ValidatedPath`, verify:

1. the requested active node exists and is not archived;
2. exactly one structural terminal/root row was reached;
3. the first row matches the conversation's designated root;
4. no cycle flag or duplicate ID exists;
5. every adjacent child references the preceding parent;
6. every row and the final active node match the requested identifiers.

The query and validation form one fail-closed boundary. Callers cannot obtain a
generic node list from a failed path operation.

## Error Semantics

Persistence errors remain internal in this task:

- `NotFound` for a missing/archived requested conversation or active node;
- `TreeIntegrity` for corrupted root/path/row invariants;
- `InvalidInput` for a requested operation rejected by known domain/database
  constraints when the distinction is reliable;
- `DatabaseUnavailable` for a missing managed pool;
- a wrapped `sqlx` error for other storage failures.

The later domain-boundary task maps these once to public `CommandError`. Tests
assert variants/reasons rather than unstable SQLite message prose wherever
possible.

## Test Design

The common fixture uses stable IDs and timestamps:

```text
root -> user-a -> assistant-a -> user-left
                            \-> user-right
```

For each active leaf, assert exact ordered IDs and absence of the other leaf's
sentinel content. Separate tests cover atomic rollback, deterministic sibling
ordering, constraints/triggers, archive behavior, metadata round-trip, and
managed-pool extraction.

Cycle corruption is test-only: use an isolated one-connection database, remove
the immutable-history trigger for that fixture, update a parent link to close a
cycle, then assert the recursive query terminates with `TreeIntegrity`. No
production repair or constraint bypass is exposed.

## Compatibility and Rollback

- This is pre-release schema version 2 and may assume a clean development
  database. Once released, subsequent schema changes become forward-only.
- Keep `tauri-plugin-sql`, direct `sqlx`, and the lockfile aligned. Do not
  upgrade dependencies as part of this feature unless the locked public pool
  API cannot support the design.
- If the plugin migration runner cannot apply the deferred root relationship,
  stop and revise the design; do not weaken constraints.
- Rollback before release is code/migration reversion plus removal of the local
  development database. No automated destructive down migration is added.
