# Generation Commit Protocol Simplification Design

## Decision Summary

Replace the detached worker plus automatic frontend acknowledgement with one long-lived Tauri async command. Rust owns provider streaming, cancellation linearization, final SQLite persistence and the terminal result. The frontend owns only transient presentation, exact user cancellation and authoritative-node installation.

No database migration, job table, partial-message persistence or replacement acknowledgement protocol is introduced.

## Target Data Flow

```text
React controller
  -> invoke generate_from_active_path(request, Channel)
       -> Rust validates profile + active path and reserves generation
       -> Channel: started(generation_id, conversation_id, active_node_id, model)
       -> Channel: delta(generation_id, content)*
       -> provider completes with one bounded final string
       -> runtime atomically enters Finalizing
       -> SQLite transaction rechecks archive/parent and inserts assistant
       -> invoke result: completed(generation_id, authoritative_node)
  -> merge authoritative node and clear transient generation state
```

Cancellation calls remain separate so they can race the long-running generation command on Tauri's async runtime.

## Backend Protocol

### Command Surface

Keep:

```text
generate_from_active_path({ conversation_id, active_node_id }, on_event)
  -> GenerationTerminalDto
cancel_generation({ generation_id }) -> { accepted }
```

Remove `commit_generation` and all commit-token DTOs, registration, fixtures and validation.

The Channel event union becomes:

```text
started { generation_id, conversation_id, active_node_id, model }
delta   { generation_id, content }
```

The command returns one closed terminal union:

```text
completed {
  generation_id,
  node: NodeDto
}
cancelled {
  generation_id
}
failed {
  generation_id,
  stage: generation | persistence,
  error: CommandError
}
```

Preflight failures that occur before `started` remain ordinary command errors. Runtime failures return the terminal union so the frontend retains generation identity and an explicit failure stage without inferring it from event order or error text.

### Runtime Linearization

`GenerationRuntime` keeps one entry per conversation and one generation ID per entry. Its phase is reduced to:

```text
Running | Finalizing | Cancelling
```

- `cancel(generation_id)` accepts only `Running`, moves it to `Cancelling`, and triggers the cancellation token.
- after provider completion, `begin_finalizing(generation_id)` accepts only `Running` with a non-cancelled token and moves it to `Finalizing` under the same mutex;
- whichever transition wins owns the outcome;
- `Finalizing` rejects cancellation and holds the conversation slot until the SQLite insert returns;
- `GenerationLease::drop` removes only its exact entry.

There is no timeout, capability token, acknowledgement sender or commit replay state.

### Persistence and Disconnects

Before provider completion, every `started`/`delta` send remains fallible. A Channel send failure cancels the provider and returns a cancelled terminal outcome without persistence.

After provider completion, `begin_finalizing` is the point of no return. Rust calls the existing atomic `append_completed_assistant`; WebView destruction or failure to deliver the invoke result does not cancel or roll back that insert. A later history/tree load discovers the node.

Database/archive/parent failures during finalization return a persistence-stage terminal failure and leave no partial node.

## TypeScript Bridge

`generateFromActivePath` continues to create `Channel<unknown>` and validate all payloads. It returns `Promise<GenerationTerminalView>` rather than the early generation ID.

Bridge state is limited to `waiting | streaming | terminal`:

- `started` must match the requested conversation and active node;
- deltas require the exact observed generation ID and remain cumulatively bounded;
- a terminal result must be well formed and match any observed generation ID;
- completed node must be an assistant in the requested conversation under the requested user parent and use the observed model when available;
- the result may resolve before queued Channel callbacks; a valid result terminalizes the client and later Channel values are ignored;
- malformed events/results request exact cancellation when an ID is known and fail with a safe internal error.

The final node is backend authority, so result validation does not require equality with every delta that JavaScript happened to process before promise resolution.

## Frontend Store and Controller

The durable tree remains SQLite-authoritative and transient deltas remain separate. Remove `committing`, `reconciling`, acknowledgement methods, reconciliation timers and manual reconciliation retry.

The minimal store lifecycle is:

```text
idle -> starting -> streaming -> idle(completed)
                            \-> failed
                            \-> cancelled
```

`completed` does not need to remain as a stored presentation phase: after strict target/node validation, merge the authoritative assistant and return generation to `idle`.

The controller awaits the terminal result:

- completed -> strict authoritative merge;
- cancelled -> retain already displayed partial content as the existing stopped presentation;
- generation failure -> discard partial content and allow regenerate;
- persistence failure -> retain completed transient content and show the existing save-failure presentation;
- unknown/transport rejection after a run may have started -> immediately reload the captured conversation once before allowing another generation.

The one-shot reload is not a new generation phase or timer. If it finds exactly one new matching assistant under the captured user parent, install the authoritative tree and finish. If it finds no match, use the normalized failure. If authority cannot be loaded, use the existing conversation error state so mutations remain blocked until normal reload succeeds.

## Compatibility

- This is an internal IPC breaking change; Rust DTOs, TypeScript schemas, fixtures and tests change atomically in one release.
- Existing SQLite rows and migrations are unchanged.
- Provider profile/keyring, endpoint policy, SSE parsing and message request construction are unchanged.
- Existing conversation active-path, branch, edit and archive contracts are unchanged.
- User-visible semantic change: a provider-complete response persists even when its final delivery to the WebView is lost.

## Rollback

The change can be reverted at the source/protocol level because it adds no migration. Rollback must restore Rust and TypeScript protocol definitions, fixtures, controller/store behavior and specs as one atomic revision; mixed old/new IPC contracts are unsupported.
