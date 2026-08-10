# Technical Design

## Architecture and Boundaries

The repair extends the existing SQLite-to-React vertical slice instead of persisting a browser-side cursor or tree:

```text
SQLite conversations + nodes
  -> repository list query
  -> persistence service transaction
  -> list_conversations Tauri command
  -> strict Zod-decoded typed client
  -> Zustand history summaries + selected tree
  -> workspace history list and active path
```

Rust continues to own SQL and DTO serialization. `src/lib/tauri` remains the only raw invoke/runtime-validation boundary. The conversation feature store owns discovery, selection, and one authoritative loaded tree; components render state and emit user intent.

## Data Contract

Add a `list_conversations` command with an empty strict request and an ordered array of summaries:

- `id`, `title`, `root_node_id`, `is_archived`
- `updated_at`, derived as the maximum stored node `created_at`

The repository joins conversations to their nodes, groups by conversation identity, and orders by `updated_at DESC, id ASC`. Every valid conversation has a designated root node, so existing databases require no migration or backfill. Row mapping validates booleans and timestamps through existing persistence error conventions.

The TypeScript boundary validates the complete array, safe integer timestamps, and unique conversation IDs before projecting camelCase `ConversationSummaryView` values. The shared fixture and exact command-name tests change atomically with both sides.

## Startup and Selection Flow

On workspace mount, an idempotent store initialization lists summaries. If the list is empty, the state becomes `empty` and the new-conversation form remains available. Otherwise it chooses the first unarchived summary in the already ordered list, falling back to the first archived summary, and loads its existing validated tree.

Tree installation chooses a deterministic latest leaf by `(createdAt, id)` instead of always selecting the structural root. This reveals the complete most-recent path while retaining sibling isolation. It does not claim to restore the exact pre-exit cursor.

History state is a discriminated discovery status (`idle/loading/ready/empty/error`) plus summaries. A monotonic request epoch prevents stale startup/list/load completions from replacing a later user selection or newly created conversation. Development StrictMode may trigger effect setup twice without duplicating visible history or issuing conflicting selection commits.

Creating a conversation inserts/updates its summary and selects it. Archiving updates the corresponding summary while keeping it listed and readable. User selection loads only that summary's tree through the existing `loadConversationTree` command.

## UI Shape

The existing sidebar gains a compact `History` section above the current per-conversation outline. It exposes every conversation title, an archived indicator, selected state, and a retry affordance for discovery failures. Loading, empty, and error states are explicit. This is an extension of the current workspace, not a general redesign.

## Compatibility and Failure Behavior

- Existing `canopy.db` files are read without migration or cleanup.
- Archived conversations remain discoverable, readable, and immutable.
- Listing errors are normalized and retryable according to current command-error policy; the UI never treats failure as an empty database.
- A listed conversation disappearing before tree load fails safely without substituting another tree.
- Browser storage remains unused.

## Verification and Rollback

Add repository/service/command, client/schema, store, and component regressions. A file-backed test closes pool A, opens pool B on the same path, then lists and loads the original records. Existing full frontend and Rust suites provide compatibility coverage.

The implementation is additive and has no schema migration. Rollback is a code revert; existing database contents remain untouched.
