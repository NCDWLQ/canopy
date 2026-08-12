# UI Copy Audit

## Current architecture

- The app is a small, single-locale React/Vite/Tauri desktop application.
- No i18n package, locale state, translation catalog, or language switch exists.
- `index.html:2` declares English document language.

## User-facing surfaces

| Surface | Evidence | Required treatment |
|---|---|---|
| Workspace shell and history | `src/features/conversations/components/ConversationWorkspace.tsx:181` | Translate visible copy, tooltips, loading/empty states, archive/generation actions, retry and composer reasons. |
| Message composer | `src/features/conversations/components/Composer.tsx:14` | Translate default placeholder, label and send action. |
| Conversation pane | `src/features/conversations/components/ConversationPane.tsx:143` | Translate loading, error heading, retry, empty state and saving label; do not show the machine error code. |
| Conversation outline | `src/features/conversations/components/OutlineTree.tsx:174` | Translate tree label, expansion controls, no-replies state, integrity fallback and empty preview. |
| Message branch/edit UI | `src/features/conversations/components/MessageNode.tsx:55` | Translate actions, editor labels, placeholders and buttons. |
| Message role header | `src/features/conversations/components/MessageBubble.tsx:19` | Map stable role enum values to Chinese presentation labels without changing the enum or data. |
| Global settings | `src/features/providers/components/GlobalSettingsDialog.tsx:100` | Translate settings/provider copy, status alerts, fields, API-key help, save/delete actions and confirmation. |
| Shared primitive defaults | `src/components/ui/dialog.tsx:55`, `src/components/ui/spinner.tsx:4` | Translate default close and loading accessible copy used by product surfaces. |

## Error and availability flow

```text
source failure
  -> Rust domain/provider error
  -> src-tauri/src/error.rs CommandError with safe user message
  -> src/lib/tauri Zod validation and ConversationCommandError
  -> feature store/controller normalization
  -> React component display
```

- Runtime Rust summaries are currently English in `src-tauri/src/error.rs:31`.
- Frontend-local error summaries are currently English in:
  - `src/lib/tauri/client.ts:243`
  - `src/lib/tauri/provider-client.ts:377`
  - `src/features/conversations/store/index.ts:156`
  - `src/features/conversations/hooks/useWorkspaceGenerationController.ts:19`
  - `src/features/providers/store/index.ts:26`
- Generation availability reasons are currently English in `src/features/conversations/hooks/useWorkspaceGenerationController.ts:340`.
- The frozen machine contract is `code` + `retryable` + optional `details`; localization changes only safe presentation messages.
- Shared IPC fixture messages may intentionally contain arbitrary test strings to prove message preservation. They are not automatically product copy, but production fixture samples and exact runtime-message assertions must be updated when they represent actual Rust output.

## Allowed English/Latin content

- Brand and protocol names: `Canopy`, `OpenAI`.
- Technical abbreviations and identifiers: `API`, URL values, model IDs, HTML/TypeScript/Rust identifiers.
- User-authored conversation titles/messages and provider/model output.
- Internal test descriptions, source identifiers, enum values, command names and machine error codes when not rendered.

## Verification targets

- Accessible behavior tests for shell, composer, pane, tree, message actions and settings use Chinese names.
- Error contract tests prove the same codes/retryability/details with Chinese runtime summaries.
- Targeted English-literal search is manually classified against the allowed list.
- Full frontend and Rust quality gates pass.
