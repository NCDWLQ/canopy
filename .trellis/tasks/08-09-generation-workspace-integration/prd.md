# Provider Generation Workspace Integration

## Goal

Connect the completed Conversation Workspace to the completed secure provider
and generation boundary so a desktop user can configure one provider, generate
an assistant child from the selected user node, observe transient streaming,
and persist only an explicitly acknowledged complete response.

## Background

- `main` already owns one secure provider profile, OS-keyring credential
  storage, OpenAI-compatible Chat Completions SSE, per-conversation generation
  exclusion, exact cancellation, and authoritative assistant persistence.
- The frontend workspace already owns a normalized fail-closed conversation
  store, a semantic outline tree, root-to-active projection, immutable branch
  actions, root-only creation, and archive-safe read-only behavior.
- The frozen bridge exposes `load/save/deleteProviderProfile`,
  `generateFromActivePath`, `cancelGeneration`, and `commitGeneration`.
- A successful stream emits `ready_to_commit` with a memory-only one-time UUID
  token. No assistant row exists until the UI explicitly acknowledges that
  exact generation/token pair. The backend expires unacknowledged content after
  30 seconds.
- There is still no `list_conversations` command. This task must not invent
  browser persistence or synthetic history.

## Requirements

### GI-1: Provider profile control

- Provide a persistent “Provider” action in the workspace header. It opens an
  accessible focused settings dialog for loading, creating/updating, and
  deleting the single provider profile.
- Display only redacted profile state. API keys must never enter Zustand,
  local/browser storage, logs, error text, or durable component state beyond
  the save request field.
- Generation remains unavailable until a valid profile is loaded or saved.
- Missing configuration disables only generation. It never blocks creating,
  loading, navigating, or reading local conversations.
- Missing, invalid, unavailable-keyring, and provider errors use the existing
  typed safe error surface.

### GI-2: Generation capability and lifecycle

- Generation is enabled only for a selected user node in a writable
  conversation with a safe active-path projection and no active generation for
  that conversation.
- Render deltas as one transient assistant response associated with the exact
  generation and selected user parent. Never insert transient content into the
  durable tree or normalized node records.
- The UI owns a closed lifecycle covering start, streaming,
  `ready_to_commit`, committing, completed, failed, cancelled, and ambiguous
  post-ack reconciliation.
- Selecting another node, archiving, replacing the conversation, unmounting,
  or explicit cancel before acknowledgement must request exact-ID
  cancellation and discard transient content.

### GI-3: Strict durable merge

- A `ready_to_commit` event may be acknowledged only once, only when its
  generation remains current, its parent remains the selected user node, and
  the full transient content has been accepted into the current UI state.
- The workspace automatically calls `commitGeneration` immediately after that
  strict local validation; there is no extra user-facing “save response” step.
  The bridge itself still never auto-acknowledges an event without workspace
  state acceptance.
- Merge only the authoritative `completed.node` into the normalized tree.
  Validate conversation, parent, assistant role, model/content continuity,
  uniqueness, and archive/writability assumptions before merging.
- An acknowledgement rejection, timeout, failure, or cancellation adds no
  assistant node and leaves the last safe durable projection intact.
- If acknowledgement was accepted but terminal delivery is lost or ambiguous,
  reload the SQLite-backed conversation tree instead of inventing completion.

### GI-4: Desktop interaction and accessibility

- Preserve the workspace's quiet tree-native visual language and desktop-first
  layout. Provider and generation controls must not turn it into a generic
  settings dashboard.
- Streaming status, cancellation, unavailable states, focus behavior, keyboard
  access, accessible names, and reduced-motion behavior must be explicit.
- Archived conversations remain readable and expose no provider mutation or
  generation capability.

### GI-5: Integration verification

- Test the UI/store against injected `ConversationClient` and `ProviderClient`
  fakes, including strict ready/commit ordering, cancellation races, sibling
  exclusion, failure preservation, and authoritative node merge.
- Keep the shared Rust/fixture/Zod/client contract tests passing.
- Run the real local loopback SSE fixture, full Rust suite, `pnpm check`, Tauri
  debug build, and static raw-invoke/SQL/persistence/secret scans.

## Acceptance Criteria

- [ ] A user can configure or remove the single redacted provider profile from
      the workspace without exposing the API key after submission.
- [ ] A selected writable user node can generate one transient assistant
      response; a sibling sentinel never appears in request or rendered path.
- [ ] No assistant node exists before exact acknowledgement, and only the
      authoritative completed node is added after commit.
- [ ] Cancel, timeout, unmount/navigation, archive, malformed event, rejected
      acknowledgement, provider failure, or database failure leaves durable
      history unchanged and releases generation state.
- [ ] Post-ack ambiguous delivery triggers SQLite reload/reconciliation rather
      than a fabricated node.
- [ ] Generation and provider mutations are unavailable for archived
      conversations; history remains readable.
- [ ] Provider/generation UI is keyboard accessible, visibly focused, and
      respects reduced motion.
- [ ] `pnpm check`, Rust formatting/Clippy/tests, local HTTP/SSE integration,
      Tauri debug build, task validation, and static boundary scans pass.

## Out of Scope

- Multiple provider profiles, provider discovery, model listing, Responses API,
  tool calls, attachments, token accounting, retry orchestration, and editing
  assistant history.
- Conversation listing, browser-side persistence, or synthetic demo data.
- Redesigning the frozen provider/generation IPC or the conversation domain.

## Notes

- The repository-pinned `pnpm exec shadcn` CLI is operational after installing
  the locked workspace dependencies. Registry additions must use dry-run and
  per-file diff inspection; the locally customized Button must not be
  overwritten.
- Product decisions are closed: provider settings use a compact header action
  and focused dialog, and the workspace automatically acknowledges a strictly
  validated `ready_to_commit` event without a second user click.
