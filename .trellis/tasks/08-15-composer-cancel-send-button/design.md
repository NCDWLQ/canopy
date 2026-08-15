# Design: Composer generation actions and contextual recovery

## Scope and boundaries

This is a frontend interaction change. Existing generation, cancellation,
commit, reconciliation, persistence, and Provider profile stores remain the
authority. Components continue to receive narrow capabilities and emit typed
callbacks; they do not inspect IPC or construct generation requests.

Affected ownership:

- `ConversationWorkspace` derives Composer and contextual-action capabilities,
  owns the controlled open state for the existing settings dialog, and wires
  controller callbacks.
- `Composer` owns local draft state, keyboard handling, and a discriminated
  Send/Stop action presentation.
- `ConversationPane` projects per-message contextual actions and transient
  recovery without deriving tree or Provider invariants.
- `MessageNode`/`MessageBubble` render the supplied persistent message action.
- `GlobalSettingsDialog` remains the single settings dialog and gains a
  controlled-open contract so both its sidebar trigger and contextual recovery
  can open the same instance.

No store, IPC, Rust, or database file is in the implementation boundary.

## Composer contract

Separate textarea editability from the current circular action. Prefer a
discriminated action contract rather than related booleans:

```ts
type ComposerAction =
  | { kind: "send"; disabled: boolean }
  | { kind: "cancel"; onCancel: () => void }

type ComposerProps = {
  onSubmit: (content: string) => void | Promise<boolean | void>
  inputDisabled: boolean
  action: ComposerAction
  placeholder?: string
}
```

`Composer` continues to own `content` and `isSubmitting`. Send validates
nonblank content, `inputDisabled`, `action.kind`, action availability, and
submission lock. Cancel is `type="button"`, calls only `onCancel`, and never
passes through form submission. Its availability is not coupled to an empty
draft or send eligibility.

For Enter handling:

1. IME composition returns without interception.
2. Shift+Enter keeps the native newline behavior.
3. Plain Enter always prevents a newline.
4. It calls submit only for an enabled Send action; for Cancel or disabled Send
   it does nothing and preserves the draft.

## Capability derivation

`ConversationWorkspace` derives three separate concepts:

- `canEditDraft`: existing nonblank conversation, ready store, valid path, and
  not archived. This remains true even when the path is not appendable.
- `canAppend`: existing assistant-leaf rule; this alone enables Send.
- `canCancel`: existing controller capability; this selects the Cancel action.

The Composer action mapping is:

| Generation/path state | Textarea | Circular action |
| --- | --- | --- |
| Blank conversation | Existing blank rules | Send |
| Writable assistant leaf | Editable | Send, draft-gated |
| Starting / streaming | Editable | Cancel |
| Committing / reconciling | Editable | Disabled Send |
| Cancelled / failed on user leaf | Editable | Disabled Send |
| Idle unanswered user leaf | Editable | Disabled Send |
| Archived / invalid / loading | Disabled | Disabled Send |

The existing local Composer instance and draft survive these prop transitions.

## Contextual message actions

The workspace supplies a narrow discriminated contextual action for at most the
selected final user message:

```ts
type UserGenerationAction =
  | { kind: "generate"; onSelect: () => void }
  | { kind: "configure-provider"; onSelect: () => void }
```

It exists only when all structural conditions hold: writable conversation,
valid active path, active message is a user leaf with no child, no transient
generation projection, and no locked mutation. Provider readiness chooses the
variant; it does not change structural eligibility.

`ConversationPane` passes the action only to the matching final `MessageNode`.
`MessageNode` renders it in an always-visible footer/action row below the user
message. Generate uses a generation icon and `生成回复`; configuration uses a
settings icon and `配置服务提供商以生成`. Existing hover-only Edit/Branch actions
remain unchanged.

For transient cancellation, reuse the current assistant footer projection:
retain `回复已停止` and add the same always-visible `重新生成` button treatment
already used for failure recovery. Do not assign a durable assistant identity.

## Settings dialog coordination

`ConversationWorkspace` owns `isSettingsOpen`. `GlobalSettingsDialog` accepts a
controlled `open` value and `onOpenChange` callback while retaining its existing
sidebar trigger and reset-on-open/close behavior. The contextual configuration
action calls the same state setter, so there is still one dialog instance and
one Provider form.

Saving uses the existing Provider store. The resulting `ready` phase naturally
reprojects `配置服务提供商以生成` as `生成回复`. No effect watches readiness to call
generation.

## State and data flow

```text
saved unanswered user leaf
  -> provider not ready -> contextual Configure -> open existing dialog
  -> provider ready     -> contextual Generate  -> controller.generate()
  -> starting/streaming -> Composer Cancel       -> controller.cancel()
  -> cancelled          -> assistant Regenerate -> controller.generate()
  -> completed          -> assistant leaf        -> Composer Send enabled
```

All generation calls still resolve their exact target from the authoritative
store/controller at activation time. Composer draft content never enters a
contextual generation callback.

## Compatibility and risks

- Preserve the user's existing uncommitted `Composer.tsx` opacity/blur diff.
- Existing tests that query header Generate must be migrated to the contextual
  action that represents the same eligible state; do not merely delete coverage.
- The largest regression risk is showing both user-leaf Generate and transient
  Regenerate. Structural gating must prove they are mutually exclusive.
- A controlled settings dialog must preserve sidebar-trigger focus restoration,
  secret clearing, and existing mutation locks.
- Archived conversations must not gain an indirect Provider mutation entry
  through contextual actions.

Rollback is frontend-only: restore the old Composer prop contract and header
slot, remove contextual action projection, and return settings dialog ownership
to its internal open state. No persisted data requires migration or repair.

## Follow-up: assistant regeneration actions

Treat transient recovery and durable assistant regeneration as message actions,
not new header or Composer states. Failed/cancelled transient responses keep the
footer status row and always-visible recovery affordance, but the control uses
the established message-action button contract: `variant="ghost"`,
`size="icon"`, `size-7`, muted/foreground colors, a `size-3.5` refresh icon,
plus `title` and `aria-label="重新生成"`.

For durable history, `ConversationPane` supplies an assistant regeneration
action only to the final message when that message is the eligible active
assistant. `MessageNode` renders it inside the existing `actions` slot beside
Edit/Create Branch, so it inherits the same hover/focus disclosure instead of
creating a second footer treatment.

The workspace derives eligibility from the writable valid active path,
Provider readiness, absence of transient generation, and an active assistant
with an authoritative user parent. The callback selects that exact parent user
through the controller and immediately invokes the existing generation intent;
generation then creates a sibling assistant while preserving the old response
and Composer draft. No store, IPC, or persistence contract changes are needed.
