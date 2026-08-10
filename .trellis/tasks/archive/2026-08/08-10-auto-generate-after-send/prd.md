# Auto-generate after sending a message

## Goal

Make Canopy behave like a conventional chat interface: after a user message is
successfully persisted, start the assistant response without requiring a second
click on the header Generate button.

## Background

- The composer currently submits only `controller.appendNode(content)`
  (`src/features/conversations/components/ConversationWorkspace.tsx:294`).
- A successful append selects the new authoritative user node
  (`src/features/conversations/store/index.ts:236`).
- Provider generation starts only through the separate `controller.generate()`
  action (`src/features/conversations/hooks/useWorkspaceGenerationController.ts:215`).
- Generation must remain capability-gated: a ready provider, writable
  conversation, safe active path, selected user node, and no active generation
  are still required.
- New-conversation creation persists a title and first user message through a
  separate `controller.createConversation(title, content)` path.

## Requirements

### R1: Automatic generation after a composer send

- After an appended user message is authoritatively saved and selected, start
  generation from that exact user node when generation capability is available.
- Do not start generation before persistence succeeds.
- Do not generate if append fails, the returned tree update fails validation, or
  generation capability is unavailable.
- Preserve the existing exact-path, transient streaming, cancellation, commit,
  reconciliation, and authoritative assistant merge behavior.

### R2: Automatic generation after creating a conversation

- After a new conversation and its first user message are authoritatively
  created and loaded, start generation from that first user node when generation
  capability is available.
- Apply the same persistence-first and capability-gated behavior as a composer
  send: creation failure or invalid returned tree data must never start
  generation.

### R3: Manual generation remains available

- Keep the Generate control as the retry/manual generation entry point for a
  selected eligible user message.
- Prevent duplicate generation when automatic generation has already started.

### R4: User feedback and failure behavior

- Clear the composer only according to its existing submission behavior.
- A provider that is missing or not ready must not prevent the user message from
  being persisted; generation remains unavailable as today.
- Generation-start failure must preserve the saved user message and use the
  existing generation error state.

## Acceptance Criteria

- [x] Sending from the composer persists one user node and automatically calls
      generation exactly once with the conversation ID and the new user-node ID.
- [x] Creating a conversation persists its first user node and automatically
      calls generation exactly once from that node.
- [x] Each automatic call occurs only after its corresponding create or append
      operation resolves successfully and the authoritative user node is active.
- [x] Conversation creation or append failure, invalid authoritative data,
      missing provider configuration, archived/read-only state, or unsafe path
      produces no generation call.
- [x] An active automatic run cannot be duplicated through the Generate control.
- [x] Failed generation leaves the saved user message selected and permits the
      existing manual retry behavior.
- [x] Existing generation lifecycle, cancellation, strict commit, reconciliation,
      branch isolation, and archive tests continue to pass.

## Out of Scope

- Changing provider IPC, persistence schemas, or the generation/commit protocol.
- Automatically regenerating after node selection, branch creation, or editing an
  existing historical message.
- Removing the Generate control.
