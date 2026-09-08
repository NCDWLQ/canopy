# Provider Guidelines

> Executable contracts for Canopy's provider profile and generation boundary.

## Scenario: Secure Profile and Validated-Path Generation

### 1. Scope / Trigger

Use this contract when changing provider profile storage, native credentials,
endpoint validation, Chat Completions request/SSE handling, generation
cancellation, or completed-assistant persistence.

Ownership is split:

- `src-tauri/src/providers/` — profiles, keyring credentials, active provider,
  `list_providers` aggregate façade, `set_title_model_binding`
- `src-tauri/src/llm/` — `Protocol`, `ValidatedEndpoint`, hardened HTTP,
  protocol adapters, model discovery (no SQLite, Tauri, or conversation types)
- `src-tauri/src/generation/` — `GenerationRuntime`, prepare/run/finalize,
  `set_conversation_provider`, system-prompt injection, auto-title
- `src-tauri/src/settings/` — typed auto-title / language / theme mode /
  theme color / `default_system_prompt` keys
- `conversations::service` — validated path load and assistant persist
- migrations `0004_provider_profile.sql` through
  `0007_conversation_provider_binding_integrity.sql`

### 2. Signatures

The public command surface is frozen. Handlers live in the owning modules
above; names and `{ request }` wrappers do not move:

```text
list_providers({}) -> { providers, active_provider_id, auto_generate_title,
                        title_model_binding, language, theme,
                        theme_color, default_system_prompt }
save_provider(...) -> ProviderDto
delete_provider({ provider_id }) -> { deleted }
set_active_provider({ provider_id }) -> { provider_id }
set_title_model_binding({ binding }) -> { binding }
set_theme_color({ theme_color }) -> { theme_color }
reveal_provider_api_key({ provider_id }) -> { api_key }
list_provider_models({ source }) -> { models }
generate_from_active_path({ conversation_id, active_node_id }, on_event)
  -> GenerationTerminalDto
cancel_generation({ generation_id }) -> { accepted }
```

`list_providers` is a permanent compatibility façade: it composes provider and
settings services into one aggregate DTO. Do not split this IPC command.

The generation terminal result is a tagged union:

```text
completed { generation_id, node }
cancelled { generation_id }
failed { generation_id, stage: generation|persistence, error }
```

The request and runtime boundary is deliberately closed:

```rust
chat_prompt_from_path(&ValidatedPath, model, effort, system_prompt)
  -> Result<ChatPrompt, GenerationError>
ValidatedEndpoint::parse(&str, Protocol) -> Result<ValidatedEndpoint, LlmError>
GenerationRuntime::reserve(conversation_id, generation_id) -> GenerationLease
GenerationRuntime::cancel(generation_id) -> Result<bool, GenerationError>
GenerationLease::begin_finalizing() -> Result<bool, GenerationError>
```

Protocol dispatch is a static `match` on `Protocol` (`openai_compatible` |
`anthropic`) inside `llm` adapters and `generation` prepare. Do not introduce
trait objects while there are two variants.

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
- Generation maps a `ValidatedPath` into transport-neutral `ChatPrompt`
  messages in `generation::service`. LLM adapters accept only those prompt
  types, preserve ordered system/user/assistant content byte-for-byte, reject
  tool nodes, and require a terminal user node. Adapters never import
  conversation types.
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
let prompt = chat_prompt_from_path(&path)?;
let content = client.stream(&endpoint, &prompt, secret, token, on_delta).await?;
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
  silent endpoint switch. Saving the first provider (empty list before save)
  auto-writes `active_provider_id` in the same transaction; all other saves
  leave the current default unchanged.
- Providers persist a `models` JSON list (1..=50, order-preserving dedup; the
  default model must be a member — `validate_models`). The conversation picker
  reads this list offline and never fetches; only the settings dialog fetches
  (manual button, draft source) to let the user add entries.
- Conversations carry `(provider_id, model)` as one binding plus an
  independent `reasoning_effort` column. FK is `ON DELETE SET NULL`. Migration
  `0007` adds `provider_delete_clears_conversation_binding` so a provider row
  delete clears both binding columns together before the FK action; when the
  binding is NULL, generation follows the global active provider. `reasoning_effort`
  is never cleared by provider deletion.
