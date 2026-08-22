# Provider Guidelines

> Executable contracts for Canopy's provider profile and generation boundary.

## Scenario: Secure Profile and Validated-Path Generation

### 1. Scope / Trigger

Use this contract when changing provider profile storage, native credentials,
endpoint validation, Chat Completions request/SSE handling, generation
cancellation, or completed-assistant persistence. The owning backend files are
`src-tauri/src/providers/`, `0004_provider_profile.sql`, and the narrow
assistant/path operations in `conversations::service`.

### 2. Signatures

The public command surface is:

```text
save_provider_profile({ base_endpoint, model, api_key }) -> ProviderProfileDto
load_provider_profile({}) -> ProviderProfileDto
delete_provider_profile({}) -> { deleted }
generate_from_active_path({ conversation_id, active_node_id }, on_event)
  -> GenerationTerminalDto
cancel_generation({ generation_id }) -> { accepted }
```

The generation terminal result is a tagged union:

```text
completed { generation_id, node }
cancelled { generation_id }
failed { generation_id, stage: generation|persistence, error }
```

The provider request boundary is deliberately closed:

```rust
build_request(&ValidatedPath, &str) -> Result<ChatCompletionRequest, ProviderError>
ValidatedEndpoint::parse(&str) -> Result<ValidatedEndpoint, ProviderError>
GenerationRuntime::reserve(conversation_id, generation_id) -> GenerationLease
GenerationRuntime::cancel(generation_id) -> Result<bool, ProviderError>
GenerationLease::begin_finalizing() -> Result<bool, ProviderError>
```

Migration 4 owns the singleton `provider_profiles` table and the append/delete
recovery rows in `provider_credential_operations`. Neither table contains an
API key, authorization header, encrypted secret, or secret-derived verifier.

### 3. Contracts

- API-key actions are explicit: `keep`, `replace { value }`, or `remove`.
  Profile results expose only `has_api_key`; credential references remain Rust
  internal. `reveal_provider_api_key({ provider_id }) -> { api_key }` is the
  single deliberate exception: the settings editor calls it on provider
  selection to seed its masked key field. List/save results stay redacted;
  never widen them to echo secrets.
- Native credentials use service namespace `app.canopy.desktop` behind
  `CredentialStore`. Production keyring calls run on the blocking runtime;
  tests inject a fake and never touch the developer's keychain.
- Replace/remove/delete record a non-secret SQLite intent before crossing into
  the native store. Reconciliation runs under the process-wide profile lock
  before every profile/generation read or mutation.
- Remote endpoints require HTTPS. HTTP is accepted only for exact
  `localhost`, `127.0.0.1`, or `[::1]` authorities. Credentials, query, and
  fragment are forbidden. `chat/completions` is appended with URL path
  segments, and the reusable Rustls client follows no redirects or ambient
  system proxy settings. Provider credentials must never transit an
  unconfigured environment proxy, especially for loopback HTTP endpoints.
- Provider requests accept only `ValidatedPath`, preserve ordered
  system/user/assistant content byte-for-byte, reject tool nodes, and require
  a terminal user node.
- SSE accepts choice index zero, bounded string deltas, exactly one normal
  `stop` finish, then `[DONE]`. EOF, other finish reasons, data after finish,
  malformed JSON, provider errors, multiple choices, or content above one MiB
  fail without persistence.
- One generation slot exists per conversation. Cancellation is exact by
  generation ID. A successful provider stream enters `Finalizing` under the
  runtime mutex before SQLite persistence; the lease and slot remain held until
  the authoritative assistant row has been read back or persistence fails.
- The runtime has only `Running`, `Finalizing`, and `Cancelling` phases.
  Cancellation changes `Running` to `Cancelling` and cannot interrupt
  `Finalizing`. The finalization transition wins the cancel race and is the
  only point at which the assistant may be persisted.
