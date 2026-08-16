# Frontend State Management

> Zustand projections over SQLite-backed tree conversations.

## Current State

The conversation feature owns a normalized Zustand projection of one loaded
SQLite conversation plus one transient generation lifecycle. The provider
feature owns a separate redacted-profile store. Neither store uses persist
middleware; SQLite and the native credential store remain the durable sources
of truth.

## State Categories

| State | Owner | Examples |
|---|---|---|
| Durable domain state | SQLite through Rust repositories | conversations and immutable nodes; archive state belongs to conversations |
| Loaded client projection | conversation Zustand store | ordered history summaries, normalized nodes, root ID, active node ID |
| Transient feature UI | feature store or local component state | expanded IDs, loading/streaming status |
| Ephemeral control state | local component state | open menu, draft field, dialog visibility |
| Provider secrets | native/provider boundary | never persisted in Zustand or browser storage |

Do not mirror every local input into Zustand. Promote state only when multiple
feature components coordinate through it or when a stable action/selector owns a
domain projection.

## Conversation Store Shape

Store a normalized projection keyed by node ID:

```ts
type ConversationTreeState = {
  isCreatingConversation: boolean
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
- Persistence actions call the typed Tauri bridge, then merge the returned
  authoritative DTO. They do not mutate durable history optimistically.
- Selectors are pure, narrow, and exported from the store module.
- Keep one owner for root-to-active projection. It must preserve order and
  exclude siblings; malformed state returns an explicit integrity state rather
  than falling back to all nodes.
- Preserve object identity for unchanged nodes so narrow subscriptions remain
  useful. Use immutable updates; historical node content, parent IDs, and
  conversation IDs are never changed in client state.

## Durable State and Rehydration

- Do not use Zustand `persist`, `localStorage`, or IndexedDB for conversation
  records. Reload durable state from SQLite through typed commands.
- Do not issue SQL from the webview even though the Tauri SQL plugin is
  installed.
- Use a monotonic request epoch so StrictMode initialization and stale
  list/tree responses cannot replace a later selection or newly created tree.
- A loaded tree selects a deterministic latest leaf by `(createdAt, id)`.
- A failed load preserves the last safe visible projection when possible and
  records a normalized `UiError`; it never substitutes another branch.
- After a successful branch/edit command, merge the returned node and select it
  only according to the feature action contract.

## Blank Draft and Mutation Completion Ownership

- `isCreatingConversation` is store-owned transient workspace state because
  History and the main pane must agree on whether the preserved tree is being
  displayed. Entering it increments the request epoch and preserves the loaded
  projection and history summaries.
- A blank draft has no durable conversation or fabricated root. Its first
  Composer submit derives a local title and calls the existing atomic
  conversation-plus-user-root command. Successful creation installs the
  returned tree; failure retains the draft and previous safe projection.
- Deferred append, branch, and edit-as-branch actions capture a unique request
  epoch with the conversation, command target, and active selection. Completion
  rereads the live store, rejects a changed epoch/conversation, and merges
  backend authority into the live normalized tree.
- Stale failures must not replace the status or error owned by a newer load or
  blank-draft transition.

## Generation Interruption and Off-Target Mutations

- Cancellation is synchronous in the store: `cancelGenerationRun` flips
  `generation.phase` to `cancelled` immediately, so `isGenerationActive` is
  `false` as soon as the controller's `cancel()` returns. Mutation
  orchestration may cancel-then-proceed without awaiting the provider
  terminal event (the run/epoch guards ignore the late terminal).
- Whether a mutation interrupts the active generation is a user-intent
  decision owned by the workspace controller (e.g. behind a confirmation
  dialog), not by blanket store guards. `archiveConversation` therefore has
  no `isGenerationActive` / `status !== "ready"` early-returns; the
  controller cancels first when — and only when — the confirmed target is
  the generating current conversation.
- Mutations targeting a conversation other than the currently loaded one
  (e.g. archive-by-ID from a history row) must not touch the global
  conversation `status`/`error` — that would disable the whole workspace for
  an unrelated failure. Route their errors to the owning slice's channel
  (history rows use `history.status`/`history.error`, rendered by the
  sidebar history Alert).

## Scenario: Provider Generation Workspace Projection

### 1. Scope / Trigger

Use this contract when a workspace action consumes the typed provider client,
renders streamed assistant content, starts generation after authoritative
user-message persistence, or cancels generation during navigation/unmount.

### 2. State Shape

The conversation store has a closed generation union:

```ts
type GenerationState =
  | { phase: "idle" }
  | { phase: "starting"; runId: string; target: GenerationTarget }
  | { phase: "streaming"; runId: string; target: GenerationTarget; generationId: string; model: string; content: string }
  | { phase: "cancelled"; runId: string; target: GenerationTarget; generationId?: string; content: string }
  | { phase: "failed"; runId: string; target: GenerationTarget; kind: "generation" | "persistence"; error: UiError; content?: string }