- Generation snapshots everything at prepare time (provider, model, effort,
  endpoint, secret, protocol client). Config edits, binding switches, and
  even deleting the in-flight provider never affect a running generation;
  changes apply from the next message. UI must not lock settings while
  streaming.
- Protocol dispatch is a static `match` on `llm::Protocol` (openai_compatible |
  anthropic) in `llm` adapters and generation prepare — no trait objects while
  there are only two variants. Adding a protocol = new `llm` adapter module +
  enum variant + the exhaustive matches.
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

## Scenario: Auto-Title Parallel With First Reply

### 1. Scope / Trigger

Use this contract when changing title generation, `app_settings` keys
`auto_generate_title` / `title_model_binding`, `title_prompt.rs`, title
sanitization, the placeholder gate, the CAS write, or the global
`conversation://title-updated` emit. Owning files:
`src-tauri/src/generation/{title.rs,title_prompt.rs,commands.rs}`,
`src-tauri/src/settings/`, `src-tauri/src/providers/service.rs` (binding
validation on save/delete), and
`conversations::service::{load_auto_title_context, update_title_if_current}`.

This path is a generation-module side effect. It must not use
`GenerationRuntime`, occupy a generation lock, write JSONL nodes, or emit
`generation://event`.

### 2. Signatures

```text
list_providers({}) -> { providers, active_provider_id, auto_generate_title,
                        title_model_binding, language, theme }
set_auto_generate_title({ enabled }) -> { enabled }
set_title_model_binding({ binding: { provider_id, model } | null })
  -> { binding }
app.emit("conversation://title-updated", { conversation_id, title })
build_title_prompt(user) -> TitlePrompt { system, user }
update_title_if_current(conversation_id, expected, new) -> bool
```

Settings keys in `app_settings`: `auto_generate_title` (`"true"` / `"false"`;
missing key = on); `title_model_binding` (JSON `{ "provider_id", "model" }`
or absent = follow conversation).

### 3. Contracts

- Spawn in `generate_from_active_path` after `prepare_generation` succeeds
  (first user node durable) and **before** `run()` starts streaming, so the
  title HTTP overlaps the reply. Never spawn on a `Completed` terminal and
  never wait for any assistant node — the input is the first user message
  only. Reply cancel/failure does not cancel or gate the title task.
- Context: `load_auto_title_context` returns the chronologically first user
  node plus the conversation row; `None` only when no user node exists.
  Assistant count is irrelevant.
- Placeholder gate: title HTTP runs only while the stored title still equals
  `derived_placeholder_title(first_user_content)` — the Rust mirror of the
  frontend `deriveConversationTitle` (collapse Unicode whitespace via
  `split_whitespace`, cap at 40 scalars, append `…` when truncated). This is
  what makes auto-title at-most-once: a successful LLM title or a manual
  rename never matches the placeholder, so retries/duplicate spawns skip
  HTTP. The two implementations must stay in sync; change both together.
- CAS write: on success call
  `update_title_if_current(id, expected_title_read_at_spawn, new_title)`
  (`UPDATE conversations SET title = ?new WHERE id = ?id AND title = ?expected`).
  A miss (user renamed, or a concurrent title job won) logs
  `title_cas_mismatch` and does **not** emit. CAS alone is not sufficient
  without the placeholder gate: on a later `generate` call the "expected"
  value would be the already-written LLM title and the CAS would overwrite it.
- Binding resolve order: settings `title_model_binding` → conversation
  `provider_id`/`model` → active provider. A configured binding whose
  provider is gone is a **hard skip (error), not a fall-through**.
- `save_provider` / `delete_provider` that drop the bound provider or model
  must clear `title_model_binding` in the same transaction.
- Prompt lives only in `generation/title_prompt.rs` and is split by role:
  instructions go to the system role, data to the user role. OpenAI-compatible
  sends `messages: [system, user]`; Anthropic sends the top-level `system`
  field plus a single user message. The user part wraps the first user
  message in `<user_message>…</user_message>` only (no assistant block).
  Truncate to 2000 Unicode scalars, then escape `&`, `<`, `>` before
  interpolation. The system instruction demands: title text only (no quotes,
  no `Title:` / `标题：` prefix, no explanation, no Markdown, no trailing
  punctuation), at most 50 characters, same language as the user message,
  title only visible content when truncated, plain-factual style, bans
  emoji / 《》 / wrapping punctuation, carries few-shot examples, and marks
  `<user_message>` as untrusted data. Model returns plain title text, not
  JSON.