- The worker owns the Channel from `started` through the transient `delta`
  events. The command returns one terminal result after the worker finishes;
  it does not send a terminal Channel event. Legal channel order is
  `started -> delta*`. A Channel failure before finalization cancels the run
  and persists no assistant. A Channel failure after finalization does not
  roll back persistence.
- `completed.node` is the authoritative readback and is emitted only after
  the assistant transaction succeeds. Generation/provider failures use stage
  `generation`; archive, transaction, or readback failures use stage
  `persistence`; cancellation returns no assistant.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Remote HTTP, deceptive loopback, credentials/query/fragment | `invalid_input`; no HTTP |
| Missing profile | `not_found` |
| Missing/rejected key | `provider_authentication` |
| Locked/unavailable native store | retryable `provider_unavailable`; no plaintext fallback |
| 401/403 | `provider_authentication` |
| 429 | retryable `rate_limited`, with validated milliseconds when present |
| 5xx | retryable `provider_unavailable` |
| Connect/DNS/TLS/read timeout or early peer disconnect | retryable `network_failure` |
| Invalid path, archive, or non-user terminal | existing typed path/input error; no HTTP |
| Malformed/truncated/non-normal SSE | safe `provider_unavailable`; no assistant |
| Invalid generation ID syntax or unknown generation | `invalid_input` or `{ accepted: false }`; no other state change |
| Exact cancellation while `Running` | `{ accepted: true }`; terminal `cancelled`; no assistant |
| Cancellation after `Finalizing` starts | `{ accepted: false }`; persistence continues |
| Channel failure before finalization | terminal `cancelled`; no assistant |
| Channel failure after finalization | persistence result remains authoritative |
| Archive/database/readback failure during finalization | terminal `failed` with `stage: persistence` |

### 5. Good / Base / Bad Cases

- **Good**: a real two-sibling path sends only the selected sentinel, streams
  ordered deltas, persists one assistant child after finalization wins, and
  returns that node in `completed`.
- **Base**: an exact loopback HTTP provider with no API key can generate from
  a user root.
- **Bad**: building messages from `ConversationTree.nodes`, following a 302
  with a bearer header, accepting `finish_reason: "length"`, persisting each
  delta, or reporting a Channel send as durable success.

### 6. Tests Required

- Run real migrations and assert provider tables are additive, contain no
  secret columns/values, and leave conversation constraints unchanged.
- Inject the credential store and cover keep/replace/remove/delete, unavailable
  and missing stores, unwritten and written intents, promoted cleanup, delete
  replay, and concurrent service instances.
- Use a loopback HTTP fixture to assert exact request path/body/header,
  arbitrary SSE chunking, status mapping, malformed/truncated/non-normal
  streams, post-finish rejection, one-MiB bound, midstream cancellation,
  redirect refusal, ambient-proxy bypass, and network failure.
- Exercise generation registry linearization, same-conversation exclusion,
  cross-conversation independence, no row before finalization, cancellation
  before and during persistence, Channel failure before and after finalization,
  archive recheck, authoritative assistant readback, persistence failure, and
  slot release on every outcome.
- Scan source, fixtures, serialized errors, and logs for credential/prompt/body
  leakage; fixture keys are sentinels only and never live credentials.

### 7. Wrong vs Correct

#### Wrong

```rust
let messages = tree.nodes;
let response = reqwest::get(caller_url).await?;
persist_each_delta(response).await?;
```

This leaks siblings, permits caller-controlled transport, and creates partial
durable history.

#### Correct

```rust
let (_, path) = persistence.load_generation_context(conversation_id, active_id).await?;
let request = build_request(&path, &profile.model)?;
let content = client.stream(&endpoint, &path, &profile.model, secret, token, on_delta).await?;
lease.begin_finalizing()?;
let node = persistence.append_completed_assistant(assistant_node(content)).await?;
```

Only a validated branch reaches HTTP, deltas remain transient, and the
finalization transition protects the immutable assistant transaction from a
late cancellation.