```

There are no stored finalization, retry-window, or duplicate terminal phases.
Streamed content is transient. Only the terminal `completed.node` or a fresh
authoritative tree reload can change normalized durable records.

### 3. Contracts

- Provider profile state contains only `ProviderProfileView`, a safe `UiError`,
  and request status. API-key text may exist in local dialog state while
  editing, but it is cleared on close and after every save attempt.
- Deltas live only in `GenerationState.content`. They never enter
  `nodesById`, the active path, or the outline.
- Creating a conversation or appending a user message starts generation only
  after typed persistence returns authoritative data and the store accepts that
  exact conversation/user node as the current target. A replaced target,
  unmounted controller, unavailable provider, or unsafe path suppresses
  auto-start while leaving the persisted user message intact.
- A monotonically changing UI `runId` rejects stale callbacks. Conversation,
  selected user parent, generation ID, model, and current path must still match
  before accepting events or terminal results.
- The controller may receive the terminal invoke result before delayed Channel
  callbacks. It accepts a result for the exact current run and ignores late
  callbacks after terminalization.
- A persistence-stage terminal result remains a persistence failure even when
  it wins the result-before-`started` callback race; its retained content is
  empty until any streamed content has been accepted.
- `starting` and `streaming` are the only user-cancellable phases. Exact
  backend `cancelled` terminal results are accepted even after the user has
  clicked Cancel and retain received content.
- A valid pre-finalization `failed` result is a generation failure and drops
  partial output. A persistence failure retains the complete streamed content.
  Branch on the validated terminal stage, never an error message.
- A completed node is merged only after identity, role, parent, model,
  writability, uniqueness, and tree-integrity checks. If it cannot be merged,
  reload the conversation once; never guess a node from transient content.
- If an invoke rejects after a known generation has started, request exact
  cancellation and perform at most one authoritative reload. If the reload
  cannot prove a result, expose a normal safe generation/persistence failure.

### 4. Validation & Error Matrix

| Condition | Store/controller result |
|---|---|
| Provider missing/loading/error | Generation disabled; ordinary conversation actions remain available |
| Archived conversation, unsafe path, non-user selection, or active run | Generation rejected locally |
| Exact persisted user target remains active | Start one generation from that target |
| Persistence fails or target is replaced while awaiting | Keep authoritative persisted state; do not auto-start |
| Navigation/unmount while running | Invalidate the run and best-effort exact-cancel the known ID |
| Valid delta for the current run | Update transient content only |
| Valid generation failure | Failed generation state without partial output |
| Valid persistence failure | Failed persistence state retaining complete content |
| Valid exact cancellation | Cancelled state retaining available content; no durable node |
| Exact completed node matches invariants | Merge authoritative node and return to idle |
| Completed node drifts or invoke delivery is ambiguous | Reload once; do not merge transient content |
| Reload cannot prove one result | Safe failed state with regeneration available |

### 5. Good / Base / Bad Cases

- **Good**: two sibling branches exist, generation uses only the selected user
  path, transient content appears outside the tree, and the exact completed
  assistant becomes one new child without changing its sibling.
- **Base**: no provider profile disables Generate but still permits creating,
  appending, loading, navigating, and reading local conversations.
- **Bad**: inserting deltas optimistically, starting from a mutable post-await
  selection, cancelling because a promise resolves after an exact result, or
  inventing a node when reload does not prove completion.

### 6. Tests Required

- Assert pre-terminal deltas change transient content while normalized maps stay
  unchanged; assert inactive sibling content is absent from the active path.
- For create and append, assert persistence resolves before generation, exact
  returned conversation/user IDs are used, and generation occurs once.
- Cover result-before-callback, persistence failure before `started`,
  cancel-before-started, stale events, terminal stage classification, exact
  cancellation, invoke rejection, one-shot reload, target replacement, unmount,
  provider changes, and manual regeneration.
- Drift each completed-node invariant independently and assert no direct merge.
- Assert API-key input is absent from store snapshots, logs, and browser
  persistence. Run bridge, store/controller/component, build, and Rust tests.

### 7. Wrong vs Correct

#### Wrong

```ts
set({ nodesById: addAssistantFromDeltas(content) })
await providerClient.generateFromActivePath(conversationId, activeNodeId, onEvent)
```

#### Correct

```ts
set({ generation: { ...currentRun, phase: "streaming", content } })
const terminal = await providerClient.generateFromActivePath(
  conversationId,
  activeNodeId,
  onEvent,
)
// Merge only terminal.node after all invariants pass, or reload authority once.
```

Transient presentation is allowed before terminal authority, but only the
backend result or a durable reload changes conversation records.

## Testing

- Test store actions and selectors without React when possible.
- Use stable IDs and explicit timestamps.
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
- Treating an invoke transport error as proof that durable persistence failed;
  use the one-shot authoritative reload when a generation may have started.