- Title request budget: `max_tokens = 256` on both protocols. OpenAI-compatible
  additionally sends `reasoning_effort: "low"` so thinking models do not burn
  the budget on reasoning; Anthropic sends an explicit
  `thinking: {"type": "disabled"}` payload — omitting the field is not "off"
  for every endpoint (DeepSeek v4 defaults to thinking and burns the whole
  `max_tokens` before any text).
- `clean_title` strips one leading prefix (`title:` ASCII case-insensitive,
  `标题:` half-width, or `标题：` full-width — colon required, strip once,
  after quote stripping) as a post-hoc guard. `clean_title` collapses
  whitespace, then strips **paired** wrapping quotes (`"` `'` `“”` `‘’`).
  Never `trim_end` a quote character. Empty or >200 chars after sanitize →
  keep the existing placeholder; do not emit.
- Success: CAS `UPDATE conversations.title`, then emit snake_case
  `{ conversation_id, title }`. The event may arrive while the first reply
  is still streaming; the frontend applies it in place.
- Failure: log only; leave the existing title; no error UI.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| `auto_generate_title` missing or `"true"` | Treat as on |
| `auto_generate_title` `"false"` | No title HTTP |
| Unknown `auto_generate_title` value | `SettingsError::CorruptValue`, mapped historically to `provider_unavailable` / `服务提供商当前不可用。` / retryable |
| No user node | No title HTTP |
| Stored title ≠ derived placeholder (LLM-titled or renamed) | No title HTTP |
| CAS miss (rename or concurrent win during in-flight title) | Log `title_cas_mismatch`; keep stored title; no emit |
| Settings binding's provider gone | Hard skip (error); **no** fall-through to conversation/active |
| HTTP / sanitize / persist / emit failure | Log; keep placeholder; no UI error |
| User text contains `</user_message>` or `<` | Escaped as data; not treated as instructions |

### 5. Good / Base / Bad Cases

- **Good**: first user message prepared, toggle on, title HTTP overlaps the
  reply stream, sanitized title CAS-persisted, event emitted (possibly
  mid-stream); HTTP failure leaves the placeholder.
- **Base**: toggle off, stored title already LLM-generated or manually
  renamed → no title HTTP; rename landing during an in-flight title → CAS
  miss, manual title kept.
- **Bad**: spawning on `Completed` (serializes title behind the reply);
  gating on assistant count; pure CAS without the placeholder gate (a retry
  after a successful title overwrites it); title call inside
  `GenerationRuntime`; interpolating raw user text into markup;
  `trim_end_matches(['"', '”'])` turning `要求输出“HACKED”` into
  `要求输出“HACKED`.

### 6. Tests Required

- Prompt: 2000-char bound on the user excerpt; `&` / `<` / `>` escaped
  (`&` before angle brackets); instructions stay in the system role and out
  of the user data block; no `<assistant>` / `<conversation>` in the
  payload; `</user_message>` in user text cannot close the wrapper; system
  instruction carries the ≤50-char, same-language, output-only directives
  and few-shot examples.
- Placeholder mirror: `derived_placeholder_title` matches the frontend
  `deriveConversationTitle` on Unicode whitespace, 40-scalar boundary, and
  emoji/scalar edge cases.
- Title requests: `max_tokens = 256`; OpenAI-compatible carries
  `reasoning_effort = "low"`; Anthropic sends explicit
  `thinking: {"type": "disabled"}`; main-chat LLM adapter
  request paths untouched.
- `clean_title`: paired wrappers stripped; inner quotes in
  `要求输出“HACKED”` preserved; one leading `Title:` / `标题：` prefix
  stripped after quote stripping (colon-less content like `标题党现象讨论`
  untouched); blank / 201-char rejected.
- Settings: missing key defaults on; binding JSON round-trip; `save_provider`
  clearing a stale binding in the same transaction.
