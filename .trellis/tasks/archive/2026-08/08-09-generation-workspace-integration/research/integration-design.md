# Generation Workspace Integration Research

## Existing boundaries

- The conversation feature already owns the normalized tree, safe active-path
  projection, immutable user mutations, archive state, and authoritative tree
  loading. Transient generation must not enter `nodesById` or `fullNodes`.
- The provider bridge already owns all raw Tauri transport and validates the
  six provider commands plus the closed Channel event order. It verifies that
  a completed node matches the started model, selected parent, conversation,
  and accumulated stream content.
- The backend holds the per-conversation lease through streaming,
  acknowledgement, and persistence. `ready_to_commit` is not durable; its
  UUIDv4 token expires after 30 seconds and is consumed exactly once.
- There is no generation-status query and no conversation-list command.

## Recommended state ownership

Keep two stores rather than mixing secrets or unrelated profile state into the
conversation tree:

1. A provider-profile store holds only the redacted profile projection,
   load/save/delete status, and safe public error. The API-key input remains
   local to the dialog and is cleared on close and after every save attempt.
2. The conversation store owns a closed transient generation projection
   because accepting `completed.node` must be atomic with tree validation.
   The projection carries a UI run epoch, conversation ID, parent ID,
   generation ID once known, model, accumulated content, phase, and safe error.
   It never carries a commit token.

A workspace controller hook receives injected `ConversationClient` and
`ProviderClient` instances. It coordinates selection, archive, replacement,
unmount, generation start, exact cancellation, automatic acknowledgement, and
ambiguous reconciliation. Components consume narrow selectors and do not call
the bridge directly.

## Automatic acknowledgement

On `ready_to_commit`, the callback must synchronously verify that its UI run is
still current, the generation and conversation identities match, the selected
parent is still the same writable user node, the safe active path is still
valid, and every prior delta is present in the transient projection. It then
changes the public phase to `committing` and passes the event token directly to
`commitGeneration`. The token is not stored, logged, rendered, or retained by
the store.

`accepted: false` is terminal locally and cannot merge a node. A transport
error is ambiguous because the backend may have consumed the acknowledgement.
The Channel remains authoritative if a terminal event still arrives; otherwise
the controller reloads the conversation tree from SQLite. Reloaded durable data
may replace the normalized tree, but the UI must not synthesize a completion or
guess between multiple matching children.

## Cancellation and races

Before acknowledgement, navigation or teardown first increments the UI run
epoch and discards transient content, then requests cancellation for the exact
known generation ID. A late callback sees a stale epoch and cannot commit.
If `started` has not arrived, the invocation is allowed to finish only long
enough to discover the generation ID and issue exact cancellation.

After acknowledgement, backend `Committing` cannot be cancelled. During this
short phase, tree-changing and archive actions should be disabled until a
terminal event or reconciliation result prevents the UI from moving the
generation to a different path. Provider-profile mutations are also disabled
while a generation is active; redacted settings may remain viewable.

## Provider dialog

- A compact Provider action lives at the top-right of the workspace header.
- Dialog fields: base endpoint, model, optional API key, and explicit key
  removal. Existing profiles with a blank key field send `keep`; nonblank input
  sends `replace`; explicit removal sends `remove`. A new profile with no key
  sends `remove`, which supports permitted keyless loopback providers.
- Deletion uses AlertDialog. Missing profile (`not_found`) is an expected
  unconfigured state, not a global workspace error.
- The profile summary shows only endpoint, model, and whether a credential is
  present. Archived conversations make the settings dialog read-only, while an
  empty workspace still allows configuration.

## shadcn and visual integration

The project is Vite + Tailwind 4 + Radix Nova with Lucide icons and a locally
customized Button. The repository-pinned shadcn CLI is available. Dry-run shows
that a bulk add would overwrite Button, so additions must be diffed and added
individually or with the existing Button preserved.

Use official Dialog, Field, Input, Alert, Badge, Spinner, and AlertDialog
primitives. Use MessageScroller/Message/Bubble registry primitives for the
conversation surface only after inspecting generated dependencies and
replacing any registry icon placeholder with Lucide. Keep the existing quiet,
tree-native layout; do not add a settings dashboard, decorative gradients, or
synthetic content.

## Verification focus

- provider profile missing/load/save/delete and key keep/replace/remove;
- key value absent from store snapshots, DOM after save, errors, fixtures, and
  logs;
- exact start/delta/ready/automatic-commit/completed ordering;
- sibling sentinel absent from request path and rendered branch;
- no durable node before acknowledgement and authoritative-only merge;
- stale run, navigation, archive, unmount, timeout, malformed event, rejected
  commit, and provider/database failures;
- post-ack lost terminal reloads SQLite and never fabricates a node;
- keyboard/focus/reduced-motion behavior and archived capability matrix;
- full TypeScript, Rust, loopback SSE, Tauri build, and static boundary gates.
