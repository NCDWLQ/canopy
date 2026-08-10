# Frontend State Management

> Zustand projections over SQLite-backed tree conversations.

## Current State

The conversation feature owns a normalized Zustand projection of one loaded
SQLite conversation plus one transient generation lifecycle. The provider
feature owns a separate redacted-profile Zustand store. Neither store uses
persist middleware; SQLite and the native credential store remain the durable
sources of truth.

## State Categories

| State | Owner | Examples |
|---|---|---|
| Durable domain state | SQLite through Rust repositories | conversations and immutable nodes; archive state belongs to conversations |
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
  isArchived: boolean
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

## Scenario: Provider Generation Workspace Projection

### 1. Scope / Trigger

Use this contract when a workspace action consumes the typed provider client,
renders streamed assistant content, automatically acknowledges
`ready_to_commit`, starts generation after authoritative user-message
persistence, cancels generation during navigation, or reconciles an ambiguous
acknowledged commit.

### 2. Signatures

The provider store accepts an injected client but stores only redacted state:

```ts
loadProfile(client: ProviderClient): Promise<void>
saveProfile(client: ProviderClient, input: SaveProviderProfileInput): Promise<void>
deleteProfile(client: ProviderClient): Promise<void>
```

The conversation store exposes a closed `GenerationState` with `idle`,
`starting`, `streaming`, `committing`, `reconciling`, `completed`, `failed`,
and `cancelled` phases. The workspace controller exposes `generate`, `cancel`,
mutation wrappers, and `retryReconciliation`; its default terminal-delivery
grace period is 1,500 milliseconds and is injectable in tests.

### 3. Contracts

- Provider profile state contains only `ProviderProfileView`, a safe `UiError`,
  and request status. An API-key field may exist in local dialog state while
  the user edits it, but it is cleared on close and after every save attempt.
  The key may pass through the one-way save action argument; it never becomes a
  Zustand field, response, error, log, or browser-persisted value.
- Generation deltas live only in `GenerationState.content`. They never enter
  `nodesById`, `fullNodes`, the durable active path, or the outline.
- Creating a conversation or appending a user message starts generation only
  after the corresponding typed persistence call returns authoritative data and
  the store accepts that exact conversation/user node as the current target.
  Capture the target IDs from that persistence result, then re-read the live
  conversation and provider stores; never infer success from mutable post-await
  state or a changed object reference. A replaced target, unmounted controller,
  unavailable provider, unsafe path, or active run suppresses auto-start while
  leaving the persisted user message intact. Manual Generate remains the retry
  path.
- A monotonically changing UI `runId` rejects stale callbacks. Conversation,
  selected user parent, generation ID, model, and current safe path must still
  match before `ready_to_commit` changes the phase to `committing`.
- The commit token remains callback-local and is passed directly to
  `commitGeneration` exactly once. It is never stored, rendered, logged, or
  copied into a prop.
- Only an exact `completed.node` or an authoritative
  `loadConversationTree` result may change durable normalized records. Direct
  completion merge verifies conversation, user parent, assistant role, model,
  content, unique ID, writability, and complete tree integrity.
- A generation command result may resolve after Channel events. If the Channel
  already recorded the same generation and advanced the current run, the late
  result is accepted and must not trigger cancellation. A cancelled, replaced,
  stale, or mismatched run requests exact-ID cancellation.
- A thrown commit call is ambiguous: the backend may already be committing.
  Keep accepting the exact terminal event during a bounded grace period, then
  reload SQLite. If the first reload has no matching durable result, remain in
  a retryable `reconciling` state and continue accepting exact `completed`;
  never infer failure or fabricate a node.

### 4. Validation & Error Matrix

| Condition | Store/controller result |
|---|---|
| Provider missing/loading/error | Generation disabled; local conversation actions retain their normal capability |
| Archived conversation, unsafe path, non-user selection, or active run | Generation rejected locally |
| Create/append returns and the exact authoritative user target remains active | Start one generation from that target |
| Persistence fails, target is replaced, controller unmounts, or provider becomes unavailable while awaiting | Keep any authoritative persisted state; do not auto-start generation |
| Navigation/unmount before acknowledgement | Invalidate the run, discard transient content, best-effort exact cancel when the ID is known |
| Exact ready for a current writable user path | Enter committing, pass the callback-local token once |
| Commit returns `accepted: false` | Retryable failed state; no durable node |
| Exact completed node matches every invariant | Merge authoritative node; preserve unrelated branches/history |
| Completed node drifts or post-ack delivery is ambiguous | Reload SQLite authority; do not merge transient content |
| Reconciliation load fails or sees no provable result | Preserve the last safe tree and expose retryable reconciliation |

### 5. Good / Base / Bad Cases

- **Good**: two sibling branches exist, generation uses only the selected user
  path, transient content appears outside the tree, and the exact completed
  assistant becomes one new child without changing its sibling.
- **Base**: no provider profile disables Generate but still permits creating,
  appending, loading, navigating, and reading local conversations; saved user
  messages remain available without automatic generation.
- **Bad**: inserting deltas optimistically, saving a commit token in Zustand,
  starting generation from whichever node happens to be active after an awaited
  persistence call, cancelling because the start promise resolved after an
  exact completed event, or declaring failure because an early reconciliation
  reload did not yet observe the commit.

### 6. Tests Required

- Assert pre-ready deltas change transient content while both normalized maps
  remain unchanged; assert the sibling sentinel is absent from the request and
  rendered path.
- For create and append, assert persistence resolves before generation, the
  exact returned conversation/user IDs are used, and generation occurs once.
  Cover persistence failure, invalid authoritative data, provider changes while
  awaiting, target replacement, unmount, an already-active run, and manual retry
  after a generation-start failure.
- Cover started-before-result and result-before-started, completed-before-
  commit-result, completed-before-start-result, cancel-before-start, stale
  ready, commit rejection, commit transport ambiguity, and exact completion
  before and after an early reconciliation reload.
- Drift each completed-node invariant independently and assert no direct merge.
- Assert API-key input and commit token are absent from store snapshots, DOM
  after submission/ready handling, logs, and browser persistence.
- Run the typed bridge tests, store/controller/component tests, production
  frontend build, Rust generation tests, and Tauri debug build together for
  integration changes.

### 7. Wrong vs Correct

#### Wrong

```ts
set({ nodesById: addAssistantFromDeltas(content), commitToken })
await providerClient.commitGeneration(generationId, commitToken)
```

#### Correct

```ts
set({ generation: { ...currentRun, phase: "committing", content } })
const result = await providerClient.commitGeneration(generationId, event.commitToken)
// Merge only a later exact completed.node, or replace from a SQLite reload.
```

Transient presentation is accepted before acknowledgement, but only backend
authority changes durable conversation records.

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
- Treating a commit transport error as proof that acknowledgement was rejected.
- Cancelling a current run merely because its command promise resolved after
  the Channel already advanced or completed that exact generation.
