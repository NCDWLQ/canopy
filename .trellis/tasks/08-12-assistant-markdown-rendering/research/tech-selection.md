# Markdown Renderer Technical Selection

## Repository Evidence

- Canopy is a Vite SPA on React 19, Tailwind CSS 4, and shadcn/radix-nova (`package.json:22-35`, `components.json`).
- Durable messages render raw text in `MessageNode.tsx:140-143`.
- Streaming and recovery messages independently render raw text in `ConversationPane.tsx:52-108`.
- Message content is already a plain `string`; Markdown is a presentation concern and does not require IPC, Rust, SQLite, or store contract changes.
- The repository has no Markdown parser, sanitizer, or syntax-highlighting dependency.
- Existing frontend specs require feature behavior to remain in `features/conversations`, generic primitives to remain in `components/ui`, and tests to assert visible behavior rather than Tailwind class strings.

## Candidates

### Streamdown

- Purpose-built for token-by-token AI Markdown and repairs incomplete emphasis, links, and code fences while streaming.
- Renders CommonMark/GFM with built-in typography and memoized block updates.
- Optional `@streamdown/code` plugin provides lazy-loaded Shiki highlighting and code copy controls.
- Uses shadcn-compatible semantic design tokens and Tailwind 4 `@source` integration, matching this repository.
- Includes sanitization and URL hardening, but its default link/image hardening is permissive; Canopy must explicitly disable raw HTML and restrict URL behavior for untrusted assistant output.
- Apache-2.0 licensed.

### react-markdown + remark-gfm

- Mature, safe-by-default React AST renderer with CommonMark and plugin-based GFM.
- Strong control over allowed elements, URL transforms, and custom components.
- Does not solve incomplete Markdown during streaming. Canopy would need to accept formatting churn or add its own buffering/repair layer.
- Syntax highlighting and copy controls require extra dependencies and custom UI.
- MIT licensed.

### marked + DOMPurify

- Fast and relatively low-level.
- Produces HTML and explicitly does not sanitize it; safe React integration requires a separate sanitizer and `dangerouslySetInnerHTML` boundary.
- Adds more security composition work and loses the clean React-component mapping available in the two candidates above.
- Rejected for this feature.

## Recommendation

Use `streamdown` behind a feature-local `AssistantMarkdown` component. Reuse the component for durable and transient assistant messages, pass streaming state explicitly, and keep user/system/tool messages on the current plain-text surface.

For the recommended MVP, add `@streamdown/code` for fenced-code highlighting and copy. Do not enable raw HTML, remote images, math, Mermaid, or download controls. Allow only `http`, `https`, and `mailto` links, open external links safely, and render unsupported/unsafe targets without an active navigation path.

This selection fits the feature's defining constraint—content is visibly updated token by token—while avoiding a custom incomplete-Markdown repair layer.

### Version constraint discovered during implementation

`streamdown@2.5.0` directly declares `mermaid` even when Canopy does not install the optional Mermaid plugin. That contradicted the selected MVP scope and produced a large production chunk. Published registry metadata for `streamdown@2.4.0` does not include Mermaid, so Canopy pins the core package exactly to `2.4.0`. Any later Streamdown upgrade must re-audit direct dependencies and Vite bundle output before changing this pin.

## Sources

- Streamdown overview and Tailwind/shadcn integration: https://github.com/vercel/streamdown
- Streamdown security configuration: https://streamdown.ai/docs/security
- Streamdown code plugin: https://streamdown.ai/docs/code-blocks
- react-markdown behavior and security: https://github.com/remarkjs/react-markdown
- Marked security warning: https://marked.js.org/