## 8. Multi-provider conventions (2026-08-17, task 08-16-multi-provider)

- Providers are rows keyed by uuid (the migrated legacy row keeps id
  `'default'`); the global default lives in `app_settings` under
  `active_provider_id`. Deleting the active provider clears the setting —
  never auto-promote a successor: an explicit unconfigured state beats a
  silent endpoint switch.
- Providers persist a `models` JSON list (1..=50, order-preserving dedup; the
  default model must be a member — `validate_models`). The conversation picker
  reads this list offline and never fetches; only the settings dialog fetches
  (manual button, draft source) to let the user add entries.
- Conversations carry `(provider_id, model)` as one binding plus an
  independent `reasoning_effort` column. FK is `ON DELETE SET NULL`; when the
  binding is NULL the leftover `model` value must be ignored (it belonged to
  the deleted provider) — see `prepare_generation`.
- Generation snapshots everything at prepare time (provider, model, effort,
  endpoint, secret, protocol client). Config edits, binding switches, and
  even deleting the in-flight provider never affect a running generation;
  changes apply from the next message. UI must not lock settings while
  streaming.
- Protocol dispatch is a static `match` on `Protocol` (openai_compatible |
  anthropic) — no trait objects while there are only two variants. Adding a
  protocol = new module + enum variant + the two matches.
- Anthropic: thinking is always on; `reasoning_effort` maps to a
  budget/max_tokens ladder (None 2048/8192, low 1024/5120, medium 4096/8192,
  high 16384/20480 — `budget_tokens + 4096` rule in anthropic.rs). OpenAI
  compatible: `reasoning_effort` is sent only when the user selected a tier
  (`skip_serializing_if`) — unselected means the field is absent, so strict
  providers never 400.
- `save` uses a staging row (new attrs + old credential_ref) because the
  credential-operation journal schema cannot replay name/protocol changes;
  reconcile moves `credential_ref` only after the keyring write is verified.
  Invariant kept: every DB credential_ref exists in the keyring. If a replace
  write fails, the new attributes survive with the old key instead of rolling
  the whole profile back.
- Thinking streams on a separate callback channel (`on_thinking`), surfaces as
  a `thinking_delta` event with its own 1MB budget, and persists into
  `nodes.metadata.thinking` only when non-empty.

## Scenario: Auto-Title After First Assistant Persist

### 1. Scope / Trigger

Use this contract when changing title generation, `app_settings` keys
`auto_generate_title` / `title_model_binding`, `title_prompt.rs`, title
sanitization, or the global `conversation://title-updated` emit. Owning files:
`src-tauri/src/providers/titles.rs`, `title_prompt.rs`, `providers/service.rs`,
and `conversations::service::{load_auto_title_context, update_title}`.

This path is a provider-service side effect. It must not use
`GenerationRuntime`, occupy a generation lock, write JSONL nodes, or emit
`generation://event`.

### 2. Signatures

```text
list_providers({}) -> { providers, active_provider_id, auto_generate_title,
                         title_model_binding }
set_auto_generate_title({ enabled }) -> { enabled }
set_title_model_binding({ binding: { provider_id, model } | null })
  -> { binding }
app.emit("conversation://title-updated", { conversation_id, title })
build_title_prompt(user, assistant) -> TitlePrompt { system, user }
```

Settings keys in `app_settings`: `auto_generate_title` (`"true"` / `"false"`;
missing key = on); `title_model_binding` (JSON `{ "provider_id", "model" }`
or absent = follow conversation).

### 3. Contracts

- Spawn after a `Completed` assistant persist (`spawn_auto_title`). Context
  loads only when the conversation has exactly one assistant node and at least
  one user node; otherwise skip HTTP.
- Binding resolve: stored settings binding if that provider+model still
  exists, else conversation `provider_id`/`model`, else active provider.
