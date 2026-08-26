# Research: Image allowlist + Tauri CSP

## rehype-harden (1.1.8 via streamdown 2.4.0)

API (`rehype-harden` types):

- `allowedImagePrefixes?: string[]`
- `allowDataImages?: boolean`
- `imageBlockPolicy?: "indicator" | "text-only" | "remove"`
- `allowedProtocols?: string[]`

Canopy currently passes `allowedImagePrefixes: []` and `imageBlockPolicy: "text-only"`.

Planned: harden `allowedImagePrefixes: ["*"]` (scheme-only `http://`/`https://`
prefixes do not parse in rehype-harden 1.1.8); SafeImage enforces absolute
http/https only; leave `allowDataImages` false.

## Tauri CSP

Current `img-src` in `src-tauri/tauri.conf.json`:

```
img-src 'self' asset: http://asset.localhost data:
```

Without adding `http:` / `https:`, remote markdown images will be blocked by the webview even if React creates `<img src="https://...">`.

## Referrer

Allowed `<img>` elements must set `referrerPolicy="no-referrer"` so the webview does not send the document URL as `Referer` to the image host. This is per-element HTML policy; it does not remove the network request itself.

## Spec impact

`.trellis/spec/frontend/component-guidelines.md` currently requires images as alt text without an `img` or network request. That clause must be rewritten in the same change set as the code, including the `no-referrer` requirement.
