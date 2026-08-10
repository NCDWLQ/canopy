# Provider Generation Workspace Integration — Technical Design

## 1. Scope and boundaries

This task joins two already-frozen features: the Conversation Workspace and the
secure provider/generation boundary. It adds provider settings, generation
lifecycle state, streaming presentation, exact automatic acknowledgement, and
authoritative completion reconciliation. It does not redesign the Rust
protocol, add a provider API, or add browser persistence.

Boundary ownership stays explicit:

- `src/lib/tauri` remains the only raw Tauri owner and wire decoder.
- `features/providers` owns redacted provider configuration state and UI.
- `features/conversations` owns the normalized durable tree, safe active path,
  transient generation projection, and authoritative assistant merge.
- SQLite remains the only durable conversation/profile source. Zustand is a
  non-persistent projection.
- API keys exist only in the provider dialog's local input long enough to form
  a save request. Commit tokens exist only in the ready-event callback long
  enough to call `commitGeneration`.

No backend, fixture, or frozen bridge change is expected. If integration finds
a missing shared contract, implementation stops at that boundary and records a
backend dependency rather than widening IPC locally.

## 2. Data flow

```text
workspace mount
  -> ProviderProfileStore.load(ProviderClient)
  -> redacted profile | unconfigured | safe error

selected writable user + safe path + configured profile
  -> WorkspaceController.generate()
  -> ProviderClient.generateFromActivePath(conversationId, userId, callback)
  -> started -> delta* -> ready_to_commit
       -> strict current-run/path/content validation
       -> ProviderClient.commitGeneration(generationId, local callback token)
       -> completed(authoritative assistant node)
       -> validate + merge node into normalized tree + select node

pre-ack navigation/archive/unmount/cancel
  -> synchronously invalidate UI run and discard transient projection
  -> ProviderClient.cancelGeneration(exact generationId when known)

post-ack transport ambiguity
  -> keep accepting an exact Channel terminal if it arrives
  -> otherwise ConversationClient.loadConversationTree(conversationId)
  -> replace with authoritative SQLite projection; never fabricate a node
```

Provider configuration is independent of the current conversation. Missing or
failed provider configuration disables generation only; it never blocks local
conversation actions.

## 3. State ownership and contracts

### 3.1 Provider profile store

Add a small non-persisted Zustand store under `features/providers/store`:

```ts
type ProviderProfileState =
  | { phase: "idle" | "loading"; profile: ProviderProfileView | null }
  | { phase: "ready"; profile: ProviderProfileView }
  | { phase: "unconfigured"; profile: null }
  | { phase: "error"; profile: ProviderProfileView | null; error: UiError }
```

Actions receive an injected `ProviderClient`. Missing-profile `not_found` maps
to `unconfigured`; all other failures expose only normalized public errors.
Save and delete merge only authoritative bridge results. A failed load or
mutation keeps the last redacted profile for display but makes generation fail
closed until a fresh ready result.

The store never accepts an API-key string. The settings form computes the
`ApiKeyInputAction` and passes the complete request directly to its save action;
the action does not retain the request.

### 3.2 Conversation generation projection

Extend the conversation store with a closed, non-durable generation union. It
contains a monotonically changing UI run ID plus the exact conversation and
parent identities. Public phases are `idle`, `starting`, `streaming`,
`committing`, `completed`, `failed`, `cancelled`, and `reconciling`.

Starting/streaming/committing carry only the data required to render and reject
stale events: generation ID when known, selected user parent, model when known,
and accumulated assistant content. Completed stores only the authoritative node
identity/status; failed stores a safe `UiError`; cancelled stores no content.
No phase contains the acknowledgement token.

Add narrow store operations to:

- begin and invalidate a UI run;
- accept exact started/delta/terminal events;
- mark committing only after current-run validation;
- merge an authoritative assistant node with stricter checks than ordinary user
  append: same conversation and user parent, assistant role, exact model and
  content, unique ID, writable conversation, and structurally valid tree;
- replace the whole tree after reconciliation while preserving a still-valid
  selection or selecting the one unambiguous new authoritative child.

The existing durable `nodesById`/`fullNodes` records change only on completed
merge or authoritative tree reload.

### 3.3 Workspace controller

A dedicated hook receives the injected conversation/provider clients and
exposes UI-safe commands. It is the sole coordinator for generate, cancel,
selection, create/load replacement, archive, and unmount cleanup. It
synchronously invalidates the current run before allowing any pre-ack path
change, preventing a ready callback from acknowledging stale content.

If cancellation is requested before `started`, the controller records the
cancel intent and sends it immediately when the exact generation ID becomes
known. During committing/reconciliation, path-changing mutations are disabled
because the backend can no longer undo an accepted commit.

## 4. Generation state machine

