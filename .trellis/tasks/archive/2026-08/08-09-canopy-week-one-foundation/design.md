# Canopy Week One Foundation Design

## Architecture and Boundaries

Canopy uses a webview UI over a Rust application core. The UI owns rendering and transient navigation state; Rust owns persistence invariants, model-request construction, and external-provider calls.

```text
React components
  -> feature actions / Zustand tree state
  -> typed TypeScript invoke bridge
  -> Tauri commands
  -> Rust application services
  -> Rust repositories
  -> Tauri SQL plugin-managed sqlx SQLite pool
```

- React components must not invoke Tauri commands or SQL directly.
- The TypeScript bridge is the only IPC boundary and maps command DTOs to frontend domain types.
- Zustand caches the loaded tree and active-node selection; SQLite remains the durable source of truth.
- Rust repository methods contain parameterized SQL. Service methods own multi-repository transactions and domain invariants.
- Tauri SQL plugin configuration owns database preloading and migrations. Rust commands access its public `DbInstances` / `DbPool::Sqlite` state. Frontend SQL `select` and `execute` permissions are not granted.
- The direct `sqlx` dependency must stay compatible with the version used by the pinned Tauri SQL plugin; `cargo tree` verifies that one compatible SQLite/sqlx stack is resolved.

## First-Week Delivery Framework

The first week is a sequence of vertical proofs rather than a complete polished MVP:

1. **Foundation** — scaffold Tauri/React, apply MIT licensing, establish lint/type/test commands, and register the SQLite plugin.
2. **Tree persistence** — apply the initial schema and prove create-conversation, append-node, create-branch, and root-to-active path loading against SQLite.
3. **Domain boundary** — expose typed Tauri commands, stable errors, and the non-destructive edit/branch transaction.
4. **Navigable shell** — render the outline tree and active path, wire Zustand selection, and expose branch/edit actions with accessible keyboard behavior.
5. **Model-path proof** — build one OpenAI-compatible request exclusively from the active path, stream/render one response, and run the focused regression suite.

Each step must leave a testable artifact; visual polish, provider breadth, and production packaging are secondary to proving the tree and context invariants.

## Agent Work Split

Product implementation may run backend and UI work in parallel after a small shared contract is frozen:

The product-build task should create the shadcn workstream as a dedicated Trellis child task so its scope, tests, and review can complete independently; dependency on the shared contract is written explicitly in that child's PRD and implementation plan. The developer controls when and how that frontend agent is launched. This main session prepares the handoff contract but does not dispatch the product-development frontend agent without a new explicit request.

| Owner | Exclusive write scope | Deliverable |
|---|---|---|
| Rust/tree agent | `src-tauri/**` | migrations, repositories, services, commands, provider path construction, Rust tests |
| Developer-managed frontend shadcn agent | `src/components/ui/**`, `src/features/**/components/**`, component tests and styles | accessible outline/message/composer/settings UI built against typed fixtures and callbacks |
| Main integration session | shared TypeScript domain/IPC contracts, Zustand stores/actions, app composition and integration tests | freezes interfaces, coordinates both agents, wires real commands, resolves cross-layer changes |

The frontend agent must not edit Rust, migrations, repositories, Zustand stores, or the raw Tauri bridge. It receives stable component props, command-result fixtures, and error/loading examples through native Codex context injection or the Trellis manifest. The Rust agent must not edit feature components or shadcn primitives.

Parallel work begins only after command names, DTO shapes, `CommandError`, and the normalized tree view model are recorded. The frontend agent can then implement against mocks while Rust work proceeds. Integration is accepted only when the real bridge satisfies the same fixtures and the branch-isolation regression passes. If a shared contract must change, the main session updates it once and notifies both workstreams; agents do not independently redefine boundary types.

## Frontend Component Contract

Feature ownership will be recorded in the frontend component spec:

```text
src/
  app/                         # composition, routing, providers, shell
  components/ui/               # generated or lightly wrapped shadcn primitives
  features/conversations/
    components/                # OutlineTree, ConversationPane, MessageNode, Composer
    actions/                   # branch/edit/select orchestration
    store/                     # Zustand normalized tree + active node
    types/                     # frontend projections, not database rows
  features/providers/          # provider settings and model selection
  lib/tauri/                   # typed invoke bridge and error normalization
```

- `OutlineTree` renders navigation and emits intent; it does not query persistence.
- `ConversationPane` derives the visible path from normalized state.
- `MessageNode` is presentational; `BranchActionMenu` owns accessible branch/edit affordances.
- shadcn/Radix primitives stay in `components/ui`; domain behavior stays in feature modules.
- Props are explicit TypeScript types. Components accept domain view models, not raw database rows or unknown IPC payloads.
- Presentational component props and fixtures are the handoff contract for the dedicated frontend agent; persistence and IPC details must not leak into those props.

## SQLite Schema Contract

