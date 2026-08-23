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
- the complete `CommandError` shape, including retryability and safe details;
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
listConversations(): Promise<readonly ConversationSummaryView[]>
loadConversationTree(conversationId): Promise<ConversationTreeView>
loadActivePath(conversationId, activeNodeId): Promise<ActivePathView>
archiveConversation(conversationId): Promise<ConversationView>
setConversationProvider(input): Promise<Pick<ConversationView, "id" | "providerId" | "model" | "reasoningEffort">>
searchConversations(query): Promise<readonly ConversationSearchResultView[]>
writeExportFile({ path, content }): Promise<{ bytesWritten: number }>
```

These map to the frozen snake-case commands `create_conversation`,
`append_node`, `create_branch`, `edit_node_as_branch`,
`list_conversations`, `load_conversation_tree`, `load_active_path`,
`archive_conversation`, `set_conversation_provider`, and
`search_conversations` (added 2026-08-23 with
task 08-23-search: substring search over user/assistant content and titles;
snippets are windowed SQL-side and the query is trimmed/≤200 chars on both
sides), plus `write_export_file` (added 2026-08-23 with task
08-23-conversation-export: validated bounded Markdown writes selected through
the desktop save dialog).

### 3. Contracts

- Every invoke call sends `{ request: <strict snake_case DTO> }`.
- Rust responses use explicit nulls for nullable `parent_id` and `model`;
  `src/lib/tauri` converts them to optional camelCase feature properties.
- Node DTOs contain no archive field. `ConversationView.isArchived` is the only
  archive state exposed to frontend code.
- Conversation summary arrays validate safe-integer activity timestamps and
  reject duplicate conversation IDs before entering feature state.
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

- Assert all fourteen command names, the outer `request` wrapper, and exact
  snake-case request fields through an injected transport. For discovery,
  also assert deterministic summary ordering, safe timestamps, and duplicate
  ID rejection. When a command is added or removed, update the count wording
  alongside `CONVERSATION_COMMAND_NAMES` and the shared fixture.
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
types, `contract-fixtures/provider-ipc.json`, or UI actions that consume the
provider client.

### 2. Signatures

```ts
saveProviderProfile(input: SaveProviderProfileInput): Promise<ProviderProfileView>
loadProviderProfile(): Promise<ProviderProfileView>
deleteProviderProfile(): Promise<boolean>
generateFromActivePath(
  conversationId: string,
  activeNodeId: string,
  onEvent: (event: GenerationEventView) => void,
): Promise<GenerationTerminalView>
cancelGeneration(generationId: string): Promise<CancelGenerationView>
```

The generation-path freeze is still: no extra **generation** command and no
terminal Channel event (profile CRUD plus `generate_from_active_path` and
`cancel_generation`). Later additive provider-settings commands
(`list_providers`, `save_provider`, `delete_provider`, `set_active_provider`,
`set_auto_generate_title`, `set_title_model_binding`, and related model/key
helpers) are allowed. Generation alone creates one `Channel<unknown>` and
validates values before invoking `onEvent`. Title updates use a separate
global event; see the auto-title scenario below.

### 3. Contracts

- Every invoke call sends `{ request: <strict snake_case DTO> }`; only
  `src/lib/tauri` owns raw `invoke` and Channel construction.
- Save accepts explicit `keep`, `replace`, or `remove`. A replacement value is
  present only in the one-way request and never in a response, projection,
  fixture success, store, or component prop.
- Channel values are only `started` and `delta`. `started` establishes the
  generation ID, conversation, active user, and model; every delta must match
  that ID and stay within the one-MiB cumulative UTF-8 bound.
- The command result is a separate tagged union: `completed` carries the
  authoritative assistant node, `cancelled` carries only the generation ID,
  and `failed` carries the generation ID, `stage` (`generation` or
  `persistence`), and a safe error. A result may resolve before delayed Channel
  callbacks; the bridge accepts that race and ignores late callbacks after its
  terminal state.
- A completed node must be an assistant in the requested conversation, parented
  by the requested active user, have a defined model matching `started` when
  available, and contain valid bounded content. The bridge checks identity but
  does not require callback timing or content parity when callbacks may lag.
- Any malformed payload, invalid transition, identity mismatch, or bound breach
  produces one safe local `internal` failure. If a valid generation ID is known,
  request exactly that cancellation; never cancel an untrusted or different ID.
- Invoke rejection after `started` is ambiguous. The bridge terminalizes
  locally and requests exact cancellation; the consuming controller may reload
  durable authority once. No terminal Channel event is expected.

### 4. Validation & Error Matrix

| Condition | Frontend result |
|---|---|
| Invalid endpoint/model/key/ID or lone surrogate | local `invalid_input`; no invoke |
| Malformed command success/rejection | safe non-retryable `internal` |
| Delta before started or generation mismatch | one `internal`; exact cancel |
| Any value after the bridge terminal state | ignored; never emit a second event |
| Started request-identity mismatch | one `internal`; exact cancel when known |
| Cumulative deltas above one MiB | one `internal`; exact cancel |
| Malformed terminal result or terminal ID mismatch | one `internal`; exact cancel |
| Valid `failed` with `stage: generation` | normalized generation failure |
| Valid `failed` with `stage: persistence` | normalized persistence failure |
| Valid exact `cancelled` | cancellation projection retaining available content |
| Valid exact `completed.node` | return authoritative node to the controller |

### 5. Good / Base / Bad Cases

- **Good**: started IDs match the request, deltas are bounded, and the
  authoritative completed node is returned even when its result resolves before
  the Channel callback queue drains.
- **Base**: a redacted profile without a key decodes with `hasApiKey: false`;
  an unknown cancel returns `{ accepted: false }`.
- **Bad**: casting `Channel<GenerationEventView>`, accepting a completed node
  from another conversation, treating a delta as durable history, or storing
  an API key or generation control value in Zustand.

### 6. Tests Required

- Assert the five command names, wrappers, snake-case fields, `onEvent`,
  redacted profile shapes, and API-key non-echo against the shared fixture.
- Cover valid started/delta events, result-before-callback ordering, missing
  fields, unknown variants, out-of-order/duplicate events, ID and request
  identity mismatches, UUID v4 generation validation, cumulative overflow, and
  completed-node drift.
- Assert malformed events emit one local failure and one best-effort exact
  cancellation request; invoke rejection after a known `started` also
  terminalizes locally and exact-cancels, and later Channel values are ignored.
- Assert the bridge never invokes a second persistence or generation-commit
  command automatically. Feature integration merges durable history only from
  `completed.node` or a fresh authoritative reload.
- Run format, ESLint, strict TypeScript, Vitest, and the production Vite build.

### 7. Wrong vs Correct

#### Wrong

```ts
const channel = new Channel<GenerationEventView>((event) => onEvent(event))
const result = await invoke<GenerationTerminalView>("generate_from_active_path", args)
```

The generic types do not validate IPC data, and raw transport leaks into the
feature layer.

#### Correct

```ts
const channel = new Channel<unknown>((value) => {
  const event = generationEventDtoSchema.parse(value)
  onEvent(projectGenerationEvent(event))
})

