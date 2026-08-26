# Design: Assistant Markdown Images

## Architecture / Boundary

Change stays inside the existing assistant Markdown trust boundary:

- `src/features/conversations/components/AssistantMarkdown.tsx` — harden options, `img` component, optional CSS class
- `src-tauri/tauri.conf.json` — CSP `img-src`
- `src/features/conversations/components/AssistantMarkdown.test.tsx` — security/render assertions
- `.trellis/spec/frontend/component-guidelines.md` — update the documented contract

No new renderer, no message-role changes, no Streamdown version bump.

## Security Contract

Assistant content remains untrusted.

1. Keep omitting `rehype-raw` / `dangerouslySetInnerHTML`; keep sanitize + harden order.
2. Harden images:
   - `allowedImagePrefixes: ["*"]` — rehype-harden 1.1.8 does not accept scheme-only
     prefixes like `"http://"` / `"https://"` (they fail `URL` parse and match nothing);
     `"*"` still only permits http/https (and path-relative rewrite), never `javascript:`/`data:`/`file:`
   - `allowDataImages` unset/false
   - `imageBlockPolicy: "text-only"` for blocked URLs
   - `allowedProtocols` stays `["http:", "https:", "mailto:"]` for links; mailto is irrelevant for images and will not match image prefixes
3. Replace `ImageAltText` with a defensive `SafeImage`:
   - Only create `<img>` when `src` is an absolute `http:` or `https:` URL (parse via `URL`, same spirit as `safeUrlTransform`)
   - Otherwise render alt text (or null) — never spread unreviewed markdown props
   - Prefer explicit `src` / `alt` / constrained `className` / `referrerPolicy="no-referrer"` only
4. Links unchanged: safe external anchors + `openUrl`; blocked links remain non-links.
5. CSP: extend `img-src` with `http:` and `https:` while keeping existing `'self' asset: http://asset.localhost data:` entries used by the shell.

Defense in depth: harden strips unsafe nodes → SafeImage double-checks → CSP blocks non-http(s) loads that somehow reach the DOM. `no-referrer` reduces Referer leakage to image hosts (does not stop the request itself / tracking pixels).

## Data Flow

```
assistant markdown string
  → Streamdown (sanitize + harden)
  → SafeImage / alt fallback
  → <img src="https://..." referrerpolicy="no-referrer"> (allowed)
  → webview network (CSP img-src http: https:)
```

## UX / Styling

- `className` includes `max-w-full h-auto` (and existing message typography context)
- Allowed images set `referrerPolicy="no-referrer"`
- No click-to-open, lightbox, download control, or custom error UI in MVP
- Broken remote images use the browser broken-image affordance

## Compatibility / Rollback

- Spec text currently requires “images as alt text without an `img`”; update that clause in the same change set
- Tests that assert “no img for tracker URL” must split: HTTPS tracker **does** create `img` (accepted risk); unsafe schemes still must not
- Rollback: revert harden prefixes + SafeImage + CSP `http:`/`https:` + guideline/tests together

## Trade-offs

| Choice | Why |
|--------|-----|
| Harden `allowedImagePrefixes: ["*"]` + SafeImage absolute check | Scheme-only prefixes are invalid in rehype-harden; `*` still limits to http/https, and SafeImage blocks relative/path rewrite |
| Keep CSP `data:` for app assets; still block markdown data images | App may need data URLs; model output should not dump huge data URIs |
| Accept remote tracking pixels | Explicit product decision (D1) for usable model images |
| `referrerPolicy="no-referrer"` on allowed images | Cuts document URL leakage; request still occurs |

## Testing

- Allowed HTTPS (and HTTP) markdown image → `img` with matching `src`/`alt` and `referrerPolicy="no-referrer"`
- Blocked: `data:`, `file:`, `javascript:`, relative, raw HTML `<img>`
- Streaming incomplete image syntax remains readable / non-crashing
- Link safety tests unchanged
- Non-assistant roles still plain text
