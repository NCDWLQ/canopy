# Implementation Plan

## 1. Conversation store mode and identity guards

- Add creation-mode state and an intent action that preserves the loaded tree
  while invalidating older requests.
- Exit creation mode on history selection/load and successful conversation
  creation; retain it on creation failure.
- Refactor authoritative-node merge so selection can be preserved.
- Guard append/branch/edit completion and failure with the captured epoch,
  conversation, target, and active-selection identities while merging against
  the live tree.
- Add store tests for preserved tree state, mode transitions, all three deferred
  mutation navigation races, and stale epoch result/error rejection.

## 2. Workspace entry and blank Composer rendering

- Add the History-top “New conversation” button using existing shadcn Button
  and Lucide conventions with an explicit accessible name.
- Replace the separate `NewConversationForm` flow with the existing Composer on
  a blank conversation surface; remove the now-unused form module/export if it
  has no remaining consumer.
- Add a tested title helper that trims with the existing Rust-compatible
  Unicode rules, collapses whitespace, keeps 40 Unicode scalar values, and adds
  `…` only on overflow, while passing the complete first prompt as root content.
- Route the first blank-draft Composer submit through the existing authoritative
  `createConversation` flow and preserve its exact-target generation guard.
- Ensure history selection exits the form and archive/read-only behavior remains
  unchanged.
- Add component tests for empty, loaded, and archived history entry states,
  Composer submission/title derivation, failure retry, and preservation of the
  prior store projection during the switch.
- Keep history titles single-line and add an accessible hover/focus tooltip;
  test both visual truncation styling and complete-title exposure.

## 3. Generation race regression

- Add a controller test that starts append persistence, navigates to another
  valid node, resolves the append, and proves no automatic generation begins.
- Update creation-controller tests to submit one first prompt with its derived
  title rather than accepting form-owned title/content arguments.
- Preserve existing tests proving unchanged-selection append still starts one
  exact generation and provider/unmount guards remain valid.

## 4. Validation and review

- Run focused conversation store, workspace component, and generation
  controller tests.
- Run formatter/check, warning-free lint, strict TypeScript, complete Vitest,
  and production build commands from `package.json`.
- Review the final diff for spec compliance, object-identity preservation,
  inactive-sibling exclusion, and unrelated worktree changes.

## Risk and rollback points

- The main risk is leaving `status: "loading"` owned by a stale mutation; every
  completion path must prove ownership before changing it.
- The second risk is merging into a captured tree and dropping concurrent
  selection; all merges must use the live store.
- Changes are frontend-only and can be reverted without data migration.