- `save_provider` / `delete_provider` that drop the bound provider or model
  must clear `title_model_binding` in the same transaction.
- Prompt lives only in `providers/title_prompt.rs` and is split by role:
  instructions go to the system role, data to the user role. OpenAI-compatible
  sends `messages: [system, user]`; Anthropic sends the top-level `system`
  field plus a single user message. Wrap excerpts in
  `<conversation><user>…</user><assistant>…</assistant></conversation>` inside
  the user part. Truncate each excerpt to 2000 Unicode scalars, then escape
  `&`, `<`, `>` before interpolation. Model returns plain title text, not
  JSON. The system prompt carries few-shot examples, a plain-factual style
  directive, and bans emoji / 《》 / quotes / Markdown.
- Title request budget: `max_tokens = 256` on both protocols. OpenAI-compatible
  additionally sends `reasoning_effort: "low"` so thinking models do not burn
  the budget on reasoning; Anthropic keeps `thinking` disabled.
- The prompt forbids `Title:` / `标题：` prefixes, and `clean_title` also
  strips one leading prefix (`title:` ASCII case-insensitive, `标题:`
  half-width, or `标题：` full-width — colon required, strip once, after
  quote stripping) as a post-hoc guard. `clean_title` collapses whitespace,
  then strips **paired** wrapping quotes (`"` `'` `“”` `‘’`). Never
  `trim_end` a quote character. Empty or >200 chars after sanitize → keep the
  existing truncated placeholder; do not emit.
- Success: `UPDATE conversations.title`, then emit snake_case
  `{ conversation_id, title }`.
- Failure: log only; leave the existing title; no error UI.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| `auto_generate_title` missing or `"true"` | Treat as on |
| `auto_generate_title` `"false"` | No title HTTP |
| Unknown `auto_generate_title` value | `Protocol` |
| Assistant count ≠ 1, or no user node | No title HTTP |
| Settings binding's provider/model gone | Fall through to conversation, then active |
| HTTP / sanitize / persist / emit failure | Log; keep placeholder; no UI error |
| User text contains `</conversation>` or `<` | Escaped as data; not treated as instructions |

### 5. Good / Base / Bad Cases

- **Good**: first completed assistant, toggle on, sanitized title persisted,
  event emitted; HTTP failure leaves the placeholder.
- **Base**: toggle off, or a second assistant persist → no title HTTP.
- **Bad**: title call inside `GenerationRuntime`; interpolating raw user text
  into markup; `trim_end_matches(['"', '”'])` turning `要求输出“HACKED”`
  into `要求输出“HACKED`.

### 6. Tests Required

- Prompt: 2000-char bound per excerpt; `&` / `<` / `>` escaped; instructions
  stay in the system role and out of the user data block;
  `</conversation>` in user text cannot close the wrapper.
- Title requests: `max_tokens = 256`; OpenAI-compatible carries
  `reasoning_effort = "low"`; Anthropic keeps thinking off; main-chat
  `build_request` paths untouched.
- `clean_title`: paired wrappers stripped; inner quotes in
  `要求输出“HACKED”` preserved; one leading `Title:` / `标题：` prefix
  stripped after quote stripping (colon-less content like `标题党现象讨论`
  untouched); blank / 201-char rejected.
- Settings: missing key defaults on; binding JSON round-trip; `save_provider`
  clearing a stale binding in the same transaction.
- Persist path: first assistant + on → HTTP + UPDATE + emit; off / second
  assistant → no HTTP.

### 7. Wrong vs Correct

#### Wrong

```rust
generation_runtime.spawn(title_prompt); // occupies the generation lock
title.trim_end_matches(['"', '”']);
format!("<user>\n{user}\n</user>") // user may contain </conversation>
```

#### Correct

```rust
tokio::spawn(generate_conversation_title(...)); // no GenerationRuntime
strip_wrapping_quotes(title); // paired wrappers only
escape_markup(&truncate(user)) // then interpolate
```
