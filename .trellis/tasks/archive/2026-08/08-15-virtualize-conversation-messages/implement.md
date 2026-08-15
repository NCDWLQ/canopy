# Conversation Scroll Compositing Implementation Plan

## Preconditions

- Review and approve the revised `prd.md` and `design.md` before starting implementation.
- Load the curated frontend component, directory, quality, and WebKitGTK research context.
- Use one stable conversation fixture and the same default/large window sizes for every manual release comparison.

## Implementation Checklist

1. Capture the baseline once in the release binary: default-size result, large-size result, wheel/trackpad result, and scrollbar-drag result.
2. Stage A: change the right header to opaque `bg-background` and remove `backdrop-blur-sm`; run focused conversation tests, type-check, and a release build.
3. Ask the user to repeat the fixed production A/B scenario. Record the result in `research/webkitgtk-scroll-performance.md`.
4. If Stage A satisfies acceptance, stop adding performance changes and proceed to the full quality gate.
5. If Stage A has no measurable benefit, retain it only when it removes visually unnecessary paint at no visual or behavior cost; record that it is cleanup rather than a standalone performance proof before adding another variable. Otherwise revert it before Stage B.
6. Stage B: remove `shadow-sm` from `MessageBubble` while retaining its border/background hierarchy; rerun focused checks and the same release A/B against the last accepted baseline.
7. Keep Stage B only if it adds a measurable benefit over that baseline; otherwise revert it. If the accepted configuration satisfies acceptance, stop and proceed to quality verification. In this run Stage B produced a slight user-observed improvement.
8. If CSS effects are still insufficient, Stage C: test one minimal scroll containment/compositor declaration on `ConversationPane`; validate flex sizing, clipping, focus, code overflow, tooltips/dialogs, and the same release A/B.
9. Keep only a clearly beneficial Stage C declaration; remove speculative hints that do not improve production behavior.
10. If all CSS stages fail, run Stage D external diagnostics against the unchanged release binary with one WebKitGTK DMABUF/compositing environment flag at a time. Record performance and any correctness/CPU/crash regression. Do not commit a default environment workaround without a new review decision.
11. Update the research record with the final causal result and retained changes.
12. Run the full Trellis quality check and repository gate.

## Validation Commands

```bash
pnpm test -- src/features/conversations/components/ConversationWorkspace.test.tsx src/features/conversations/components/AssistantMarkdown.test.tsx
pnpm lint
pnpm typecheck
pnpm check
pnpm tauri build --no-bundle
```

The final release binary is `src-tauri/target/release/canopy`. Automated gates protect correctness; the release desktop A/B is the performance source of truth.

## Review Gates

- Causality review confirms each candidate was tested independently and its result recorded.
- Minimality review confirms no later stage remains if an earlier stage alone satisfies acceptance.
- Visual review confirms opaque header and/or shadow removal retains usable hierarchy in light and dark themes.
- Layout review confirms containment, if retained, does not break flex height, native scrolling, focus rings, horizontal code overflow, overlays, or textarea resizing.
- Runtime review rejects committed WebKitGTK disable flags without clear benefit and a separate rollout decision.
- Regression review confirms the complete conversation behavior suite remains green.

## Risky Files and Rollback Points

- `src/features/conversations/components/ConversationWorkspace.tsx`: Stage A is one header class change and can be reverted independently.
- `src/features/conversations/components/MessageBubble.tsx`: Stage B affects every message surface; the existing border/background must remain.
- `src/features/conversations/components/ConversationPane.tsx`: Stage C can affect clipping and flex layout; it must be the last CSS stage and independently reversible.
- WebKitGTK environment flags: external diagnostic only; never combine flags or persist them during the initial comparison.

No package dependency, backend, IPC, store, database, or persisted-data rollback is required.
