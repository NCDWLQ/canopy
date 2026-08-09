# Domain Boundary Design

## Overview

This task is one cross-layer vertical slice. It replaces the provisional
node-archive behavior with conversation-only archive, then exposes the
conversation domain through stable Rust/Tauri commands and a runtime-validated
TypeScript bridge. Keeping this as one task gives the shared wire contract one
owner and one integration gate; the Rust and TypeScript halves are not useful
as independently releasable deliverables.

```text
React / future Zustand
  -> camelCase feature projections
  -> src/lib/tauri (request mapping + Zod decoding)
  -> snake_case Tauri DTOs
  -> commands.rs (validation + public error mapping)
  -> ConversationService (policy + transactions)
  -> ConversationRepository (SQL)
  -> plugin-managed SqlitePool
```

Raw SQLite rows never cross the repository, and raw `invoke` values never cross
`src/lib/tauri`.

## Conversation-only archive

Add `0003_conversation_archive.sql` to the ordered migration catalog rather
than editing the checksum-sensitive `0002` migration.

The migration will:

1. Add `conversations.is_archived INTEGER NOT NULL DEFAULT 0` with a strict
   boolean check.
2. Normalize any pre-release `nodes.is_archived = 1` rows back to `0` so old
   development data conforms to the new domain.
3. Reject any future node insert or update whose `is_archived` is not `0`.
4. Reject node inserts into an archived conversation as a persistence-level
   backstop.
5. Allow conversation archive only in the forward `0 -> 1` direction; no
   restore path is exposed or accepted.

The compatibility `nodes.is_archived` column and the older root-specific
triggers may remain. They are hidden from public DTOs and cannot represent a
valid domain state after migration. `archive_node` is removed from the
repository/service API. `Conversation` gains `is_archived`; `Node` and
`NewNode` no longer expose archive as an application choice.

`archive_conversation` performs an idempotent conversation-row update in a
transaction and does not update, copy, or delete nodes. Tree and active-path
reads remain available after archive. Every user mutation loads the
conversation inside its transaction and rejects an archived conversation
before inserting anything. The later provider-generation service must use the
same guard.

## Command contract

Every Tauri wrapper accepts one argument named `request`. Command names and
serialized DTO fields are explicit `snake_case`; the TypeScript bridge alone
converts to `camelCase` feature types.

| Command | Request fields | Success DTO | Domain rule |
|---|---|---|---|
| `create_conversation` | `title`, `content` | `ConversationTreeDto` | Creates one `user` structural root |
| `append_node` | `conversation_id`, `parent_node_id`, `content` | `NodeDto` | Parent is an assistant leaf |
| `create_branch` | `conversation_id`, `parent_node_id`, `content` | `NodeDto` | Parent is an assistant with an existing child |
| `edit_node_as_branch` | `conversation_id`, `source_node_id`, `content` | `NodeDto` | Source is a non-root `user`; create a sibling under its assistant parent |
| `load_conversation_tree` | `conversation_id` | `ConversationTreeDto` | Deterministic `(created_at, id)` node order |
| `load_active_path` | `conversation_id`, `active_node_id` | `ActivePathDto` | Validated root-to-active order, no siblings |
| `archive_conversation` | `conversation_id` | `ConversationDto` | Idempotent whole-conversation archive |

The DTO shapes are:

```text
ConversationDto {
  id, title, root_node_id, is_archived
}

NodeDto {
  id, parent_id, conversation_id, role, content,
  model, created_at, metadata
}

ConversationTreeDto { conversation, nodes }
ActivePathDto { conversation_id, active_node_id, nodes }
```

IDs are non-empty opaque strings. `parent_id` and `model` are explicit JSON
`null` when absent. `created_at` is an integer epoch-millisecond value.
`metadata` is parsed JSON, not canonical JSON text. Node DTOs have no archive
field because node archive is not part of the domain.

## Validation and identity

Command request validation is centralized and runs before persistence:

- trim titles, then require 1-200 Unicode scalar values;
- require content to contain non-whitespace and be at most 1 MiB of UTF-8;
- preserve accepted content byte-for-byte;
- reject blank IDs in read/mutation requests;
- assign `role = user`, `model = null`, and `metadata = {}` for every
  user-authored node.

