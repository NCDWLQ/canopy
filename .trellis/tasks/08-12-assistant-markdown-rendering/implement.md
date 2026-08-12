# Assistant Markdown Rendering Implementation Plan

## Preconditions

- Review and approve `prd.md` and `design.md` before starting implementation.
- Load the frontend component, directory, quality, and code-reuse specifications from the curated manifests.
- Confirm the installed Streamdown API/types against the locked version before finalizing security and translation props; do not guess undocumented keys.

## Implementation Checklist

1. Add exact `streamdown@2.4.0` and `@streamdown/code` with pnpm and record the resolved versions in `pnpm-lock.yaml`; verify that Mermaid is absent from the resolved dependency graph.
2. Add the documented Tailwind 4 `@source` directives to `src/index.css`; do not enable optional animation CSS or unselected plugins.
3. Create `AssistantMarkdown.tsx` with named props, stable module-level plugin/control/translation configuration, explicit static/streaming mode, and the security boundary from `design.md`.
4. Add `AssistantMarkdown.test.tsx` covering GFM, code controls, incomplete streaming input, safe/unsafe links, raw HTML, images, localization, and unknown-language fallback. Mock only browser APIs that jsdom genuinely lacks.
5. Replace the durable assistant display branch in `MessageNode.tsx`; preserve the existing plain-text renderer for all non-assistant roles and all edit/branch forms.
6. Replace the non-empty transient content branch in `ConversationPane.tsx`; derive `isStreaming` only from `generation.phase === "streaming"` and leave status/footer/state-machine logic unchanged.
7. Extend the narrowest existing conversation component/integration tests to prove assistant-only Markdown, transient behavior, terminal-state retention, and transient-to-durable no-duplicate behavior.
8. Review generated DOM and production CSS for long code/table overflow, focus visibility, Chinese accessible labels, and theme-token compatibility. Make only narrow feature-level style corrections.
9. Run focused tests during iteration, then the full repository gate.

## Validation Commands

```bash
pnpm test -- src/features/conversations/components/AssistantMarkdown.test.tsx src/features/conversations/components/ConversationWorkspace.test.tsx
pnpm lint
pnpm typecheck
pnpm check
```

`pnpm check` is the final source of truth and includes formatting, lint, type-check, all tests, and the production Vite build.

## Review Gates

- Security review verifies the configured rehype list, URL transform, image behavior, and absence of `dangerouslySetInnerHTML`.
- UX review verifies GFM soft breaks, incomplete streaming fences, copy disabled while streaming, and no download/export controls.
- Regression review verifies message roles, generation phases, branch/path isolation, scrolling, and transient-to-durable uniqueness are unchanged.
- Dependency review verifies only the selected core and code packages were added; math, Mermaid, CJK, MDX, sanitizer duplicates, and raw-HTML plugins are absent as direct dependencies unless the installed API demonstrably requires an explicitly reviewed package.
- Dependency review also rejects a floating Streamdown range: version `2.5.0` directly pulls Mermaid, so the accepted implementation must keep an exact `2.4.0` pin until a later upgrade is separately reviewed.

## Risky Files and Rollback Points

- `src/features/conversations/components/MessageNode.tsx`: assistant-only role branch. Roll back this call site independently if durable rendering regresses.
- `src/features/conversations/components/ConversationPane.tsx`: generation presentation. Roll back this call site independently if streaming/terminal behavior regresses.
- `src/features/conversations/components/AssistantMarkdown.tsx`: renderer and trust boundary. All upstream-specific behavior must stay here for one-file review/replacement.
- `src/index.css`: dependency scanning only; remove both `@source` directives when reverting dependencies.
- `package.json` / `pnpm-lock.yaml`: remove both dependencies together on rollback.

No database, IPC, Rust, store, or fixture rollback is required because those layers are out of scope.
