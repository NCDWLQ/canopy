# Design: streaming scroll control

## Boundary

The change stays inside the conversation presentation layer. Generation state,
message persistence, branch selection, and the Zustand store remain unchanged.
`ConversationPane` continues to expose the scroll viewport ref used by exact
search and Panorama reveal positioning.

## Component approach

Adopt the repository-compatible shadcn `MessageScroller` registry primitive and
its `MessageScrollerButton` instead of maintaining a second hand-written
stick-to-bottom state machine. The primitive already owns the required
contract: follow content growth at the live edge, yield when the user scrolls
away, expose visibility state, and jump back to the end.

The generated wrapper must be reviewed before integration:

- preserve the customized local `Button` rather than overwriting it;
- replace registry placeholder icons with the repository's Lucide
  `ArrowDownIcon`;
- keep the current native WebKitGTK viewport sizing, scrollbar, horizontal
  descendant scrolling, and paint-containment behavior;
- add reduced-motion-safe transition behavior;
- use the existing semantic color tokens and a circular local `Button` shape.

`MessageScrollerButton` is positioned above the floating composer, centered on
the transcript. Its accessible label comes from the typed `en` and `zh-CN`
locale dictionaries.

## Scroll and reveal behavior

- Durable path changes continue to establish the latest content as the initial
  position, while an unchanged reconstructed path does not reset the viewport.
- Transient assistant growth is delegated to `MessageScroller` auto-scroll.
- User wheel, trackpad, keyboard, or scrollbar movement away from the live edge
  releases auto-scroll and activates the jump button.
- Clicking the jump button returns to the end and restores auto-scroll.
- While an exact search/Panorama reveal owns the viewport, bottom following must
  not override its target. Existing reveal effects continue to target the
  scroller viewport.

## Compatibility and rollback

The registry adds `@shadcn/react` and one local UI wrapper. No schema or persisted
state changes are required. If the primitive conflicts with WebKitGTK or reveal
positioning, rollback is limited to the dependency, wrapper, and
`ConversationPane` integration; the prior bottom effect remains available in
Git history.

## Risks

- The registry dry-run proposes overwriting the customized `Button`; integration
  must explicitly preserve the local file.
- The registry viewport's default containment is stronger than Canopy's current
  paint-only contract, so the wrapper must retain the established containment.
- The floating composer overlaps the bottom of the transcript; the button must
  be offset above it and verified at narrow and desktop widths.
