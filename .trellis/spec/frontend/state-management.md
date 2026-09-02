# Frontend State Management

> Zustand projections over SQLite-backed tree conversations.

## Current State

The conversation feature owns a normalized Zustand projection of one loaded
SQLite conversation plus a per-conversation generation-run registry (at most
one `GenerationRun` record per conversation ID, keyed by `generationRuns`).
Runs keep streaming when their conversation is not loaded (background
generation); the Rust side already enforces one active generation per
conversation and allows concurrency across conversations. The provider feature
owns a separate redacted-profile store. Neither store uses persist middleware;
SQLite and the native credential store remain the durable sources of truth.

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
  systemPrompt: string | null
  draftSystemPrompt: string | null
  nodesById: Readonly<Record<string, TreeNodeView>>
  expandedIds: ReadonlySet<string>
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error: UiError | null
  generationRuns: Readonly<Record<string, GenerationRun>>
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
  `setConversationSystemPrompt` uses the same epoch guard as
  `setConversationProvider` and must not patch history summaries. Close the
  settings dialog only after the stored `systemPrompt` matches the saved
  value — the action swallows IPC errors, so an optimistic close looks like
  success.
- Global non-Channel events (today: `conversation://title-updated`) are
  subscribed in a workspace/app hook, decoded in `src/lib/tauri`, then applied
  through `applyTitleUpdate`. That action patches the matching history
  summary title and, if loaded, `state.title`. It does not invent summary
  rows, touch `nodesById` or `generationRuns`, or take a mutation lock.
  Stores still never call `listen`.
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
  `draftSystemPrompt` follows the same draft-then-apply path as
  `draftBinding`: the controller writes it with
  `setConversationSystemPrompt` after create (after provider binding,
  before generate) and the store clears it on create/load/enter-blank.
- Deferred append, branch, and edit-as-branch actions capture a unique request
  epoch with the conversation, command target, and active selection. Completion
  rereads the live store, rejects a changed epoch/conversation, and merges
  backend authority into the live normalized tree.
- Stale failures must not replace the status or error owned by a newer load or
  blank-draft transition.

## Generation Runs, Interruption, and Off-Target Mutations

- Cancellation is synchronous in the store: `cancelGenerationRun` flips the
  run record's phase to `cancelled` immediately, so `isRunActive` is `false`
  as soon as the controller's `cancel()` returns. Mutation orchestration may
  cancel-then-proceed without awaiting the provider terminal event (the
  run/epoch guards ignore the late terminal).
- Run guards are per conversation, never global: `appendNode`, `createBranch`,
  and `editNodeAsBranch` reject only when **this** conversation has an active
  run (`isRunActive(generationRuns[conversationId])`). Switching or creating
  conversations, entering blank creation, and selecting nodes (view-only)
  stay available while any run is active.
- Whether a mutation interrupts a run is a user-intent decision owned by the
  workspace controller (e.g. behind a confirmation dialog), not by blanket
  store guards. `archiveConversation` therefore has no active-run
  early-returns; the controller cancels first when the confirmed target has
  an active run — current **or background** (persisting into an archived
  conversation would fail). Successful archive clears any lingering run
  record for the target.
- Terminal run records (`failed`, `cancelled`) stay keyed in the registry
  across conversation switches so re-entry can surface them inline; the next
  successful mutation or new run in that conversation supersedes the record.
  Re-entering a conversation with a run record restores `activeNodeId` to
  `run.parentNodeId` so the transient bubble is visible even when the newest
  leaf drifted (background regeneration).
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
user-message persistence, or coordinates background runs across conversation
switches.

### 2. State Shape

Generation lives in a per-conversation registry (`generationRuns`), not a
single-slot field. A missing record means idle; there is no `idle` phase.

```ts
type RunIdentity = {
  runId: number // monotonic, UI-scoped
  conversationId: string
  parentNodeId: string // the user node the reply attaches to
  generationId?: string // backend UUID once started
  model?: string
  priorChildIds: readonly string[] // children of parentNodeId at run start
  parentPreview?: string // truncated prompt preview (~60 chars) for toasts
}

type GenerationRun =
  | RunIdentity & { phase: "starting" }
  | RunIdentity & { phase: "streaming"; generationId: string; model: string; content: string }
  | RunIdentity & { phase: "cancelled"; content: string }
  | RunIdentity & { phase: "failed"; failureKind: "generation"; error: UiError }
  | RunIdentity & { phase: "failed"; failureKind: "persistence"; content: string; error: UiError }
```

