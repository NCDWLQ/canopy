# Implementation Plan — history row archive button

Worktree: `/home/jwh/Code/canopy-archive-row` (branch `feat/history-row-archive-button`)

## Pre-flight

- [ ] Read `.trellis/spec/frontend/component-guidelines.md`,
      `state-management.md`, `quality-guidelines.md` (indexes already read).
- [ ] Skim `MessageBubble.tsx` hover-reveal pattern and
      `alert-dialog.tsx` API before writing JSX.

## Steps (ordered)

1. **Store: archive by ID** (`store/index.ts`)
   - [ ] Change signature `archiveConversation(client, targetId?)`.
   - [ ] Branch: non-current target → history-only mutation (summary upsert,
         history error channel); current target → existing flow with
         generation/ready guards removed.
   - [ ] Already-archived / vanished-summary skips.
   - Validation: `pnpm vitest run src/features/conversations/store` (or the
   closest existing store test file — locate with
   `grep -rl "archiveConversation" src --include="*.test.*"`).

2. **Controller: confirm-time orchestration**
   (`useWorkspaceGenerationController.ts`)
   - [ ] `archiveConversation(targetId?)`: cancel() first when target is the
         generating current conversation, then store call with target ID.
   - Validation: type-check.

3. **Component: row restructure + dialog + header removal**
   (`ConversationWorkspace.tsx`)
   - [ ] `<li>` → `group relative` wrapper, sibling select/archive buttons,
         select button gets right padding; icon absolute right, opacity
         reveal, `aria-label`/`title`.
   - [ ] `pendingArchiveId` state + workspace-level controlled `AlertDialog`
         (title/description per design; generation warning evaluated from
         live store state while open).
   - [ ] Delete header archive button block (lines ~478-493); keep read-only
         badge; drop now-unused `canEditDraft` parts if it has no other
         consumers (verify before deleting the variable itself).
   - Validation: `pnpm lint && pnpm type-check` (use scripts from
   package.json), manual smoke via `pnpm tauri dev` if available.

4. **Tests** (`ConversationWorkspace.test.tsx` + store tests)
   - [ ] Rewrite the bc3b539-era cases (~lines 1019-1045): header button no
         longer exists; during streaming the row button is visible+enabled.
   - [ ] New: click opens dialog → cancel = no changes; confirm = archives
         target (mock client assert called with target ID).
   - [ ] New: confirming on generating current conversation calls
         cancel-then-archive (assert cancel side effect + archive call).
   - [ ] New: confirming another row during generation archives without
         cancel.
   - [ ] Store: by-ID archive current / non-current / already-archived /
         non-current failure routes to history error (no global status
         flip).
   - Validation: `pnpm vitest run` full suite.

5. **Quality gate** (`trellis-check` scope)
   - [ ] `pnpm lint`
   - [ ] type-check (tsc)
   - [ ] full `pnpm vitest run`
   - [ ] Cross-layer review: dialog copy vs. actual behaviour; focus order;
         `group-focus-within` reveal; no nested buttons (grep the rendered
         row).

## Review gates

- After step 3: self-review JSX against component-guidelines (a11y: icon
  button name, dialog labelled by title).
- After step 4: verify no tautological tests (delete feature mentally —
  does the assertion still fail?).

## Rollback points

- Each step is independently revertable; store change (1) is backward
  compatible (optional param), so steps 2-3 can land even if tests reveal a
  component issue.

## Out of scope (do not do)

- Unarchive / restore action.
- Any Rust change.
- Sidebar row selection semantics during generation.
