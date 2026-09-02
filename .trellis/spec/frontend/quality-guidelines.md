# Quality Guidelines

> Initial frontend quality and testing contract for Canopy.

---

## Overview

Frontend verification protects two product invariants: the UI navigates a first-class tree, and the message pane/model request never absorbs sibling-branch history. Prefer behavioral tests over implementation-detail snapshots.

The initial toolchain is Vitest, React Testing Library, `@testing-library/user-event`, and `jest-dom`, configured by the application scaffold task. Type-check, lint, unit/component tests, and Rust tests are separate required gates.

## Large-Window Scroll Compositing

The conversation pane is a real WebKitGTK scroll surface in the desktop
release build. When a large-window regression is reported, validate the
release binary at both the default and large window sizes before changing the
message data path or adding list virtualization.

- Keep the scroll element's flex sizing, `overflow-y-auto`, native scrollbar,
  focus outlines, and descendant horizontal scrolling intact. The conversation
  pane viewport is `MessageScrollerViewport`; do not replace it with a second
  hand-written overflow container.
- Prefer removing paint work that is not visually required (for example,
  backdrop filters on non-overlay siblings or repeated message shadows) before
  adding compositor hints.
- If the issue follows the current painted area and reproduces with short plain
  text, test one narrow CSS containment change at a time. Do not combine
  `will-change`, forced transforms, or strict containment without release A/B
  evidence.
- Do not put `content-visibility: auto` or intrinsic-size hints on
  `MessageScrollerItem`. Off-screen message rows must keep real layout so
  search/Panorama reveal can measure and `scrollIntoView` them.
- Record the manual release result for wheel/trackpad and scrollbar dragging;
  browser/jsdom tests cannot establish GPU frame performance.

```tsx
<MessageScrollerViewport className="size-full min-h-0 min-w-0 overflow-y-auto [contain:paint]">
  {messages}
</MessageScrollerViewport>
```

The containment declaration must remain a local scroll-surface optimization
(`[contain:paint]` only); it must not change message ordering, branch
isolation, generation state, or accessibility semantics. WebKitGTK environment
flags are diagnostics only and must not become default startup behavior
without cross-machine evidence.

## Forbidden Patterns

- Raw Tauri `invoke`, SQL, or provider HTTP calls inside React components.
- `any`, unchecked type assertions, or trusting `invoke<T>` as runtime validation.
- Mutating historical message content or parent relationships in client state.
- Duplicating root-to-active traversal in multiple components/selectors.
- Broad snapshots as the only assertion for tree behavior.
- Tests that assert active ancestors are present but never assert sibling content is absent.
- Tests coupled to Tailwind class strings when an accessible role, name, state, or callback is observable.
- Logging API keys, full prompts, raw provider bodies, or local database paths.

## Required Patterns

- Decode unknown IPC results once in `lib/tauri`; components consume typed frontend projections.
- Use normalized Zustand state keyed by node ID and narrow, pure selectors.
- Keep path derivation in one selector/application boundary and preserve root-to-active order.
- Represent loading, streaming, cancellation, retryable failure, and terminal failure explicitly.
- Test user behavior through accessible queries and `userEvent`.
- Use fixtures with stable node IDs and at least two sibling branches for every path-sensitive regression.
- Treat component props and component-local view-model fixtures as the handoff
  contract for the developer-managed frontend agent. IPC payload fixtures and
  shared contract changes remain with the main integration session.

## Testing Requirements

| Layer | Required coverage | Assertion points |
|---|---|---|
| Pure functions/selectors | normalized tree updates, expansion, active selection, root-to-active projection | deterministic IDs/order; original input unchanged; sibling excluded |
| Typed Tauri bridge | success decoding and every stable `CommandError` shape | malformed payload, invalid Unicode, disconnected/cyclic trees, and opaque prototype-like IDs covered; secrets absent |
| Components | tree navigation, message path, branch/edit intents, composer, provider form states | roles/names/state, callback IDs/counts, disabled behavior |
| Feature integration | mocked bridge -> store -> rendered path | loading-to-ready transition; exact active path; no sibling leakage |
| Desktop smoke | one create/select/branch path after the vertical proof exists | durable selection after reload and visible branch separation |

Minimum path fixture:

```text
root -> user-a -> assistant-a -> user-left
                            \-> user-right (active)
```

The active-path assertion must equal `[root, user-a, assistant-a, user-right]` and must explicitly reject `user-left`.

Every bug fix adds a regression at the lowest layer that can reproduce it. A test is invalid if removing the behavior under test would still let it pass.

## Good / Base / Bad Cases

- **Good**: navigate to `user-right`, assert the ordered path, and assert `user-left` is absent.
- **Base**: a one-root conversation supports selection and composer focus without fabricating an assistant node.
- **Bad**: malformed tree or IPC data renders a typed recovery state and never silently switches to full conversation history.

## Validation Matrix

| Change | Minimum commands once scaffolded |
|---|---|
| Component/style only | frontend lint, TypeScript check, focused component tests |
| Zustand/selector | frontend lint, TypeScript check, selector unit tests, affected component tests |
| IPC DTO/error | frontend and Rust type/tests plus malformed-payload tests |
| Path/branch behavior | full frontend suite and SQLite/Rust branch-isolation regressions |

Use repository scripts as the command source of truth. Do not invent a second test command in task documentation.

## Wrong vs Correct

### Wrong

```ts
expect(screen.getByText("user-right")).toBeVisible();
```

This passes even if the UI accidentally renders both branches.

### Correct

```ts
expect(screen.getByText("user-right")).toBeVisible();
expect(screen.queryByText("user-left")).not.toBeInTheDocument();
```

## Code Review Checklist

- [ ] Components consume view models and callbacks, not persistence/IPC details.
- [ ] The active path is ordered root-to-current and excludes siblings.
- [ ] Historical edits create branch intent rather than destructive local mutation.
- [ ] Tree and menu interactions are keyboard accessible with visible focus.
- [ ] Loading, empty, cancellation, retryable, and terminal error states are covered.
- [ ] Tests assert externally visible behavior and fail when the behavior is removed.
- [ ] Shared DTO/store/bridge files were changed only by their designated owner.
- [ ] Lint, type-check, focused tests, and cross-layer regressions passed or the missing scaffold is reported.
