# Implementation plan: Conversation Panorama terminology refactor

## Ordered checklist

1. Load the frontend development guidance and confirm the working tree is
   still clean apart from this task's planning artifacts.
2. Rename the canvas and layout files, then mechanically rename their public
   symbols, React Flow node type, comments, and local identifiers.
3. Update `ConversationWorkspace` state, branch rendering, import, and
   Panorama control labels.
4. Rename both locale key namespaces and translate the visible labels to
   “对话全景” / “Conversation Panorama”.
5. Update barrel exports, all component/layout/workspace tests, and the active
   frontend component guideline to use Panorama terminology.
6. Search active source, tests, and specs for stale mind-map terms; inspect
   the diff for accidental behavior or unrelated changes.
7. Run focused Panorama/layout/workspace tests, then the full frontend quality
   gate and build.

## Validation commands

- `rg -n -i '思维导图|mind.?map|mindmap|MindMap' src .trellis/spec/frontend`
- `pnpm exec vitest run src/features/conversations/panoramaLayout.test.ts src/features/conversations/components/ConversationPanorama.test.tsx src/features/conversations/components/ConversationWorkspace.test.tsx src/lib/i18n/index.test.ts`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Risky files / review gates

- `ConversationWorkspace.tsx`: verify the Panorama route still closes on
  double-click and preserves branch selection.
- `ConversationPanorama.tsx` and `panoramaLayout.ts`: verify React Flow
  handles, edge count, node dimensions, and collapse state are unchanged.
- `locales/zh-CN.ts` and `locales/en.ts`: verify identical renamed key sets
  and exact user-facing terminology.
- Tests: ensure selectors assert the new accessible names rather than hiding
  a stale implementation behind broad text matching.

## Rollback point

Before changing product source, preserve the clean baseline and review the
rename-only diff. If focused tests reveal behavior drift, revert the file
renames/symbol changes and reapply in smaller slices; no data rollback is
required.
