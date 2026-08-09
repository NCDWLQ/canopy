# Frontend Type Safety

> Strict TypeScript and runtime validation at the Tauri trust boundary.

## Compiler Baseline

`tsconfig.app.json` enables `strict`, `noUncheckedIndexedAccess`, isolated
modules, and no emit. Keep these settings enabled. The build and `pnpm
typecheck` are both required gates; do not weaken the compiler to accommodate
a feature.

The application alias is `@/* -> ./src/*` in both TypeScript and Vite.
`components.json` points shadcn utilities and primitives at that same alias.

## Type Ownership

- Feature projections and component contracts live under
  `src/features/<feature>/types`.
- The TypeScript Tauri bridge owns request/response DTOs, runtime schemas, and
  normalization from unknown IPC values under `src/lib/tauri`.
- Components import shared view models and emit typed callbacks; they do not
  redeclare IPC or database shapes.
- Component-local types stay next to the component when no other module uses
  them.
- Generated shadcn primitive props should extend the underlying React element
  props, as `src/components/ui/button.tsx` does with
  `React.ComponentProps<"button">` and `VariantProps`.

## Runtime Validation

Generic parameters on Tauri `invoke` do not validate runtime data. Treat every
resolved value and rejection as `unknown`, validate it once in `src/lib/tauri`,
and return a frontend type only after the complete shape is accepted.

Zod is already pinned in `package.json` and is the default schema tool for IPC
payloads. Schemas must validate:

- the closed role and error-code unions;
- string IDs and integer epoch-millisecond timestamps;
- explicit nullable fields and JSON metadata;
- the complete `CommandError` shape, including retryability and safe details.
- request strings as valid Unicode scalar sequences, with blank checks and
  title trimming that use the same Unicode whitespace set as Rust; JavaScript
  `trim()` alone is not equivalent and lone UTF-16 surrogates cannot round-trip
  through Rust UTF-8 strings;
- normalized conversation trees as one graph fully reachable from the
  designated structural root, using an intermediate map and a prototype-free
  record so opaque IDs cannot collide with object prototype properties.

Malformed or unknown error payloads normalize to a safe, non-retryable
`internal` error. Components never parse error messages for control flow.

## Scenario: Typed Conversation IPC Boundary

### 1. Scope / Trigger

Use this contract when adding or changing a conversation Tauri command, its
request/response DTO, error envelope, shared fixture, or frontend projection.
The owning files are `src-tauri/src/conversations/commands.rs`,
`src-tauri/src/error.rs`, `contract-fixtures/conversation-ipc.json`,
`src/lib/tauri/`, and `src/features/conversations/types/`.

### 2. Signatures

The frontend exposes one injected client rather than raw `invoke` calls:

```ts
createConversation({ title, content }): Promise<ConversationTreeView>
appendNode({ conversationId, parentNodeId, content }): Promise<ConversationNodeView>
createBranch({ conversationId, parentNodeId, content }): Promise<ConversationNodeView>
editNodeAsBranch({ conversationId, sourceNodeId, content }): Promise<ConversationNodeView>
loadConversationTree(conversationId): Promise<ConversationTreeView>
loadActivePath(conversationId, activeNodeId): Promise<ActivePathView>
archiveConversation(conversationId): Promise<ConversationView>
```

These map to the frozen snake-case commands `create_conversation`,
`append_node`, `create_branch`, `edit_node_as_branch`,
`load_conversation_tree`, `load_active_path`, and `archive_conversation`.

### 3. Contracts

- Every invoke call sends `{ request: <strict snake_case DTO> }`.
- Rust responses use explicit nulls for nullable `parent_id` and `model`;
  `src/lib/tauri` converts them to optional camelCase feature properties.
- Node DTOs contain no archive field. `ConversationView.isArchived` is the only
  archive state exposed to frontend code.
- `ConversationTreeView.nodesById` is prototype-free and every returned node
  must be reachable exactly once from `rootNodeId`.
- `contract-fixtures/conversation-ipc.json` is consumed by both Rust and
  TypeScript tests; do not copy its DTO examples into a second fixture.

### 4. Validation & Error Matrix

| Condition | Frontend result |
|---|---|
| Blank/oversized content, invalid title/ID, or lone UTF-16 surrogate | local non-retryable `invalid_input`; no invoke |
| Valid rejected `CommandError` payload | `ConversationCommandError` preserving code/retryability/safe details |
| Unknown/malformed rejected payload | generic non-retryable `internal` |
| Malformed success DTO, duplicate/foreign node, bad root, disconnected component, or cycle | generic non-retryable `internal` |
| Valid archived conversation response | readable `ConversationView` with `isArchived = true`; callers disable mutations |