const result = await providerClient.generateFromActivePath(
  conversationId,
  activeNodeId,
  onEvent,
)
```

The bridge is the sole trust boundary and returns only validated projections;
the controller merges durable history only from the terminal result or reload.

## Scenario: Auto-Title Settings Commands And Global Title Event

### 1. Scope / Trigger

Use this contract when changing title settings IPC, `list_providers` title
fields, or the global `conversation://title-updated` listen path. Owning
files: `src/lib/tauri/provider-client.ts`, `provider-schemas.ts`,
`title-events.ts`, and `src/features/conversations/hooks/useConversationTitleUpdates.ts`.

The generation path stays Channel-only. Title updates are a separate global
Tauri event. Settings round-trip through invoke, not localStorage.

### 2. Signatures

```ts
listProviders(): Promise<{
  autoGenerateTitle: boolean
  titleModelBinding: { providerId: string; model: string } | null
  /* plus providers / activeProviderId */
}>
setAutoGenerateTitle(enabled: boolean): Promise<boolean>
setTitleModelBinding(
  binding: { providerId: string; model: string } | null,
): Promise<{ providerId: string; model: string } | null>
listenForConversationTitleUpdates(
  onUpdate: (update: { conversationId: string; title: string }) => void,
): Promise<UnlistenFn>
```

