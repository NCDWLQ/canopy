# Domain Boundary

## Goal

Expose Canopy's verified tree persistence through one typed Rust/Tauri/TypeScript
boundary so later Zustand and UI work can depend on stable commands, DTOs,
errors, and normalized tree view models without knowing about SQLite or raw
`invoke` payloads.

## Background

- Tree Persistence is complete and archived. Rust already owns the
  plugin-managed `SqlitePool`, immutable conversation tree, deterministic tree
  loading, and fail-closed root-to-active paths. Its provisional node archive
  behavior must now be replaced by the approved conversation-only boundary.
- The approved first-week sequence places this task between persistence and the
  navigable frontend shell.
- React components must never call raw Tauri `invoke`, execute SQL, or consume
  database rows. `src/lib/tauri` is the only frontend IPC boundary.
- Shared command names, DTO shapes, `CommandError`, and normalized tree view
  models must be frozen before backend commands and frontend components can be
  developed independently.

## Requirements

### Rust application boundary

- Add typed Tauri commands for conversation creation, user-node append/branch,
  historical edit-as-branch, deterministic tree loading, validated active-path
  loading, and whole-conversation archive.
- Register commands explicitly in the Tauri application builder and resolve the
  existing plugin-managed pool; commands must not create a second pool or
  execute SQL directly.
- Keep domain decisions and multi-step mutations in a Rust application/service
  layer. Command functions validate DTO shape, invoke the service, and map one
  internal error into one public error.
- Rust assigns opaque node/conversation IDs and epoch-millisecond timestamps;
  callers cannot select stored IDs, timestamps, parent conversation IDs, SQL,
  or database paths.
- Historical editing is insert-only: create a new sibling beneath the source
  node's parent, preserve the source and every descendant byte-for-byte, and
  return the new node/tree state needed by the caller.
- The structural root is not editable in the MVP. An edit request targeting it
  returns stable `invalid_input`; it does not create a new conversation, replace
  the root, or insert a child that pretends to be a replacement root.
- `append_node` accepts an assistant leaf with no existing child.
  `create_branch` accepts an assistant that already has at least one child and
  preserves every existing child. Both reject other parent roles and arbitrary
  tree writes.
- User-facing write commands create only `user` nodes. Creating a conversation
  creates a `user` root; appending or branching creates a `user` child beneath
  an eligible assistant response; edit-as-branch accepts only a non-root
  `user` source and creates a `user` sibling.
- `assistant`, `system`, and `tool` nodes are reserved for later Rust-owned
  provider/application flows. Frontend command DTOs cannot select a role,
  model, stored ID, timestamp, or arbitrary metadata for user-authored nodes.
- Conversation titles are trimmed, must contain 1–200 Unicode scalar values,
  and are stored in trimmed form.
- User message content must contain at least one non-whitespace character and
  must not exceed 1 MiB of UTF-8. Validation does not trim or rewrite accepted
  content, preserving code indentation and intentional formatting.
- Rust assigns `model = null` and `metadata = {}` for user-authored nodes; the
  public write DTOs do not accept either field.
- Archiving is conversation-level only. Add durable
  `conversations.is_archived`; `archive_conversation` marks the conversation
  archived without rewriting any node.
- Archived conversations remain readable for history, but reject append,
  branch, edit, and later provider-generation operations. MVP has no node,
  branch-subtree, or restore/unarchive command.
- Existing node-level archive capability is retired from the application API
  and prevented for new writes. The compatibility column may remain in the
  pre-release schema, but no node may be inserted or updated as archived.

### Stable command DTOs

- Freeze these command names unless planning narrows them:
  `create_conversation`, `append_node`, `create_branch`,
  `edit_node_as_branch`, `load_conversation_tree`, `load_active_path`, and
  `archive_conversation`.
- Command inputs contain only action intent and user-editable data. Outputs use
  explicit DTOs for conversations, nodes, conversation trees, and validated
  active paths.
- DTOs use string IDs, integer epoch-millisecond timestamps, closed role/error
  unions, parsed JSON metadata, and explicit nullability.
- Command names and wire DTO fields use explicit `snake_case`; frontend domain
  types use idiomatic `camelCase`. Shared fixtures cover the conversion.
- DTO mapping is centralized. Persistence records and library errors are never
  serialized directly.

### Error contract

- Implement the closed `CommandErrorCode` taxonomy already defined in
  `.trellis/spec/backend/error-handling.md` and serialize one shape containing
  `code`, safe `message`, `retryable`, and optional non-sensitive `details`.
- Map persistence not-found, invalid-input, tree-integrity, database, and
  unexpected failures centrally. Do not branch on SQLite error text outside
  the persistence mapper.