Title trimming and blank checks must use Rust's Unicode whitespace set.
Content limits use UTF-8 byte length, not JavaScript UTF-16 code units.

### 5. Good / Base / Bad Cases

- **Good**: a two-branch tree decodes into one normalized graph, the active
  path preserves root-to-active order, and the inactive sentinel is absent.
- **Base**: a one-node user-root conversation decodes with null parent/model
  and empty metadata without inventing an assistant node.
- **Bad**: a DTO containing a valid designated root plus a disconnected cycle,
  or an opaque ID such as `constructor`, never corrupts or bypasses projection.

### 6. Tests Required

- Assert all seven command names, the outer `request` wrapper, and exact
  snake-case request fields through an injected transport.
- Decode every shared success fixture and reject malformed conversation, node,
  tree, and active-path fixtures.
- Exercise all public error codes, malformed errors, nullability, nested
  metadata, safe integer timestamps, Unicode whitespace, lone surrogates, and
  the 1 MiB UTF-8 boundary.
- Prove duplicate/foreign nodes, missing parents, wrong roots, disconnected
  components, cycles, and prototype-like IDs fail closed or normalize safely.
- Keep Rust serialization tests on the same shared fixture so either side fails
  when casing or shape drifts.

### 7. Wrong vs Correct

#### Wrong

```ts
const tree = await invoke<ConversationTreeView>("load_conversation_tree", args)
```

The generic parameter does no runtime validation and leaks the wire shape into
feature code.

#### Correct

```ts
const client = createConversationClient(injectedTransport)
const tree = await client.loadConversationTree(conversationId)
```

The bridge validates unknown data, checks the complete graph, and returns only
the canonical camelCase projection.

## Type Patterns

- Prefer discriminated unions for loading/streaming/error states instead of
  related booleans that allow impossible combinations.
- Prefer `readonly` arrays and read-only records at component boundaries.
- Use `satisfies` for fixtures/configuration when inference should be retained
  while a contract is checked.
- Model IPC nullability explicitly. Convert `null` to an optional frontend
  property only in the bridge/projection layer, not ad hoc in components.
- Check indexed values before use; do not bypass `noUncheckedIndexedAccess`.
- Keep IDs as the shared string aliases currently defined by the component
  contract; introduce branded IDs only through a coordinated contract change.

Example fixture shape:

```ts
const activePath = [
  { id: "root", role: "system", content: "safe fixture" },
  { id: "right", role: "user", content: "active branch" },
] satisfies readonly PathMessageView[]
```

## Scenario: Provider Profile and Generation IPC Boundary

### 1. Scope / Trigger

Use this contract when changing `src/lib/tauri/provider-*`, provider projection
types, `contract-fixtures/provider-ipc.json`, or any later UI action that
consumes the frozen provider client.

### 2. Signatures

```ts
saveProviderProfile(input: SaveProviderProfileInput): Promise<ProviderProfileView>
loadProviderProfile(): Promise<ProviderProfileView>
deleteProviderProfile(): Promise<boolean>
generateFromActivePath(conversationId, activeNodeId, onEvent): Promise<GenerationStartView>
cancelGeneration(generationId): Promise<CancelGenerationView>
commitGeneration(generationId, commitToken): Promise<CommitGenerationView>
```

All six calls reuse `InvokeTransport`; generation alone creates one
`Channel<unknown>` and validates values before invoking `onEvent`.

### 3. Contracts

- Requests use one `{ request: snake_caseDto }` wrapper; generation also sends
  `onEvent`. Only `src/lib/tauri` owns raw `invoke` and `Channel` construction.
- Save accepts explicit `keep`, `replace`, or `remove`. A replacement value is
  present only in the one-way request and is never part of a response,
  projection, fixture success, store, or component prop.
- String inputs reject lone UTF-16 surrogates. Blank checks and model trimming
  use Rust's Unicode whitespace set; byte limits use `TextEncoder`.
- Channel order is `started`, zero or more bounded `delta` events, one
  `ready_to_commit`, then one `completed`, `failed`, or `cancelled`; a
  pre-ready failure/cancellation is also legal. Every event after `started`
  matches its canonical UUID v4 generation ID. No delta is valid after ready,
  and no completed event is valid before ready.
- `ready_to_commit.commit_token` is a canonical UUID v4, transient
  generation-scoped capability. The bridge validates and projects it but never
  auto-acknowledges, persists, logs, or stores it. Later UI code calls
  `commitGeneration` once only after it has accepted the complete transient
  stream as the current exact generation.
- `started` conversation/active IDs must equal the request. `completed.node`
  must be an assistant in that conversation, parented by the active user, use
  the started model, and contain exactly the concatenated deltas. Cumulative
  delta content is bounded to one MiB.