SQLite uses `snake_case`, foreign keys enabled, and migration-owned DDL. Logical JSON metadata is stored as canonical JSON text with `CHECK(json_valid(metadata))`; SQLite does not receive a PostgreSQL-style `jsonb` column declaration.

### `conversations`

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `root_node_id TEXT NOT NULL`
- a deferred composite foreign key from `(root_node_id, id)` to `nodes(id, conversation_id)` ensures the designated root belongs to the conversation

### `nodes`

- `id TEXT PRIMARY KEY`
- `parent_id TEXT NULL`
- `conversation_id TEXT NOT NULL`
- `role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool'))`
- `content TEXT NOT NULL`
- `model TEXT NULL`
- `created_at INTEGER NOT NULL` as Unix epoch milliseconds
- `metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata))`
- `is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1))`
- `CHECK(parent_id IS NULL OR parent_id <> id)` prevents a self-parent cycle
- `UNIQUE(id, conversation_id)` supports composite referential integrity
- foreign key `conversation_id -> conversations(id)`
- composite self-reference `(parent_id, conversation_id) -> nodes(id, conversation_id)` prevents cross-conversation parent links

Required indexes:

- `nodes(conversation_id, parent_id, created_at, id)` for ordered child/tree loading
- `nodes(conversation_id, created_at, id)` for conversation scans
- a unique partial index on `nodes(conversation_id) WHERE parent_id IS NULL` for one structural root

Creation uses one deferred transaction: insert the conversation referencing its future root, insert the root node, and validate before commit. Repository operations never mutate `parent_id`, `conversation_id`, `role`, or `content`; editing creates a sibling node under the original parent. Archiving is the only semantic node update in the MVP. Migration triggers reject a designated root whose parent is non-null, changes to immutable node fields, and attempts to archive the designated root. Together with insert-only parent links, these rules prevent cycles without recursive write-time checks.

## Root-to-Active Path Query

The repository accepts both `conversation_id` and `active_node_id`. It anchors at the active node, walks parents, and orders the result from root to leaf:

```sql
WITH RECURSIVE path AS (
  SELECT n.*, 0 AS depth
  FROM nodes AS n
  WHERE n.id = ?1
    AND n.conversation_id = ?2
    AND n.is_archived = 0

  UNION ALL

  SELECT parent.*, child.depth + 1
  FROM nodes AS parent
  JOIN path AS child
    ON child.parent_id = parent.id
   AND child.conversation_id = parent.conversation_id
  WHERE parent.is_archived = 0
)
SELECT *
FROM path
ORDER BY depth DESC;
```

Post-query validation requires exactly one terminal root, that root to equal `conversations.root_node_id`, and every adjacent parent link to be continuous. Missing, archived, cross-conversation, disconnected, or cyclic paths produce a typed integrity/not-found error and never fall back to the whole conversation. Provider payload construction consumes only this validated ordered path.

## Error Contract

Rust exposes a serializable command error with stable fields:

- `code`: stable machine-readable enum;
- `message`: safe user-facing summary;
- `retryable`: whether retry is meaningful;
- `details`: optional non-sensitive structured context.

Initial codes cover invalid input, not found, tree integrity, database unavailable, migration failure, provider authentication, rate limiting, provider unavailable, network failure, cancellation, and internal failure. Source errors are preserved/logged in Rust but never serialized with API keys, full prompts, database paths, or raw provider bodies. The TypeScript bridge validates and normalizes the payload. Expected errors render near the failed action; unexpected failures use a recovery notice. Cancellation does not produce an error toast.

## Testing Contract

- Rust unit tests: domain validation, error mapping, and provider request construction from an ordered path.
- SQLite integration tests: run real migrations against a fresh temporary database and exercise repository transactions and recursive CTEs.
- Required regression fixture: at least two sibling branches where the active branch request contains every ancestor exactly once and contains no sibling content.
- Mutation invariants: editing inserts a new sibling and leaves the original node and descendants unchanged; cross-conversation parents and multiple roots fail.
- TypeScript unit tests: invoke bridge decoding and Zustand normalized-tree selectors/actions.
- React Testing Library: outline selection, keyboard navigation, branch/edit intent, loading, empty, and error states.
- One thin application smoke path may be added after the vertical proof; broad end-to-end packaging coverage is deferred beyond week one.

## Trade-offs and Compatibility

- Rust commands add IPC DTO work but centralize invariants and keep SQLite inaccessible to the webview.
- Reusing plugin-managed `DbInstances` avoids a second pool but couples the repository adapter to a public plugin type; pin and upgrade-test the plugin version.
- Raw SQL is intentional for recursive CTE clarity. No ORM is introduced until schema breadth demonstrates a concrete need.
- The first migration is pre-release and requires no legacy-data migration. Every later schema change must be forward-only and tested from the previous released schema.

## Rollback

This planning task only changes Trellis documents. Each spec file can be reverted independently. When product implementation begins, schema rollback uses disposable development databases until the first release; released databases use forward repair migrations rather than destructive down migrations.
