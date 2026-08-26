# Implement: Assistant Markdown Images

## Checklist

1. [x] Update `AssistantMarkdown.tsx`
   - Harden: `allowedImagePrefixes: ["*"]` (rehype-harden scheme-only prefixes like `http://` do not parse; `*` still limits to http/https), keep `imageBlockPolicy: "text-only"`, do not enable `allowDataImages`
   - Replace `ImageAltText` with `SafeImage` (absolute http/https only; alt fallback; `max-w-full h-auto`; `referrerPolicy="no-referrer"`)
   - Do not spread unreviewed img props
2. [x] Update CSP in `src-tauri/tauri.conf.json`
   - Add `http:` and `https:` to `img-src`
3. [x] Update `AssistantMarkdown.test.tsx`
   - Assert allowed remote images render `<img>` with `referrerpolicy="no-referrer"`
   - Assert unsafe schemes / raw HTML still blocked
   - Split former “no image elements” case accordingly
4. [x] Update `.trellis/spec/frontend/component-guidelines.md`
   - Document allowlisted remote images + blocked schemes + CSP dependency + `no-referrer`
5. [x] Run validation commands below

## Validation

```bash
pnpm exec prettier --check src/features/conversations/components/AssistantMarkdown.tsx src/features/conversations/components/AssistantMarkdown.test.tsx
pnpm exec eslint src/features/conversations/components/AssistantMarkdown.tsx src/features/conversations/components/AssistantMarkdown.test.tsx
pnpm exec tsc --noEmit
pnpm test -- src/features/conversations/components/AssistantMarkdown.test.tsx
```

Optional smoke (manual): run app, send/fixture an assistant message with `![x](https://...)` and confirm the image loads under Tauri CSP.

## Risky files / rollback

- `AssistantMarkdown.tsx` — trust boundary
- `tauri.conf.json` — CSP widening
- `component-guidelines.md` — documented security contract

Rollback = revert the four areas in one commit if regressions appear.

## Before `task.py start`

- [x] `prd.md` converged
- [x] `design.md` written
- [x] `implement.md` written
- [x] `implement.jsonl` / `check.jsonl` curated
- [ ] User approves final planning summary
