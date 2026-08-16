# Design — history row archive button

## Touch points

| File | Change |
|------|--------|
| `src/features/conversations/components/ConversationWorkspace.tsx` | Row restructure, pending-archive state, AlertDialog, header button removal |
| `src/features/conversations/store/index.ts` | `archiveConversation(client, targetId?)` — by-ID archive |
| `src/features/conversations/hooks/useWorkspaceGenerationController.ts` | `archiveConversation(targetId?)` — confirm-time cancel orchestration |
| `src/features/conversations/components/ConversationWorkspace.test.tsx` | Rewrite header-button cases; add row/dialog/interrupt cases |
| store tests (wherever `archiveConversation` is covered) | by-ID cases |

## Component layer

### Row structure

```tsx
<li key={summary.id}>
  <div className="group relative flex items-center">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button /* select: unchanged props, add right padding (pr-9) to reserve icon space */ />
      </TooltipTrigger>
      <TooltipContent>{summary.title}</TooltipContent>
    </Tooltip>
    {!summary.isArchived && (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 -translate-y-1/2 size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground"
        aria-label={`归档 ${summary.title}`}
        title="归档"
        onClick={() => setPendingArchiveId(summary.id)}
      >
        <Archive className="size-3.5" aria-hidden="true" />
      </Button>
    )}
  </div>
</li>
```

Notes:
- Sibling buttons inside a `group relative` wrapper solve the nested-button
  validity problem; `TooltipProvider` per row stays (or hoists to the list —
  keep per-row to minimize diff).
- `absolute` positioning + opacity reveal = zero layout shift; the select
  button reserves the icon space with right padding so long titles truncate
  before going under the icon.
- The select button's own `disabled` logic (`status === "loading" ||
  isGenerationActive`) is unchanged — archive stays clickable during
  generation per R4.
- `focus-visible` on the icon button itself triggers `group-focus-within`,
  so keyboard users see it; it stays in tab order always (opacity is visual
  only — do NOT use `visibility`/`display` hiding).

### Pending archive + AlertDialog

- `const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null)`
- Pending summary resolved via `store.history.summaries.find(...)`.
- Dialog (shadcn `AlertDialog`, already vendored):
  - Title: `归档会话？`；target title shown in the description.
  - Description: `归档后会话转为只读，并在历史记录中标记为已归档。`
    + when `pendingId === store.conversationId && isGenerationActive(store.generation)`:
    `归档将打断正在进行的生成。`
  - This "interrupts generation" condition is **evaluated at render time of
    the open dialog**, i.e. it reflects confirm-time state (requirement R4:
    decide at confirm time, including the finished-while-open case).
  - Confirm handler: `void controller.archiveConversation(pendingArchiveId)`
    then `setPendingArchiveId(null)`. Cancel: just `setPendingArchiveId(null)`.
- Render the `AlertDialog` once at workspace level (not per row), controlled
  by `open={pendingArchiveId !== null}`.

## Controller layer

`archiveConversation` gains a target parameter and owns the cancel decision:

```ts
archiveConversation: async (targetId?: string) => {
  const store = useConversationStore.getState()
  const target = targetId ?? store.conversationId
  if (target === null) return
  // Confirm-time interruption: only when the target IS the generating
  // conversation. Other rows never touch the run.
  if (
    target === store.conversationId &&
    isGenerationActive(store.generation) &&
    !controllerCancelQueuedAlready…
  ) {
    cancel()
  }
  await useConversationStore.getState().archiveConversation(conversationClient, target)
}
```

Why immediate (not awaited) cancel is safe here: `cancel()` calls
`store.cancelGenerationRun(runId)`, which **synchronously** sets
`generation.phase = "cancelled"` (`store/index.ts:688-701`). By the time the
store's `archiveConversation` runs, `isGenerationActive` is already false, so
its guard passes without a race. This mirrors the existing `prepareMutation`
pattern (`useWorkspaceGenerationController.ts:237-240`), which also cancels
and proceeds without awaiting the provider terminal event.

Residual race (accepted, documented): the provider stream may still be
flushing server-side when the archive transaction runs. The Rust
`archive_conversation` has no generation guard and the tree verification in
the store checks the returned view, so a mid-flight node append could in
theory interleave. The controller's run/epoch guards already ignore stale
run events client-side. If testing exposes corruption, the mitigation is to
await the terminal event before archiving — noted as a rollback lever, not
in scope.

## Store layer

```ts
archiveConversation: async (client, targetId?) => {
  const state = get()
  const target = targetId ?? state.conversationId
  if (target === null) return

  const summary = state.history.summaries.find((s) => s.id === target)
  const isCurrent = target === state.conversationId
  if (summary === undefined && !isCurrent) return          // row vanished
  if (summary?.isArchived) return                          // already archived
  if (isCurrent && state.isArchived) return

  if (!isCurrent) {
    // Non-current: history-only mutation; do NOT touch global status.
    try {
      const conversation = await client.archiveConversation(target)
      if (conversation.id !== target || !conversation.isArchived) {
        // surface on history error channel, not conversation status
        set({ history: { ...get().history, error: … } })
        return
      }
      set({ history: { status: "ready", summaries: upsertSummary(...isArchived: true), error: null } })
    } catch (error) { /* history error channel */ }
    return
  }

  // Current conversation: existing flow, minus the generation/ready guards.
  // Keep: status loading→ready, tree integrity check, isArchived + summary.
}
```

Decision detail — error channel for non-current archives: the global
`status: "error"` would disable the whole sidebar and evict the loaded tree's
readiness; a failed archive of row B must not look like conversation A broke.
`ConversationHistoryState` already has an `error` field used by the history
`Alert` block (`ConversationWorkspace.tsx:374-389`), so failures route there.
(Exact shape: follow `retryHistory`'s error handling; if the existing history
error type is too narrow to express this, extend it minimally rather than
reusing conversation status.)

Guard removals vs. legacy:
- `state.status !== "ready"` early-return: dropped. During generation the
  status is `"streaming"`; after `cancel()` it may remain `"streaming"` until
  the provider terminal arrives, and archiving must still proceed (R4).
  The archive flow itself sets `status: "loading"` then `"ready"`, which also
  normalizes this.
- `isGenerationActive` early-return: dropped for the same reason — the
  controller is now the sole owner of the cancel decision. (The store cannot
  distinguish "user confirmed interrupt" from "accidental call" any more, but
  the only caller is the controller path behind the dialog.)

## Alternatives considered

- **Await provider terminal before archiving**: correct but requires a new
  "stream fully closed" signal that doesn't exist today (phase `cancelled` is
  set synchronously; the terminal event only confirms it). Deferred.
- **Disable row buttons during generation**: rejected by product decision
  (bc3b539 lineage); interruption is a confirm-time concern.
- **Per-row AlertDialog instances**: rejected — one controlled dialog at
  workspace level, keyed by `pendingArchiveId`.
- **Unarchive action on archived rows**: out of scope (explicitly deferred in
  planning).

## Rollback

Single commit on `feat/history-row-archive-button`; revert restores the header
button. No data migrations (archive flag semantics unchanged).