Selectors: `selectCurrentRun` (foreground = record of the loaded
conversation), `selectActiveRunIds` (sidebar spinners, settings lock;
WeakMap-cached on registry identity), `isRunActive` (`starting | streaming`),
`findRunEntry(state, runId)`.

There are no stored finalization, retry-window, or duplicate terminal phases.
Streamed content is transient. Only the terminal `completed.node` or a fresh
authoritative tree reload can change normalized durable records.
`priorChildIds` exists so recovery never mistakes a pre-existing assistant
child (for example the old branch during a regeneration) for this run's
result.

### 3. Contracts

- Provider profile state contains only `ProviderProfileView`, a safe `UiError`,
  request status, and settings hydrated from `list_providers` (including
  `defaultSystemPrompt`). API-key text may exist in local dialog state while
  editing, but it is cleared on close and after every save attempt.
- Deltas live only in the run record's `content`. They never enter
  `nodesById`, the active path, or the outline.
- Creating a conversation, appending a user message, creating a branch, or
  editing a user message as a branch starts generation only after typed
  persistence returns authoritative data. The controller captures the
  persisted node from each mutation wrapper and passes it explicitly to
  `beginGeneration(parentNodeId)`, so the run targets the exact new user node
  even if the user browses elsewhere meanwhile; a conversation switch during
  persistence suppresses auto-start while leaving the persisted user message
  intact. An implicit `beginGeneration()` (manual Generate) still requires the
  visible path to end at the selected user node.
- A monotonically changing UI `runId` rejects stale callbacks. Event guards
  validate against the run record — conversation, parent node, generation ID —
  not against the loaded tree: a background run must keep streaming while
  another conversation is displayed. Fail-closed cancellation fires only on
  protocol mismatch, never because the visible tree moved.
- The controller may receive the terminal invoke result before delayed Channel
  callbacks. It accepts a result for the exact current run and ignores late
  callbacks after terminalization.
- Foreground vs background is decided at terminal time by
  `state.conversationId === run.conversationId`. Foreground terminals render
  inline; background `completed`/`failed` terminals also fire a toast
  (sonner, top-right) titled with the run's `parentPreview` (prompt,
  truncated) and a reply/error preview body; clicking the toast jumps back
  to the conversation. The preview must be read from the run record before
  the terminal store transition — completion deletes the record. Background
  completion updates the history summary timestamp only — the tree is
  refreshed by the next load. Runs are never cancelled by unmount or by
  switching conversations; the controller has no unmount cancel.
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
| Archived conversation, unsafe path, non-user selection, or active run for this conversation | Generation rejected locally |
| Exact persisted user target remains valid | Start one generation from that target |
| Persistence fails or the conversation is replaced while awaiting | Keep authoritative persisted state; do not auto-start |
| Conversation switch or controller unmount while running | Run continues in the background; no cancellation |
| Another conversation loaded at terminal time | Background terminal: summary bump + toast; no tree mutation |
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
- **Bad**: inserting deltas optimistically, cancelling a run because the
  visible tree moved away from its parent, cancelling because a promise
  resolves after an exact result, or inventing a node when reload does not
  prove completion.

### 6. Tests Required

- Assert pre-terminal deltas change transient content while normalized maps stay
  unchanged; assert inactive sibling content is absent from the active path.
- For create, append, create-branch, and edit-as-branch, assert persistence
  resolves before generation, exact returned conversation/user IDs are used,
  and generation occurs once.
- Cover result-before-callback, persistence failure before `started`,
  cancel-before-started, stale events, terminal stage classification, exact
  cancellation, invoke rejection, one-shot reload, target replacement,
  provider changes, and manual regeneration.
- Cover background semantics: conversation switch mid-run keeps streaming;
  background completion bumps the summary and clears the record without
  touching the loaded tree; background failure keeps the record and fires a
  toast; re-entry focuses `run.parentNodeId`; per-conversation mutation locks
  (same conversation blocked, other conversation free); recovery uses
  `priorChildIds` to reject a pre-existing assistant child.
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
setRunRecord(state, conversationId, { ...run, phase: "streaming", content })
const terminal = await providerClient.generateFromActivePath(
  conversationId,
  parentNodeId,
  onEvent,
)
// Merge only terminal.node after all invariants pass, or reload authority once.
// If another conversation is loaded by then, bump the summary and toast.
```

Transient presentation is allowed before terminal authority, but only the
backend result or a durable reload changes conversation records.

## Scenario: Durable Appearance Theme Color

### 1. Scope / Trigger

Use this contract when adding or changing the Appearance theme-color Select,
the shadcn `primary` palette, the `theme_color` settings key, or any field in
the startup `list_providers` settings aggregate.

### 2. Signatures

```text
app_settings["theme_color"] =
  neutral | blue | green | orange | red | rose | violet