- Any malformed payload, invalid transition, identity mismatch, bound breach,
  or completed-node drift produces one safe local `internal` failure and
  requests exact-ID cancellation when an authoritative ID is known.

### 4. Validation & Error Matrix

| Condition | Frontend result |
|---|---|
| Invalid endpoint/model/key/ID or lone surrogate | local `invalid_input`; no invoke |
| Malformed command success/rejection | safe non-retryable `internal` |
| Delta before started or generation mismatch | one `internal`; exact cancel |
| Any value after a terminal event | ignored; never emit a second local terminal event |
| Started request-identity mismatch | one `internal`; cancel returned generation ID when known |
| Cumulative deltas above one MiB | one `internal`; exact cancel |
| Ready before started, duplicate ready, delta/completed before the required phase, or invalid UUID v4 token | one `internal`; exact cancel |
| Completed role/parent/conversation/model/content mismatch | one `internal`; exact cancel |
| Wrong/replayed/expired/not-ready commit pair | valid `{ accepted: false }`; no inferred persistence |
| Commit transport result is ambiguous or terminal delivery is lost after accepted acknowledgement | reconcile by loading SQLite authority; do not invent a node |
| Valid failed event | normalized shared `UiError` |
| Valid cancelled event | terminal cancellation projection, not an error toast decision |

### 5. Good / Base / Bad Cases

- **Good**: started IDs match the request, deltas concatenate to the committed
  assistant content, ready is acknowledged exactly once by the consuming UI,
  and only the later projected completed node is durable authority.
- **Base**: a redacted profile without a key decodes with
  `hasApiKey: false`; an unknown cancel returns `{ accepted: false }`.
- **Bad**: casting `Channel<GenerationEventView>`, accepting a completed node
  from another conversation, auto-acknowledging ready in the bridge, or storing
  either an API key or commit token in Zustand.

### 6. Tests Required

- Assert all six command names, wrappers, snake-case fields, `onEvent`, redacted
  profile shapes, and API-key non-echo against the shared fixture.
- Cover all valid lifecycle events plus missing fields, unknown variants,
  out-of-order/duplicate events, result/start ID mismatch, request identity
  mismatch, UUID v4 generation/token validation, cumulative overflow,
  ready ordering, and completed-node/content drift.
- Assert malformed events emit one local failure and one best-effort exact
  cancellation request; transport rejection after a known `started` also
  terminalizes locally and exact-cancels, and later channel values are ignored.
- Assert the bridge never invokes `commit_generation` automatically. UI/store
  integration must explicitly acknowledge ready, handle `{ accepted: false }`,
  and merge durable history only from `completed.node` or a fresh reload.
- Run format, ESLint, strict TypeScript, Vitest, and the production Vite build.
- Scan outside `src/lib/tauri` for raw `invoke`, provider HTTP, SQL, frontend
  credential persistence, and duplicated event decoders.

### 7. Wrong vs Correct

#### Wrong

```ts
const channel = new Channel<GenerationEventView>((event) => onEvent(event))
```

The generic type does not validate IPC data or lifecycle identity.

#### Correct

```ts
const channel = new Channel<unknown>((value) => {
  const parsed = generationEventDtoSchema.safeParse(value)
  if (!parsed.success || !matchesGenerationState(parsed.data)) failClosed(value)
  else onEvent(projectGenerationEvent(parsed.data))
})

// In the consuming UI, and only after accepting the exact transient stream:
await providerClient.commitGeneration(event.generationId, event.commitToken)
```

The bridge is the sole trust boundary and forwards only validated projections;
the consuming UI, not the bridge, owns the explicit commit decision.

## Forbidden Patterns

- `any`, `@ts-ignore`, unchecked double assertions, or broad casts from
  `unknown`.
- Trusting `invoke<ResultDto>()` without runtime decoding.
- Sharing raw SQLite rows or Rust-internal error/source shapes with React.
- Duplicating unions such as roles or error codes in component folders.
- Non-null assertions for ordinary control flow; fail early at true bootstrap
  boundaries, as `src/main.tsx` does for the required root element.
- Using message text or truthy/falsy coercion to distinguish domain states.

## Tests and Review

- Add success and malformed-payload tests for every bridge schema.
- Keep typed fixtures aligned with Rust serialization: field casing,
  nullability, timestamps, metadata, error codes, details, and retryability.
- Run ESLint's type-aware rules and `pnpm typecheck`; no warning suppression is
  an accepted substitute.
- Search for new `any`, `@ts-`, `as unknown as`, and raw `invoke` calls during
  cross-layer review.
