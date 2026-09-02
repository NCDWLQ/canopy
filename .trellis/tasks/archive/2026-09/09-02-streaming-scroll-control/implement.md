# Implementation plan

1. Add the shadcn `message-scroller` primitive and `@shadcn/react` dependency
   using the repository-pinned CLI flow, preserving the customized local
   `Button` and replacing the generated placeholder icon.
2. Adapt the local scroller wrapper to Canopy's paint-containment,
   reduced-motion, semantic-token, and circular-button requirements.
3. Compose `ConversationPane` with the provider, viewport, content/items, and
   jump-to-end button. Preserve the existing viewport ref, stable durable-path
   behavior, reveal ownership, and floating-composer clearance.
4. Add typed English and Simplified Chinese accessible text for the icon-only
   button.
5. Replace the old unconditional streaming-scroll expectations with component
   regressions for live-edge following, user-scroll release, button visibility
   and activation, follow resumption, stable rebuilt paths, reveal behavior,
   and reduced motion.
6. Run focused component tests, formatting checks for touched files, frontend
   lint, TypeScript checks, the full frontend test suite, and the production
   build. Review the generated dependency and source diff before completion.

## Rollback points

- The registry wrapper/dependency can be reverted independently if primitive
  integration fails before `ConversationPane` is converted.
- `ConversationPane` and its tests form the behavior rollback unit; locale
  entries are removed with that rollback.