| UI phase | Accepted input | Next state / effect |
|---|---|---|
| idle/terminal | Generate with valid capability | starting; invoke exact path |
| starting | exact started | streaming with generation/model |
| starting/streaming | cancel or pre-ack navigation | invalidate, discard, exact cancel when ID known |
| streaming | exact delta | append transient content only |
| streaming | exact ready | validate current run/path/content; committing; auto-call commit |
| committing | commit accepted + exact completed | validate and merge authoritative node; completed |
| committing | commit rejected | failed; no merge |
| committing | commit transport error/lost terminal | reconciling; reload SQLite authority |
| non-terminal | exact failed/cancelled | failed/cancelled; no durable change |
| any | stale/malformed event | ignore stale run or fail closed; never acknowledge/merge |

The existing provider client remains responsible for wire-level order, UUID,
size, model/content, role, conversation, and parent validation. The workspace
adds product-state validation; neither layer substitutes for the other.

## 5. Capability matrix

Generation requires all of the following:

- provider profile phase is `ready`;
- conversation status is `ready`, not archived;
- active-path projection is `ready`;
- selected node is `user`;
- no generation is active or reconciling.

While starting/streaming, Generate becomes Cancel. Local navigation/archive
first cancels and invalidates. While committing/reconciling, tree-changing,
archive, composer, and provider-profile mutations are disabled until the
result is authoritative. Archived conversations remain readable; Provider may
open in read-only mode, while Generate and all provider mutations are disabled.
An empty workspace may still configure Provider.

## 6. Provider settings UI and secret handling

Add a compact Provider header action opening an accessible Dialog. It loads the
current redacted profile and uses Field, Input, Alert, Badge, Spinner, and
Button primitives. Delete confirmation uses AlertDialog.

Form submission maps API-key intent exactly:

| Profile state | Key field / control | Request action |
|---|---|---|
| existing | blank, remove unchecked | `keep` |
| existing/new | nonblank key | `replace` |
| existing | explicit remove | `remove` |
| new | blank | `remove` (valid for keyless loopback) |

The key input uses password semantics and autocomplete appropriate for a new
secret. It is cleared on dialog close and in a `finally` block after save. It
is never echoed in status, error text, test snapshots, or logs. Endpoint/model
fields may be initialized from the redacted profile.

## 7. Conversation presentation

Preserve the current desktop outline + branch view. The path still renders
only root-to-active durable messages. A single transient assistant bubble is
appended visually after the selected user while streaming/committing, labeled
as not yet saved and accompanied by an accessible live status. It is not given
a node ID and is not shown in the outline.

Use repository-pinned shadcn additions with dry-run/per-file diff inspection.
Preserve the customized Button. Introduce official Dialog/form/status
primitives and, after dependency/source review, MessageScroller/Message/Bubble
for the message surface. Replace registry placeholder icons with Lucide and
use semantic tokens, visible focus, keyboard access, and reduced-motion-safe
scrolling/animation.

## 8. Failure and reconciliation behavior

- Preflight, provider, malformed stream, timeout, rejected acknowledgement,
  cancellation, and database failure keep the last safe durable tree.
- A pre-ack failure immediately discards transient content after showing a safe
  recoverable status; retry starts a new UI run.
- A commit invocation transport error is not treated as rejection. The
  controller remains receptive to the exact terminal Channel event, then runs
  a bounded authoritative reload if completion cannot be observed.
- Reconciliation replaces the tree from SQLite. It selects a new child only if
  there is exactly one previously unseen assistant child matching the exact
  parent/model/content; otherwise it keeps a valid prior selection and reports
  that the durable tree was reloaded. It never guesses or fabricates.
- If reload itself fails, the prior safe tree stays visible with an explicit
  retry-reconciliation action.

## 9. Testing strategy

Store tests inject fake clients and exercise profile load/save/delete,
key-action mapping at the form boundary, exact generation transitions,
automatic commit, cancellation intent before/after started, stale callbacks,
authoritative merge, archive guards, and ambiguous reload. Tests assert the
commit token and API key are absent from Zustand snapshots.

Component tests cover the provider Dialog, read-only archive state, capability
labels, Generate/Cancel behavior, transient assistant rendering, keyboard and
focus behavior, live status, and reduced motion. A two-sibling fixture proves
the sibling sentinel never reaches the active request or rendered path.

The existing bridge fixture tests, Rust contract/runtime tests, deterministic
loopback SSE tests, full frontend check, Tauri debug build, task validation,
and raw-invoke/SQL/browser-persistence/secret scans remain required.

## 10. Compatibility, rollout, and rollback

This is additive frontend integration over frozen APIs. No migration or IPC
compatibility rollout is needed. Keep integration commits separable: shadcn
primitives, profile UI/store, generation controller/store, then specs/task
records. If a UI layer regresses, roll back that layer without changing backend
security semantics. Never resolve integration pressure by persisting secrets or
tokens, optimistic assistant insertion, auto-acknowledging in the bridge, or
weakening fail-closed tree validation.
