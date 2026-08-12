# Implementation Plan

## 1. Enrich terminal generation state without weakening authority

- [x] Extend `GenerationState` terminal variants with phase-derived failure
      kind, retained presentation content, and an explicit reconciliation
      user-action flag; do not add commit-token or fabricated-node fields.
- [x] Update `failGeneration` to classify pre-ready failures as generation
      failures and `committing`/`reconciling` failures as persistence failures.
- [x] Preserve partial content on cancellation and complete content on explicit
      persistence failure, discard partial content on generation failure, and
      leave `nodesById`/`fullNodes` unchanged.
- [x] Make automatic reconciliation, unresolved/failed reload, and manual retry
      transitions explicit so the retry affordance appears only when needed.
- [x] Expand store tests for all terminal transitions, content retention,
      immutable durable maps, exact reload completion, no-match/multi-match
      behavior, and retry-state reset.

Review gate: every terminal presentation fact is carried only by transient
generation state; only backend authority mutates durable nodes.

## 2. Delay visible recovery while preserving exact terminal delivery

- [x] Refactor reconciliation scheduling so accepted acknowledgement and an
      ambiguous commit exception both remain `committing` for the existing
      injectable 1,500 ms grace period.
- [x] Capture only a safe normalized ambiguity error in the timer closure;
      continue passing `commitToken` directly from the ready callback to the
      single commit call.
- [x] On grace expiry, enter `reconciling` and start one SQLite reload; clear
      timers on exact terminal events and cleanup.
- [x] Keep exact `completed`/`failed` authoritative before, during, and after
      an early reload. Ensure a late command result cannot cancel or overwrite
      a terminal run.
- [x] Add controller fake-timer/race tests for silence before the threshold,
      automatic reload after it, terminal arrival on both sides of the timer,
      accepted false, ambiguous transport, reload failure/no match, manual
      retry, unmount cleanup, and token absence.

Review gate: no user-visible recovery state is possible before the grace timer,
and no timer can fabricate failure or durable content.

## 3. Render every transient phase through the ordinary message surface

- [x] Extract an identity-free shared message bubble shell from the durable
      `MessageNode` presentation and use it for transient generation output.
- [x] Replace engineering-oriented transient mapping with the exact required
      Chinese copy and actions: “正在思考”, “正在恢复这条回复…”, “回复失败”,
      “这条回复未能保存”, “回复已停止”, “重新生成”, and “重试恢复”.
- [x] Keep streaming/committing content in one assistant slot with no badge,
      save status, database wording, warning card, or transient identity.
- [x] Wire regeneration to the existing controller generate intent and recovery
      retry to the gated SQLite reload intent.
- [x] Preserve accessible polite status semantics, reduced-motion scrolling,
      durable branch/edit actions, and the position of the message after the
      active user path.
- [x] Expand workspace/component tests to cover every phase, exact copy,
      action availability, partial/full content preservation, absence of banned
      engineering text, one assistant slot across commit/completion, sibling
      exclusion, and no token in DOM.

Review gate: deleting the transient special-case styling or any one required
phase behavior makes a focused behavioral test fail.

## 4. Update executable specs and run quality gates

- [x] Update frontend component, state-management, hook, and type-safety specs
      to replace the obsolete `Not saved` rule with the productized projection,
      delayed recovery, failure-kind, and content-retention contracts.
- [x] Search production source for banned copy and `commitToken`/`commit_token`
      propagation; verify tokens remain only in the typed bridge, backend
      runtime/DTO, and callback-local commit flow, with no logs or props.
- [x] Run focused tests:
      `pnpm test -- src/features/conversations/store/generation.test.ts src/features/conversations/hooks/useWorkspaceGenerationController.test.tsx src/features/conversations/components/ConversationWorkspace.test.tsx`.
- [x] Run the equivalent repository-pinned frontend check commands directly;
      literal `pnpm` was unavailable because its sandbox state database could
      not be opened.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --all-features` to
      preserve strict generation/commit regressions.
- [x] Run the Tauri debug no-bundle build as the desktop integration gate.
- [x] Review the final diff for unrelated worktree changes, timer leaks,
      inaccessible actions, duplicated phase mapping, and durable-state drift.

## Rollback points

- Terminal-state changes can be reverted independently while retaining the
  existing protocol and durable merge.
- Timer scheduling can return to the previous immediate-reconciliation
  behavior without any data migration.
- The shared message shell and copy can be reverted without touching store or
  controller semantics.
- Never roll back by persisting transient content, exposing a commit token, or
  inventing a retry-save protocol.