Rust creates UUID v4 identifiers and epoch-millisecond timestamps. Internal
handlers depend on a small ID/clock interface, with a production implementation
for Tauri wrappers and deterministic values for unit tests. These generators
are not IPC inputs and are not stored as a second Tauri database state.

## Branch and edit transactions

Each mutation uses one service-owned transaction:

1. Load the conversation and reject missing/archived state.
2. Load and validate the relevant parent/source node in that conversation.
3. Check role, root, and child-count policy for the named command.
4. Insert exactly one new node with Rust-owned fields.
5. Read the authoritative inserted row, commit, and return it.

`edit_node_as_branch` never updates the source. Its new node receives the
source parent, a new ID/time, `role = user`, the requested content, null model,
and empty metadata. The transaction returns the inserted sibling. It does not
select an active branch or mutate descendants.

## Public errors

Add an application-level `CommandErrorCode` enum and `CommandError` in the
Rust boundary. Commands return only:

```text
{ code, message, retryable, details? }
```

The centralized mapper uses these rules:

- bad DTO, root edit, role/parent policy, or write to an archived conversation
  -> `invalid_input`;
- missing conversation/node/path -> `not_found`;
- corrupt persisted root/parent/path or invalid stored values
  -> `tree_integrity`;
- unavailable managed pool or transient storage access
  -> `database_unavailable` with `retryable = true`;
- known migration bootstrap failure -> `migration_failure`;
- unclassified failures -> `internal`.

Only safe field/reason identifiers may appear in `details`. Source chains stay
in Rust diagnostics; content, metadata, database URLs, and paths are never
serialized or logged.

The TypeScript bridge validates rejected values as `unknown` using the same
closed code set. Unknown codes, extra/missing malformed fields, or invalid
details normalize to a generic non-retryable `internal` `UiError`.

## TypeScript ownership

`src/lib/tauri` owns wire request/response schemas, the injectable invoke
transport, command-name constants, decoding, error normalization, and mapping.
It is the only frontend source directory that imports Tauri's `invoke`.

`src/features/conversations/types` owns camelCase product projections:

- `ConversationView` with conversation-level `isArchived`;
- full `ConversationNodeView` values;
- normalized `ConversationTreeView` / `TreeNodeView` with child IDs;
- ordered `ActivePathView` / `PathMessageView`;
- `UiErrorCode` and `UiError`.

`TreeNodeView` has no node archive property. Future Zustand and components use
the conversation's `isArchived` state to disable all mutation capabilities.
Null wire models map to an optional frontend model in one place.

## Shared contract fixture

`contract-fixtures/conversation-ipc.json` is the neutral cross-package source
of truth. It contains representative requests, every success DTO, nullable
fields, nested metadata, all error codes/retryability values, and malformed
payload cases. Rust includes and deserializes the same file in serialization
tests; TypeScript imports it through `resolveJsonModule` and runs it through
Zod. Neither side keeps a copied fixture.

## Verification strategy

- Rust unit tests: input validation, ID/time injection, DTO serialization,
  central error mapping, and each branch/edit policy edge.
- Real-migration integration tests: migration order, archive normalization,
  node-archive rejection, archived-conversation write rejection, idempotent
  archive, node-byte preservation, transaction rollback, edit-as-sibling, and
  fail-closed path behavior.
- Tauri IPC tests: exact registered command names and success/error envelopes
  through a mock app using the managed pool.
- TypeScript unit tests: every command request, success decoding/projection,
  malformed success rejection, malformed error normalization, and injectable
  transport behavior.
- Static audits: one raw frontend `invoke` owner, no SQL outside repository and
  migrations, no unsafe casts/suppressions, and no public `archive_node` or
  node `isArchived` surface.

## Compatibility, rollout, and rollback

This repository is pre-release, so v3 deliberately normalizes provisional
node archive flags. Existing tree content and metadata remain untouched.
Migration v2 is immutable; rollback during development is code rollback plus a
fresh development database, not a down migration. Once v3 is applied, the
application has no supported unarchive operation.

The main risk is contract drift between Rust serialization, Tauri argument
names, and TypeScript schemas. Explicit snake-case attributes plus the one
shared fixture and mock-IPC tests are the guardrail. A second risk is partial
archive enforcement; service checks and database triggers deliberately enforce
the same conversation-level rule at separate boundaries.
