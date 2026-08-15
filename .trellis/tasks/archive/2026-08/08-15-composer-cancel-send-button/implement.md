# Implementation plan: Composer generation actions and contextual recovery

## Execution strategy

- Do not dispatch Codex or Trellis sub-agents for Phase 2.
- Delegate the bounded implementation to Antigravity through `agy-delegate`
  using the explicit model label `gemini-3.7-flash-high`.
- The orchestrating session writes the complete brief, reviews the actual diff,
  preserves pre-existing user changes, reruns every gate independently, sends
  delta briefs when rework is needed, updates project specs, and performs the
  final Trellis/commit workflow.
- Antigravity must not stage or commit changes.

## Ordered checklist

- [x] Preserve and re-check the pre-existing `Composer.tsx` opacity/blur diff
      before modifying the same file.
- [x] Extend `GlobalSettingsDialog` with a controlled open/on-open-change
      contract, retaining the sidebar trigger, form reset, focus, secret, and
      mutation-lock behavior; update its focused tests.
- [x] Refactor `Composer` to separate `inputDisabled` from a discriminated
      Send/Cancel action. Render the existing send icon or stop-square icon with
      Chinese accessible names and correct button types.
- [x] Update Composer keyboard/submission logic so plain Enter submits only an
      enabled Send action, is a draft-preserving no-op otherwise, Shift+Enter
      remains newline, and IME composition remains safe.
- [x] Add focused Composer tests for cancel click, empty/nonempty drafts, Enter
      and Shift+Enter, prop transitions, draft retention, failure retry, and
      accessible names.
- [x] Add a narrow contextual user-generation action contract through
      `ConversationWorkspace` -> `ConversationPane` -> `MessageNode`, rendered
      as an always-visible message footer action without changing hover-only
      Edit/Branch behavior.
- [x] Derive contextual eligibility only for the selected writable unanswered
      user leaf with no transient response. Map Provider ready to `生成回复` and
      not-ready to `配置服务提供商以生成`.
- [x] Wire configuration to the existing controlled global settings dialog and
      generation to the existing controller, with no Provider-ready auto-start.
- [x] Add `重新生成` to the cancelled transient response through the existing
      recovery callback and preserve partial content/status/draft.
- [x] Remove the workspace header Generate/Cancel slot and obsolete icon
      imports while preserving Archive and other header actions.
- [x] Update workspace and message component tests: migrate old header Generate
      expectations to contextual actions; cover Stop, cancellation count,
      non-cancellable phases, cancelled Regenerate, ready/not-ready unanswered
      leaves, settings opening, readiness transition without auto-generation,
      answered/archived/transient exclusions, and draft continuity.
- [x] Review the final diff for unrelated changes, raw IPC/store drift,
      inaccessible icon actions, duplicate recovery affordances, and loss of the
      user's opacity/blur edits.
- [x] Run focused tests for Composer, ConversationPane/MessageNode,
      ConversationWorkspace, and GlobalSettingsDialog.
- [x] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
      `pnpm build`.
- [x] Update the frontend component spec to record contextual Provider settings
      access and the Composer Send/Stop plus message-recovery placement, then
      complete the Trellis quality and finish workflow.

## Risky files and rollback points

- `src/features/conversations/components/Composer.tsx`: overlaps the user's
  uncommitted visual change; never replace or revert those class edits.
- `src/features/conversations/components/ConversationWorkspace.tsx`: central
  capability derivation; verify mutually exclusive Composer/user/transient
  actions before proceeding to tests.
- `src/features/conversations/components/ConversationPane.tsx` and
  `MessageNode.tsx`: keep transient content identity-free and durable node
  capabilities supplied by the workspace.
- `src/features/providers/components/GlobalSettingsDialog.tsx`: keep one dialog
  instance and all secret/reset semantics. Roll back controlled-open wiring as
  one unit if focus or form lifecycle regresses.

No database, IPC, Rust, or Zustand rollback is expected because those layers
must remain untouched.

## Follow-up checklist: assistant regeneration actions

- [x] Restyle failed/cancelled transient `重新生成` as an always-visible compact
      icon-only message action matching Edit/Create Branch.
- [x] Add a narrow final-assistant regeneration action contract through
      Workspace -> Pane -> MessageNode and render it in the existing action bar.
- [x] Derive eligibility only for the writable final active assistant with a
      user parent, ready Provider, valid projection, and no transient response.
- [x] On activation, select the exact parent user and invoke the existing
      generation callback once, preserving the prior assistant and draft.
- [x] Add component/workspace tests for style/accessibility, exact target,
      callback count, final-message-only placement, and ineligible-state absence.
- [x] Re-review the complete staged-plus-unstaged diff and rerun focused tests
      plus `pnpm check` before updating specs and committing.