Commands: `list_providers`, `set_auto_generate_title`,
`set_title_model_binding`. Event name: `conversation://title-updated`.

### 3. Contracts

- Every invoke still sends `{ request: <strict snake_case DTO> }`.
- `list_providers` returns `auto_generate_title: boolean` and
  `title_model_binding: { provider_id, model } | null`. Frontend must not
  require extra commands to read the toggle after a successful list.
- `set_title_model_binding` wires follow-conversation as JSON `null`, not an
  omitted field or a sentinel string.
- Event payload is snake_case `{ conversation_id, title }`. Decode in
  `title-events.ts` (strict Zod; title 1..=200 Unicode scalars after Rust
  whitespace trim) then map to `{ conversationId, title }` before
  `applyTitleUpdate`.
- Decode failure: ignore the event; do not write the store.
- One listen at workspace/app mount (`useConversationTitleUpdates`); unlisten
  on unmount. Per-row listeners are forbidden. Stores never call `listen`.
- Title event does not mutate node maps or generation records.

### 4. Validation & Error Matrix

| Condition | Frontend result |
|---|---|
| Malformed `list_providers` / set result | safe non-retryable `internal`; no store write |
| `title_model_binding` JSON null | follow conversation (`null`) |
| Event payload missing/extra fields, blank title, or title >200 chars | drop event |
| Valid event for a known summary | patch that summary title; also patch loaded `title` when IDs match |
| Valid event for an unknown conversation | no-op (no invented summary row) |

### 5. Good / Base / Bad Cases

- **Good**: list hydrates toggle + binding; set round-trips; decoded event
  updates the matching summary and, if loaded, the conversation title.
- **Base**: malformed event dropped; follow-conversation is `null`.
- **Bad**: `listen` in a sidebar row; `event.payload as { conversationId }`;
  assuming camelCase on the wire.

### 6. Tests Required

- Decode fixture `conversation_id` / `title`; reject extra/missing fields
  via `.strict()`.
- Store `applyTitleUpdate` updates the matching summary and loaded
  conversation only.
- Settings tests drive `list_providers` / `set_*` fakes, not raw invoke.

### 7. Wrong vs Correct

#### Wrong

```ts
listen("conversation://title-updated", (event) => {
  applyTitleUpdate(event.payload as { conversationId: string; title: string })
})
```

#### Correct

```ts
listen(CONVERSATION_TITLE_UPDATED_EVENT, (event) => {
  const update = decodeConversationTitleUpdate(event.payload)
  if (update === null) return
  applyTitleUpdate(update)
})
```

## Forbidden Patterns

- `any`, `@ts-ignore`, unchecked double assertions, or broad casts from
  `unknown`.
- Trusting `invoke<ResultDto>()` without runtime decoding.
- Sharing raw SQLite rows or Rust-internal error/source shapes with React.
- Duplicating unions such as roles or error codes in component folders.
- Non-null assertions for ordinary control flow.
- Using message text or truthy/falsy coercion to distinguish domain states.
- Adding a second generation persistence protocol or exposing generation
  control values outside the typed bridge/controller boundary.

## Tests and Review

- Add success and malformed-payload tests for every bridge schema.
- Keep typed fixtures aligned with Rust serialization: field casing,
  nullability, timestamps, metadata, error codes, details, and retryability.
- Run ESLint's type-aware rules and `pnpm typecheck`; no warning suppression is
  an accepted substitute.
- Search for new `any`, `@ts-`, `as unknown as`, raw `invoke`, and duplicate
  generation decoders during cross-layer review.