list_providers({}) -> { ..., theme, theme_color, ... }
set_theme_color({ theme_color }) -> { theme_color }

type ThemeColorPreference = (typeof THEME_COLORS)[number]
<html data-theme-color="blue"> -> --primary / --primary-foreground
```

`THEME_COLORS` is the frontend source for the resolver, Zod schema, and Select
options. Rust owns a matching exhaustive `ThemeColorPreference` enum at the
IPC/storage boundary.

### 3. Contracts

- SQLite is durable authority. Missing `theme_color` means `neutral`; do not
  add a migration, Zustand persist middleware, or browser storage.
- The settings repository/service and strict `set_theme_color` command own the
  KV round trip. `list_providers` remains the aggregate startup read.
- `useProviderStore.themeColor` is the loaded durable projection.
  `useThemeStore.themeColor` is the UI-only projection. Hydration and a
  successful authoritative write update both; a failed write keeps both on
  the previous value and uses the existing Appearance error Alert.
- `DocumentThemeSync` applies non-neutral values through
  `document.documentElement.dataset.themeColor`; Neutral removes the
  attribute so the original theme tokens remain the fallback.
- `src/index.css` owns palette values. Each color maps only the shadcn
  `--primary` / `--primary-foreground` pair in light and dark modes. The same
  custom property drives the option/trigger swatch; do not duplicate raw
  colors in the component or change background, accent, chart, or sidebar
  token families as part of this preference.
- The Appearance control uses the existing Radix shadcn `Select`, keeps every
  `SelectItem` inside `SelectGroup`, includes the swatch inside item text so
  `SelectValue` renders it, has an accessible field label, and is disabled
  during the provider-store loading phase.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| KV key absent | Resolve Neutral and preserve the legacy appearance |
| Request contains one of the seven values | Persist and return the same value |
| Request contains any other value | `invalid_input`, field `theme_color`, reason `invalid_theme_color`, before DB access |
| Stored KV value is unknown | `SettingsError::CorruptValue`; do not silently reset it |
| Aggregate `theme_color` is unknown/missing | Strict Zod decode rejects the response |
| Save rejects | Provider/theme stores and selected trigger retain the prior color; show Appearance Alert |
| Light/dark mode changes | Selected color remains; CSS resolves the mode-specific primary pair |

### 5. Good / Base / Bad Cases

- **Good**: Violet is saved, both stores adopt the returned value, `<html>`
  carries `data-theme-color="violet"`, and primary surfaces plus the selected
  swatch use the dark/light Violet pair.
- **Base**: an upgraded profile has no key, resolves Neutral, and renders the
  exact pre-feature primary colors without an attribute.
- **Bad**: writing `localStorage`, applying raw `bg-blue-*` classes to primary
  components, changing state before the command succeeds without rollback, or
  defining the seven-value list separately in resolver/schema/component code.

### 6. Tests Required

- Rust: missing-key default, all seven KV round trips, corrupt value,
  command validation before database access, command registration, and shared
  provider fixture round trip.
- Bridge: strict request/result and aggregate decoding, snake/camel mapping,
  and invalid/missing values.
- Stores/App: startup hydration, successful write, failure preservation in
  both stores, Neutral fallback, root attribute application/removal, and no
  conversation-workspace re-render.
- Appearance: seven option labels/swatches, selected trigger swatch, bilingual
  relabelling, keyboard-accessible Select, loading disablement, successful
  selection, and failure rollback/Alert.

### 7. Wrong vs Correct

#### Wrong

```ts
localStorage.setItem("themeColor", color)
document.documentElement.style.setProperty("--primary", "#2563eb")
set({ themeColor: color }) // optimistic durable state with no rollback
```

#### Correct

```ts
const stored = await client.setThemeColor(themeColor)
set({ ...previous, themeColor: stored })
useThemeStore.getState().setThemeColorPreference(stored)
// DocumentThemeSync maps the closed value to CSS-owned semantic tokens.
```

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
- Cancelling a background run because the loaded tree is a different
  conversation, or blocking sidebar switching/creation because some run is
  active somewhere.
- Treating an invoke transport error as proof that durable persistence failed;
  use the one-shot authoritative reload when a generation may have started.
