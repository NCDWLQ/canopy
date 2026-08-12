# Design: Simplified Chinese Interface

## Summary

Convert the existing application to a single Simplified Chinese locale by replacing product copy at its current ownership boundaries. Do not introduce a general i18n layer because the approved product scope has one locale and the repository has no locale runtime today.

## Boundaries and ownership

### Document and shared primitives

- Set `index.html` to `lang="zh-CN"`.
- Translate only the user-facing defaults in shared dialog/spinner primitives. Preserve primitive behavior, props, Radix focus handling and component structure.

### Feature components

- Conversation and provider components continue to own their product copy.
- Translate visible text, placeholders, titles, tooltips, live-region labels and screen-reader-only text in place.
- Add a small exhaustive role-to-label presentation mapping next to `MessageBubble`; keep the canonical role union and IPC values unchanged.
- Do not add a cross-feature translation catalog or locale context.

### Error boundary

The existing data flow remains unchanged:

```text
Rust source error -> CommandError -> validated TypeScript error -> store/controller -> component
```

- Translate centralized, safe runtime messages in `src-tauri/src/error.rs` so real command failures arrive in Chinese without changing `code`, `retryable`, `details` or serialization shape.
- Translate frontend-created invalid-input/internal/tree/reconciliation errors and generation availability reasons at their existing owners.
- Keep error control flow based on `code` and `retryable`. Do not add message matching.
- Change the conversation-pane heading from an English label plus raw machine code to a Chinese user heading plus the already-safe message. Machine codes remain available in state and tests.
- Preserve redaction: translated messages must remain concise and contain no prompts, secrets, provider bodies, database paths or source errors.

## Copy conventions

- `research/copy-catalog.md` is the source of truth for approved English-to-Chinese product copy.
- Use concise Simplified Chinese suitable for desktop controls.
- Prefer consistent terms: 会话、历史记录、会话树、回复、生成、归档、分支、设置、服务提供商、模型、API 密钥。
- Keep `Canopy`, `OpenAI`, `API`, URL examples and model identifiers as technical content.
- Never translate user-authored text or model output.

## Compatibility

- No database migration, stored-data rewrite, dependency change or application setting is needed.
- No IPC field, command name, enum, error code or request/response schema changes.
- Existing saved conversations remain readable because only presentation strings change.
- Tests that deliberately use arbitrary English fixture messages may keep them when they validate transport preservation rather than production copy.

## Testing strategy

- Update component/integration queries to Chinese accessible names and retain behavioral assertions.
- Update frontend-local error expectations and Rust runtime-error serialization expectations.
- Keep all branch/path isolation, secret redaction and generation lifecycle assertions intact.
- Run a targeted English literal audit after implementation and classify remaining matches using `research/ui-copy-audit.md`.
- Run all repository frontend gates plus Rust format and test gates.

## Risks and mitigations

- **Missed nonvisual copy:** audit `aria-label`, `title`, placeholders, live regions and primitive defaults, not only JSX text.
- **Error-contract drift:** change message values only; regression tests must prove codes, retryability, details and shapes remain stable.
- **Over-translation:** preserve technical values and all user/model content; translate only labels surrounding them.
- **Layout regressions:** use existing responsive components and inspect controls whose Chinese labels are longer.

## Rollback

The change is presentation-only and can be rolled back as one commit. No persisted data or schema rollback is required.