- Preserve source chains for Rust diagnostics without exposing credentials,
  prompts, message content, provider bodies, or local database paths.
- Malformed or unknown frontend error payloads normalize to a safe,
  non-retryable `internal` error.

### TypeScript bridge and shared models

- Create the only raw Tauri bridge under `src/lib/tauri`, with an injectable
  invoke transport for deterministic unit tests.
- Treat every resolved/rejected payload as `unknown` and validate the complete
  shape with Zod before returning typed frontend data.
- Define shared conversation/domain projections under
  `src/features/conversations/types`, including the normalized
  `TreeNodeView`, `PathMessageView`, and `UiError` contracts already referenced
  by frontend specs.
- Map wire DTOs to frontend projections once. Components and future Zustand
  code import these types/functions rather than copying DTO or error unions.
- Provide one repository-owned success/error fixture that Rust serialization
  tests and TypeScript decoding tests both consume.

### Verification

- Rust tests cover command input validation, ID/time assignment, persistence
  error mapping, `CommandError` serialization, command registration, branch
  policy, and non-destructive edit transactions.
- Cross-layer fixture tests cover exact command names, wire field casing,
  nullability, metadata, timestamps, every error code, retryability, and
  malformed payload rejection.
- The edit regression proves the new sibling is returned while the source and
  all existing descendants remain unchanged.
- Active-path command/bridge tests preserve exact root-to-active order and
  explicitly exclude sibling sentinel content.
- Existing Rust, frontend, dependency, SQL-boundary, and Tauri debug-build
  quality gates continue to pass.

## Acceptance Criteria

- [x] All in-scope commands are registered and return typed DTOs or the one
      stable `CommandError` shape.
- [x] Production commands reuse the plugin-managed pool and contain no SQL or
      persistence-row serialization.
- [x] Rust, wire, and TypeScript fixtures agree on command names, field casing,
      nullability, metadata, timestamps, error codes, details, and retryability.
- [x] The TypeScript bridge validates unknown success/error payloads and is the
      only raw `invoke` caller in frontend source.
- [x] Shared camelCase conversation/tree/path/error projections are ready for
      the subsequent Zustand and component tasks without importing wire DTOs.
- [x] Branch commands enforce the approved MVP role/parent policy.
- [x] User-facing command DTOs cannot create or edit `assistant`, `system`, or
      `tool` nodes; user-authored nodes receive `role=user`, `model=null`, and
      safe default metadata in Rust.
- [x] Rust and TypeScript reject blank/oversized content and titles outside the
      trimmed 1–200 character range with the same `invalid_input` behavior;
      accepted message content round-trips byte-for-byte.
- [x] Editing an eligible historical node creates one sibling, preserves the
      original node and descendants, and selects/returns no fallback branch.
- [x] Editing the structural root is rejected as `invalid_input` and covered by
      a regression; no new conversation or replacement-root child is created.
- [x] `archive_conversation` is idempotent, changes only the conversation
      archive state, and preserves every node byte-for-byte.
- [x] Archived conversations remain readable but reject append, branch, edit,
      and future generation; node/subtree archive attempts are unavailable at
      IPC and rejected by the persistence boundary.
- [x] Missing, archived, malformed, invalid, and corrupt-tree operations map to
      stable safe errors; malformed frontend errors become `internal`.
- [x] Full frontend/Rust checks, real SQLite regressions, contract tests,
      dependency inspection, and the debug no-bundle Tauri build pass.

Acceptance evidence (2026-08-09): `command_boundary` proves deterministic
identity/time assignment, exact shared-fixture serialization, role/parent
policy, non-destructive edit descendants, root rejection, and archived-write
rollback. `tree_persistence` proves ordered v1-v3 migrations, node-flag
normalization/rejection, conversation archive idempotency/readability, byte
preservation, and active-path sibling exclusion. Mock IPC reaches every
registered handler. The fixture-driven TypeScript suite covers all commands,
closed errors/retryability, malformed payloads, nested metadata, timestamps,
null conversion, tree normalization, validation, and active-path isolation.
The recorded full validation matrix is in `implement.md`.

## Out of Scope

- Zustand store implementation, feature actions, React components, shadcn
  product UI, routing, or application-shell composition.
- Provider credentials, OpenAI-compatible requests, streaming, cancellation
  transport, or assistant response generation.
- Frontend SQL permissions, direct SQL plugin use, or a second Rust SQLite pool.
- Node-level archive, subtree archive, restore/unarchive, and deletion APIs.
- Canvas visualization, cross-branch references, summary compression, sync, or
  released-database migration work.
