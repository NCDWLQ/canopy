# Assistant Markdown Rendering Design

## Decision Summary

Introduce a feature-owned `AssistantMarkdown` component backed by `streamdown` and the optional `@streamdown/code` plugin. The component is the single rendering boundary for both durable and transient assistant text. Other roles retain the current plain-text renderer.

This task deliberately does not replace Canopy's existing message shell or scrolling implementation. The shadcn registry has no Markdown renderer, while Streamdown already consumes shadcn-compatible semantic tokens and solves the feature's streaming-specific parsing problem.

## Architecture and Ownership

### New component

`src/features/conversations/components/AssistantMarkdown.tsx`

```ts
export type AssistantMarkdownProps = {
  content: string
  isStreaming?: boolean
}
```

Responsibilities:

- select Streamdown `mode="streaming"` while content is growing and `mode="static"` otherwise;
- configure GFM, incomplete-Markdown repair, Shiki code highlighting, controls, localization, element overrides, and URL policy once;
- expose no conversation state, node identity, provider state, or persistence behavior;
- use module-level stable configuration objects/components so token updates do not rebuild plugin configuration.

The component remains under the conversation feature because its role policy, security posture, localization, and code-control scope are product behavior rather than a generic shadcn primitive.

### Existing integrations

- `MessageNode` renders `AssistantMarkdown` only when `message.role === "assistant"` and the node is in display mode. Editing/branching UI and non-assistant messages keep the existing plain-text element.
- `TransientGenerationMessage` renders `AssistantMarkdown` whenever its generation union contains non-empty content. `isStreaming` is true only for the `streaming` phase; committing, reconciling, persistence-failed, and cancelled content is stable/static.
- `ConversationPane` continues to own status/footer presentation and transient placement. No state-machine or scrolling changes are required.

## Data Flow

```text
durable PathMessageView.content ──┐
                                  ├─> AssistantMarkdown ─> React elements
transient generation.content ─────┘        │
                                           ├─ static mode for stable content
                                           └─ streaming mode for growing content
```

The raw string remains unchanged from provider delta accumulation through persistence and projection. Rendering is deterministic and local to React.

## Markdown and Interaction Contract

- Streamdown's built-in GFM support supplies tables, task lists, strikethrough, and autolinks in addition to CommonMark.
- Standard soft breaks remain soft; no `remark-breaks` plugin is added.
- `@streamdown/code` supplies lazy Shiki highlighting. Unknown languages must fall back to readable plain code rather than fail the message.
- Controls are configured so code copy is enabled, code download is disabled, and all table/image/Mermaid export controls are disabled.
- `isAnimating` follows `isStreaming`, which keeps the library's copy control disabled while code is incomplete.
- Streamdown translations are overridden for every exposed code-control label/status so Canopy remains Simplified Chinese.
- Built-in per-token animation is not enabled. The application already streams by content replacement; avoiding extra animation reduces visual churn and respects the existing reduced-motion posture.

## Security Boundary

Assistant output is untrusted even though it originates from a configured provider.

1. Replace the default rehype plugin list rather than accepting Streamdown's permissive defaults.
2. Omit `rehype-raw`; retain sanitization and hardening in the documented order.
3. Apply one module-level URL transform that returns a target only for absolute `http:`, `https:`, and `mailto:` URLs. Relative URLs and every other scheme return no navigable target because a desktop conversation has no meaningful web origin.
4. Override links to preserve text when no safe `href` exists. Safe external anchors use `target="_blank"` and `rel="noopener noreferrer"`.
5. Disallow image elements so Markdown cannot trigger remote tracking, local-file access, data-URL decoding, or download controls. Preserve useful alt text as plain text where the library API allows it.
6. Never spread unreviewed Markdown-derived props into a custom component and never introduce `dangerouslySetInnerHTML`.
7. Keep code content as text nodes. Shiki supplies token spans, not executable code.

Tests cover raw `<script>`/event-handler input, `javascript:`, `data:`, `file:`, `tauri:` and a valid HTTPS link.

## Styling and Accessibility

- Add Tailwind 4 `@source` directives for `streamdown` and `@streamdown/code` to the existing `src/index.css`; do not create a second global stylesheet.
- Use Streamdown's shadcn-compatible `--foreground`, `--muted`, `--border`, `--ring`, `--primary`, and `--radius` tokens. Add only narrow feature overrides when the rendered result demonstrably conflicts with the existing message surface.
- Preserve semantic HTML for headings, lists, blockquotes, tables, links, and code.
- Keep long code/table content horizontally scrollable inside the existing message width so it cannot expand the conversation pane.
- Exposed copy controls require a Chinese accessible name, visible focus, and disabled state during streaming.
- Do not add a second live region; existing conversation/status semantics remain authoritative.

## Compatibility and Performance

- The chosen package supports React 19 and Node 18+; Canopy runs React 19.2 and Node 24.
- Static mode avoids streaming block splitting for durable content.
- Streaming mode uses Streamdown's block memoization and incomplete-Markdown repair rather than reparsing through a custom Canopy pipeline.
- Shiki languages are lazy-loaded. Only `@streamdown/code` is added; math, Mermaid, and CJK plugins are not installed.
- The maximum generated content size remains the existing 1 MiB contract. This task does not introduce another content limit.

## Testing Strategy

Create focused tests for `AssistantMarkdown`:

- CommonMark/GFM semantics and plain-text fallback;
- fenced/inline code and code-copy control configuration;
- streaming incomplete emphasis/link/code fence;
- raw HTML, unsafe protocols, safe external links, and non-loading images;
- Chinese accessible labels.

Update conversation tests to prove:

- only assistant roles use Markdown;
- transient streaming and durable assistant paths share behavior;
- existing terminal phases and no-duplicate transition remain intact.

Assertions use roles, names, DOM semantics, and visible content. They do not couple to Streamdown's internal Tailwind classes or broad snapshots.

## Rollout and Rollback

The feature is a presentation-only replacement with no migration. Rollback removes the two dependencies, Tailwind source directives, the feature component, and the two render call sites; stored messages remain untouched and immediately fall back to plain text.

Primary risks are upstream configuration drift and unexpected bundle cost. Pin compatible dependency ranges through the lockfile, verify a production Vite build, and keep all Streamdown-specific policy in the wrapper so a future renderer replacement affects only one component.

Dependency inspection during implementation found that `streamdown@2.5.0` directly depends on Mermaid even when the optional Mermaid plugin is not installed. Canopy therefore pins `streamdown` exactly to `2.4.0`, whose published dependency metadata does not include Mermaid. This exact pin is a deliberate bundle and scope boundary; upgrading Streamdown requires rechecking its direct dependency graph and production bundle output.
