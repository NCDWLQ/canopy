# Frontend State Management

> Zustand projections over SQLite-backed tree conversations.

## Current State

Zustand is pinned in `package.json`, and
`src/features/conversations/store/README.md` reserves the future store
boundary. No product store exists yet. SQLite remains the durable source of
truth; the current React shell has no durable or global client state.

The first store implementation must prove the approved normalized tree model
rather than introducing a generic application-wide store.

## State Categories

| State | Owner | Examples |
|---|---|---|
| Durable domain state | SQLite through Rust repositories | conversations, nodes, archived state |
| Loaded client projection | conversation Zustand store | normalized nodes, root ID, active node ID |
| Transient feature UI | feature store or local component state | expanded IDs, loading/streaming status |
| Ephemeral control state | local component state | open menu, draft field, dialog visibility |
| Provider secrets | native/provider boundary | never persisted in Zustand or browser storage |

Do not mirror every local input into Zustand. Promote state only when multiple
feature components coordinate through it or when a stable action/selector owns
a domain projection.

## Conversation Store Shape

Store a normalized projection keyed by node ID:

```ts
type ConversationTreeState = {
  conversationId: string | null
  rootNodeId: string | null
  activeNodeId: string | null
  nodesById: Readonly<Record<string, TreeNodeView>>
  expandedIds: ReadonlySet<string>
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error: UiError | null
}
```

The final types live in `src/features/conversations/types` and are shared with
component props; do not copy this example into several files. IPC DTOs are
decoded and projected before entering the store.

## Actions and Selectors

- Actions describe user/domain intent: load a conversation, select a node,
  toggle expansion, append, create a branch, edit as a branch, and archive.
- Persistence actions call the typed Tauri bridge, then reconcile the returned
  authoritative DTO. They do not mutate durable history optimistically.
- Selectors are pure, narrow, and exported from the store module.
- Keep one owner for root-to-active projection. It must preserve order and
  exclude siblings; malformed state returns an explicit integrity state rather
  than falling back to all nodes.
- Preserve object identity for unchanged nodes so narrow subscriptions remain
  useful.
- Use immutable updates. Historical node content, parent IDs, and conversation
  IDs are never changed in client state.

## Durable State and Rehydration

- Do not use Zustand `persist`, `localStorage`, or IndexedDB for conversation
  records. Reload durable state from SQLite through typed commands.
- Do not issue SQL from the webview even though the Tauri SQL plugin is
  installed.
- A failed load preserves the last safe visible projection when possible and
  records a normalized `UiError`; it never substitutes another branch.
- After a successful branch/edit command, merge the returned node and select
  it only according to the feature action contract.

## Testing

- Test store actions and selectors without React when possible.
- Use stable IDs and explicit timestamps/order.
- Verify original inputs and unaffected nodes remain unchanged.
- For every path-sensitive test, build two sibling branches and assert the
  inactive sentinel is absent.
- Test malformed IPC payloads at `lib/tauri`, not by inserting untyped values
  directly into component tests.

## Common Mistakes

- Storing database rows or canonical JSON text directly in Zustand.
- Treating a branch as a copied conversation or rewriting a historical node.
- Deriving the active path separately in several components.
- Persisting secrets or conversation history in browser storage.
- Using one global store for unrelated provider-form and conversation-tree
  state.
- Clearing valid visible state after a retryable command failure.