- Orchestration: enabled + placeholder title → HTTP + CAS UPDATE + emit;
  off → no HTTP; already-titled or renamed-before-start → no HTTP; rename
  during in-flight title → CAS miss keeps manual title, no emit; two
  overlapping title jobs → first CAS write wins, loser does not emit;
  later assistant/user nodes neither enter the prompt nor block titling;
  missing configured binding provider → hard skip, no HTTP.

### 7. Wrong vs Correct

#### Wrong

```rust
generation_runtime.spawn(title_prompt); // occupies the generation lock
if assistants.len() == 1 { spawn_auto_title(...) } // gates on the reply
update_title(id, title) // unconditional write clobbers a concurrent rename
title.trim_end_matches(['"', '”']);
format!("<user>\n{user}\n</user>") // user may contain </user_message>
```

#### Correct

```rust
// after prepare_generation, before run(): reply and title HTTP overlap
spawn_auto_title(pool, provider_service, app, conversation_id);
if stored_title == derived_placeholder_title(&first_user) { /* run HTTP */ }
update_title_if_current(id, &expected_at_spawn, &title) // CAS; miss → no emit
strip_wrapping_quotes(title); // paired wrappers only
escape_markup(&truncate(user)) // then interpolate into <user_message>
```

## Scenario: System Prompt Injection At Prepare

### 1. Scope / Trigger

Use this contract when changing conversation/global system-prompt storage,
`chat_prompt_from_path`, or `prepare_generation` prompt assembly. Owning
files: `conversations::{repository,service,commands}` (override column),
`settings::{repository,service,commands}` (`default_system_prompt` key),
`generation::service` (resolve + prepend). Auto-title
(`title_prompt.rs`) does not consume the user prompt.

### 2. Signatures

```text
set_conversation_system_prompt({ conversation_id, system_prompt })
  -> { conversation_id, system_prompt }
set_default_system_prompt({ prompt }) -> { prompt }
list_providers({}).default_system_prompt -> string | null
chat_prompt_from_path(path, model, effort, system_prompt)
  -> ChatPrompt
```

Both write commands trim Unicode whitespace, treat blank as `null` (inherit /
no default), and reject UTF-8 payloads over 1 MiB.

### 3. Contracts

- Effective prompt at prepare: non-empty `conversation.system_prompt`, else
  `SettingsService::get_default_system_prompt`, else none.
- Non-empty effective prompt is prepended as the first `PromptMessage`
  with `MessageRole::System` before path nodes. Path system nodes, if any,
  stay after it. Empty / unset leaves the request body unchanged.
- The resolved prompt is part of the prepare snapshot. Later setting edits
  must not change an in-flight `PreparedGeneration`.
- OpenAI-compatible adapters send `role: "system"`; Anthropic joins system
  messages into the top-level `system` field.
- Product copy uses 对话. Panorama and Markdown export do not surface the
  prompt. There is no built-in preset.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Conversation override set | HTTP body starts with that system message |
| Override `NULL`, global set | HTTP body uses the global default |
| Both unset / blank | No extra system message vs pre-feature requests |
| Archived conversation write | `invalid_input` (`archived_conversation_write`) |
| Prompt > 1 MiB | `invalid_input` |
| In-flight settings change | Prepared prompt unchanged |

### 5. Good / Base / Bad Cases

- **Good**: override beats global; clear override inherits global; both
  protocols carry the injected system text.
- **Base**: no prompt configured → request body identical to the previous
  user-root path.
- **Bad**: persisting the prompt as a mutable system node; reading the
  setting again after `run` starts; feeding the user prompt into auto-title.

### 6. Tests Required

- `chat_prompt_from_path` prepends without rewriting path nodes.
- `prepare_generation` resolve order plus snapshot isolation.
- `provider_http` / `anthropic_http` assert the real request body.
- Persistence: round-trip, clear-to-null, archived reject, fixture upgrade.

### 7. Wrong vs Correct

#### Wrong

```rust
// mutate an immutable system root, or re-read settings during run()
persistence.update_node_content(system_root_id, prompt)?;
let prompt = settings.get_default_system_prompt().await?; // after prepare
```

#### Correct

```rust
let effective = conversation.system_prompt
    .filter(|value| !value.is_empty())
    .or(settings.get_default_system_prompt().await?);
chat_prompt_from_path(&path, &model, effort, effective.as_deref())?;
```
