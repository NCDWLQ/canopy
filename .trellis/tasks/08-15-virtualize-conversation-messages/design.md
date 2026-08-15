# Conversation Scroll Compositing Optimization Design

## Decision Summary

Treat the defect as a right-pane paint/compositing bottleneck whose cost scales with the current window area. Use a staged, production A/B process and land only the smallest proven change. Do not add message virtualization: the symptom reproduces with simple text and does not depend on conversation length or Markdown complexity.

The first candidate is the unnecessary header backdrop filter, followed by per-message shadows, then narrowly scoped CSS containment. WebKitGTK runtime flags are diagnostic fallbacks only.

## Evidence and Causal Boundary

The interview established the following causal shape:

```text
large current window area
        +
right conversation scroll surface
        +
any scroll input method
        ↓
visible frame/update slowdown
```

The symptom does not require maximized state, long history, Markdown/code, development mode, or wheel-event animation. Shrinking the current window clears it. This makes the right pane's paint/compositor work the implementation boundary.

## Experiment and Landing Protocol

Every stage follows the same protocol:

1. Start from the last accepted source state.
2. Change exactly one candidate variable.
3. Run focused automated regressions and build a release binary.
4. Test the same conversation at default and large window sizes with both wheel/trackpad and scrollbar drag.
5. Record whether the change clearly improves, has no effect, or regresses the symptom.
6. Keep the change only if it contributes to the smallest configuration that satisfies the acceptance criteria; otherwise revert that isolated candidate with `apply_patch` before moving on.

Because the active environment is a real WebKitGTK desktop and cannot be reproduced by jsdom, manual release verification is a required gate rather than an optional smoke test.

## Stage A: Remove Header Backdrop Filtering

Change the right-pane header in `ConversationWorkspace.tsx` from translucent `bg-background/90 backdrop-blur-sm` to opaque `bg-background`.

Rationale:

- the header is a normal flex sibling above the scrolling pane, not an overlay revealing useful content;
- backdrop filtering can force offscreen capture/filter/composite work;
- its cost grows horizontally with the right pane;
- removal is visually low-risk and independently reversible.

No component structure, position, dimensions, actions, or semantics change.

## Stage B: Remove Repeated Message Shadows

If Stage A is insufficient, remove `shadow-sm` from `MessageBubble` while retaining the existing border, radius, spacing, and role-specific semantic backgrounds.

Rationale:

- every visible message contributes a blurred shadow raster during scrolling;
- the right pane is the only affected surface with repeated message shadows;
- borders and background tokens already preserve message separation.

Do not redesign bubbles or add a replacement effect unless the border/background hierarchy becomes demonstrably insufficient.

## Stage C: Isolate the Scroll Paint Boundary

If Stages A and B are insufficient, test a narrow containment declaration on the `ConversationPane` scroll element. Prefer the minimum valid containment that clips descendant paint to the existing scrollport and isolates layout/paint without imposing an intrinsic size contract that breaks flex sizing.

Candidate declarations must be tested one at a time. Avoid `contain: strict`, unconditional transform promotion, and broad `will-change` defaults. If a compositor hint does not produce a clear production improvement, remove it.

The scroll element must retain:

- flex growth and full available height;
- vertical scrolling and right-edge native scrollbar;
- max-width message content;
- focus outlines, code-block horizontal scrolling, and dialog/tooltip behavior.

## Stage D: WebKitGTK Runtime Diagnostics

Only if CSS stages fail, launch the unchanged release binary in separate A/B runs with one WebKitGTK environment flag at a time, beginning with the upstream-documented DMABUF renderer diagnostic.

Runtime flags are not source changes and are not combined during diagnosis. A flag can become a product recommendation only if it clearly improves the release symptom, does not introduce blank windows/crashes/high CPU, and has a narrowly scoped rollout mechanism. Otherwise the result is documented as an upstream/environment limitation.

## Visual and Accessibility Contract

- Use existing semantic background, border, foreground, and ring tokens.
- Preserve the header border and message borders as the low-cost visual hierarchy.
- Do not change message labels, roles, live regions, keyboard behavior, focus visibility, or reduced-motion behavior.
- No new shadcn component is required; the existing feature components remain authoritative.

## Automated Verification

Automated tests cannot assert GPU frame rate, but they protect the unchanged product contract:

- conversation active-path order and sibling exclusion;
- assistant Markdown and plain text;
- transient/durable uniqueness and generation terminal states;
- edit/branch callbacks and archived read-only behavior;
- loading and error boundaries.

Style-specific tests are not added solely to assert Tailwind class strings. The performance class change is reviewed directly and proven through the release A/B gate.

## Rollout and Rollback

Stages A–C affect only frontend classes on three local surfaces and require no data migration. Each can be reversed independently. Stage D remains an external diagnostic unless separately approved after evidence.

If no candidate produces a meaningful improvement, do not land speculative CSS. Record the WebKitGTK limitation and open a focused upstream reproduction using a minimal scroll surface before considering larger architectural work.
