# Streaming Command Simplification Research

## Question

Can Canopy replace the spawned two-phase generation worker with one long-lived Tauri async command that streams progress through a Channel and resolves with the authoritative terminal result?

## Repository Evidence

- `src-tauri/src/providers/commands.rs` currently prepares a generation, spawns a worker, returns `generation_id` immediately, and later emits `ready_to_commit` plus a terminal Channel event.
- `src-tauri/src/providers/generation.rs` already buffers the complete provider response in Rust and inserts one immutable assistant only after the stream is complete.
- `ConversationPersistenceService::append_completed_assistant` already rechecks writability and parent role in the insert transaction and returns the authoritative stored node.
- `src/lib/tauri/provider-client.ts`, the conversation store, and `useWorkspaceGenerationController` reproduce the lifecycle across three frontend layers to implement acknowledgement and ambiguous-commit recovery.

## External Evidence

- Tauri 2 documents that async commands run on a separate async task and that `invoke` resolves with the command's returned value: <https://v2.tauri.app/develop/calling-rust/#async-commands>.
- The same official guide recommends `tauri::ipc::Channel` for ordered streaming and demonstrates a single async command sending multiple Channel chunks before returning: <https://v2.tauri.app/develop/calling-rust/#channels>.
- Vercel AI SDK's persistence guide saves the final chat from the server-side stream `onFinish`, rather than requiring a client commit acknowledgement: <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence>.
- Anthropic's official streaming protocol ends with `message_stop`, and its SDK accumulates the stream into one final Message object without a second commit capability: <https://platform.claude.com/docs/en/build-with-claude/streaming>.

## Decision

Use one long-lived async `generate_from_active_path` command. The Channel carries only `started` and `delta`; the invoke result carries the terminal outcome and authoritative node. Do not spawn a detached worker and do not add a replacement acknowledgement command.

The runtime still needs one minimal linearization state beyond running:

- `Running`: provider work is cancellable.
- `Finalizing`: provider completed and final SQLite insertion owns the outcome; cancellation returns false.
- `Cancelling`: cancellation won before finalization.

`begin_finalizing` and `cancel` compete under the existing registry mutex. The lease remains registered until the command returns so another generation for the same conversation cannot start during the insert.

## Delivery and Recovery Boundary

- A failed `started` or `delta` Channel send before provider completion cancels the provider and persists nothing.
- Once provider streaming returns a complete valid response and `begin_finalizing` wins, Rust persists it even if the WebView closes or the final invoke response cannot be delivered.
- On a still-live UI, an ambiguous invoke rejection triggers one immediate authoritative tree reload. An exact new assistant under the captured user parent completes the run; no match becomes a normal failure. If reload itself fails, the existing conversation error/reload path blocks mutation until authority can be read.
- On WebView destruction or application restart, normal history loading discovers the saved assistant. No generation job table is required because recovery begins only after the immutable node has been committed.

## Result/Event Ordering

Tauri does not document a cross-queue guarantee that all JavaScript Channel callbacks finish before the invoke promise resolves. The typed client therefore must allow the terminal result to arrive before delayed Channel callbacks:

- terminal result validation does not depend on having observed every delta;
- the authoritative completed node supplies the full final content;
- Channel values received after a valid terminal result are ignored;
- identity, role, conversation, parent, model, UUID and payload-shape validation remain fail-closed.

This removes the acknowledgement state machine without assuming undocumented delivery ordering.
