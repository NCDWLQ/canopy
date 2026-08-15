# TanStack Virtual Chat Research — Superseded for This Task

> Status: deferred follow-up research. The active task no longer implements
> message virtualization because the reported slowdown reproduces with short,
> plain-text content and scales with the current right-pane paint area. See
> `prd.md` and `research/webkitgtk-scroll-performance.md` for the active scope.

## Sources

- TanStack Virtual Chat guide: https://tanstack.com/virtual/latest/docs/chat
- TanStack Virtualizer API: https://tanstack.com/virtual/latest/docs/api/virtualizer
- React chat example: https://tanstack.com/virtual/v3/docs/framework/react/examples/chat
- TanStack chat design note: https://tanstack.com/blog/tanstack-virtual-chat

Accessed 2026-08-15.

## Findings

1. The React adapter exposes `useVirtualizer` for an element-owned scroll container, matching Canopy's `ConversationPane`.
2. Variable-height rows use an estimate first and attach `virtualizer.measureElement` plus `data-index` to every mounted row. The default measurement uses the row's bounding box and observes later size changes.
3. Chat is explicitly modeled with `anchorTo: "end"`. This keeps a pinned viewport at the latest edge while the last item grows during streaming.
4. `followOnAppend` follows appended output only if the reader was already within `scrollEndThreshold` of the end. It does not pull a reader away from older content.
5. Stable `getItemKey` values are required. Persistent message IDs are the correct Canopy identity; index keys are unsuitable when the active path changes.
6. `scrollToEnd()` replaces a separate bottom DOM sentinel and is the documented initial/latest positioning mechanism.
7. `overscan` bounds extra mounted items. More overscan reduces blank flashes but increases rendering work; the value is an implementation tuning parameter rather than a product contract.
8. `useAnimationFrameWithResizeObserver` can align resize-driven measurements with animation frames and reduce observer-loop warnings, but adds a small measurement delay. It should be verified against streaming behavior.
9. The virtualizer remains headless and does not require a visual component-system migration. Canopy can retain its existing MessageNode, MessageBubble, Streamdown, statuses, and semantic tokens.

## Deferred Follow-up Notes

- A future long-conversation capacity task could virtualize the durable path and transient assistant as one ordered sequence.
- That follow-up would need to measure the streaming last row and invalidate measurements when width changes alter Markdown wrapping.
- It would also need to preserve local edit/branch components by retaining active interaction indexes.
- Error/loading decoration would need to share or explicitly offset the virtual coordinate origin.

## Deferred Status

No package version or virtualizer tuning parameter will be selected in the current task. Those decisions belong to a separately approved long-conversation optimization task and do not affect the active scroll-compositing MVP.
