# Component Guidelines

> Initial component contracts for Canopy's tree-native conversation UI.

---

## Overview

Canopy uses React, TypeScript, shadcn/ui, Radix UI, and Tailwind CSS. Components render domain view models and emit user intent. They never read SQLite, call raw Tauri `invoke`, construct provider payloads, or calculate durable tree invariants.

The repository is greenfield. These rules are the approved starting contract and must be revised when implementation evidence establishes a different pattern.

## Scenario: shadcn Foundation Configuration

### 1. Scope / Trigger

Use this contract when initializing shadcn or adding generated primitives. It
keeps generator output compatible with the existing Vite/Tailwind foundation
without turning a generic primitive task into product UI work.

### 2. Signatures

`components.json` uses `style: "radix-nova"`, `baseColor: "neutral"`, CSS
variables, Lucide icons, the `@/*` aliases rooted at `src/`, and the ReUI
registry `@reui` → `https://reui.io/r/{style}/{name}.json`.

### 3. Contracts

- Both the root and application TypeScript configs expose `@/* -> ./src/*`
  before shadcn initialization; the Vite alias alone is insufficient for the
  CLI's validation.
- Tailwind 4 is loaded through `@tailwindcss/vite`, with
  `src/index.css` as the single global stylesheet.
- Use the repository-pinned CLI (`pnpm exec shadcn ...`) for shadcn commands
  and inspect generated files before accepting them. Do not substitute
  `pnpm dlx shadcn@latest` in validation or use overwrite flags: an unpinned
  temporary dependency graph can fail independently of the locked project.
- Generated primitives remain generic under `src/components/ui`; feature UI
  remains separately owned under `src/features`.
- Extra primitives come from ReUI: `pnpm exec shadcn add @reui/<item>`.
  Inspect diffs and decline overwrites of authored `label` / `field` / similar
  files. Do not keep unused `src/components/examples/` copies of ReUI demos.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| TypeScript alias is missing | Add the matching alias before rerunning initialization |
| Generator wants to overwrite an authored file | Stop and reconcile the diff manually |
| Preset/base/color differs | Reject or explicitly redesign the shared theme |
| Generated component contains product state or IPC | Move that behavior to the owning feature layer |

### 5. Good / Base / Bad Cases

- **Good**: shadcn reports Vite, Tailwind 4, Nova, Radix, Neutral, and the
  expected aliases; generated primitives pass lint and type-check unchanged.
- **Base**: `Button` and `cn()` prove the registry boundary without appearing
  in a product conversation screen.
- **Bad**: running a root generator with overwrite enabled changes Trellis or
  application files outside the inspected component set.

### 6. Tests Required

- Inspect shadcn project info after initialization or configuration changes.
- Run formatting, warning-free lint, strict TypeScript checking, component
  tests, and the production Vite build.
- Review generated imports and dependencies; confirm no raw Tauri, SQL, or
  provider behavior entered `components/ui`.

### 7. Wrong vs Correct

#### Wrong

```ts
// vite.config.ts only; shadcn initialization cannot validate the project alias
resolve: { alias: { "@": path.resolve("./src") } }
```

#### Correct

```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Keep the matching Vite alias as well; the generator and the bundler validate
different configuration surfaces.

## Ownership and Structure

```text
src/
  app/                              # providers, routing, shell composition
  components/ui/                    # generated or lightly wrapped shadcn primitives
  features/conversations/
    components/                     # OutlineTree, ConversationPane, MessageNode, Composer
    actions/                        # branch/edit/select orchestration
    store/                          # Zustand normalized tree and active selection
    types/                          # frontend projections and component contracts
  features/settings/components/     # SettingsDialog shell and global preference panels
  features/providers/components/   # provider list/editor panels and model selection
  lib/tauri/                        # typed invoke bridge and error normalization
```

- Keep shadcn/Radix primitives generic in `components/ui`.
- Keep product language and tree behavior in feature components.
- Keep Zustand selectors/actions outside component files.
- The developer-managed frontend agent owns component directories, their
  styles, component-local view-model fixtures, and component tests only. The
  main integration session owns shared types, IPC contract fixtures, stores,
  actions, the Tauri bridge, and application wiring.

## Scenario: Tree Conversation UI Boundary

### 1. Scope / Trigger

Use this contract whenever a component renders the conversation outline, the active root-to-node path, branch/edit actions, the composer, or provider settings. It prevents the UI from inventing a second tree model or leaking persistence/IPC details into view code.

### 2. Signatures

```ts
type NodeId = string;

type ConversationView = {
  id: string;
  title: string;
  rootNodeId: NodeId;
  isArchived: boolean;
};

type TreeNodeView = {
  id: NodeId;
  role: "system" | "user" | "assistant" | "tool";
  preview: string;
  childIds: readonly NodeId[];
};

type PathMessageView = {
  id: NodeId;
  role: TreeNodeView["role"];
  content: string;
  model?: string;
};

type UiErrorCode =
  | "invalid_input"
  | "not_found"
  | "tree_integrity"
  | "database_unavailable"
  | "migration_failure"
  | "provider_authentication"
  | "rate_limited"
  | "provider_unavailable"
  | "network_failure"
  | "cancelled"
  | "internal";

type UiError = {
  code: UiErrorCode;
  message: string;
  retryable: boolean;
};

type OutlineTreeProps = {
  rootNodeId: NodeId;
  activeNodeId: NodeId;
  nodesById: Readonly<Record<NodeId, TreeNodeView>>;
  expandedIds: ReadonlySet<NodeId>;
  onToggle: (nodeId: NodeId) => void;
  onSelect: (nodeId: NodeId) => void;
};

type ConversationPaneProps = {
  path: readonly PathMessageView[]; // already ordered root -> active
  status: "idle" | "loading" | "streaming" | "error";
  error?: UiError;
  onRetry: () => void;
};

type MessageNodeProps = {
  message: PathMessageView;
  canBranch: boolean;
  canEdit: boolean;
  onCreateBranch: (nodeId: NodeId) => void;
  onEditAsBranch: (nodeId: NodeId) => void;
  generationAction?: UserGenerationAction;
};

type UserGenerationAction =
  | { kind: "generate"; onSelect: () => void }
  | { kind: "configure-provider"; onSelect: () => void };

type AssistantRegenerationAction = {
  assistantNodeId: NodeId;
  onSelect: (assistantNodeId: NodeId) => void;
};

type ComposerAction =
  | { kind: "send"; disabled: boolean }
  | { kind: "cancel"; onCancel: () => void };

type ComposerHandle = {
  focus: () => void;
};

type ComposerProps = {
  onSubmit: (content: string) => void | Promise<boolean | void>;
  inputDisabled: boolean;
  action: ComposerAction;
  placeholder?: string;
};
```

These view-model and error types are the canonical shared TypeScript contract
owned by the main integration session. The frontend component agent imports
them and may create component-local values that satisfy them; it must not copy
or redefine the types or the IPC fixture payloads in component directories.

Provider forms follow the same pattern: controlled, secret-masked fields emit a
typed store action and never call raw Tauri transport. Existing blank key input
means `keep`, explicit removal means `remove`, and nonblank input means
`replace`; a new keyless profile uses `remove`. Clear the key on close and
after every save attempt, including failure.

### 3. Contracts

- `OutlineTree` receives one normalized tree projection. It may derive visible rows for expansion but must not load or persist nodes.
- `ConversationPane.path` is authoritative and already validated by the application layer. It must not append siblings or reconstruct ancestry.
- A transient assistant is projected after the durable path through the same
  feature-local, identity-free message shell as a durable assistant. Keep it
  out of the outline and never assign it a durable node identity before the
  authoritative terminal result. Do not label it as transient/not saved or
  expose database implementation terms.
- `starting` renders “正在思考”; `streaming` appends content in that assistant
  slot. A valid completed terminal result swaps the transient shell for the
  authoritative assistant without duplicating content.
- Generation failure shows “回复失败” plus “重新生成” without retaining partial
  output. Persistence failure retains the complete content and shows
  “这条回复未能保存” plus “重新生成”. Cancellation retains received partial
  content and shows “回复已停止” plus an always-visible “重新生成”. An
  ambiguous invoke failure may trigger one silent authoritative reload; expose
  only the normal safe failure when that reload cannot prove completion.
- The Composer circular action is `send` when no cancellable run is active and
  `cancel` only during `starting` or `streaming`. Draft editability is controlled
  independently through `inputDisabled`: a valid writable conversation keeps
  the textarea editable while Send is unavailable or generation is active. No
  post-terminal recovery phase is rendered; any ambiguous invoke failure is
  handled by the controller's one-shot reload.
- Plain Enter submits only an enabled Send action. When Send is disabled or the
  action is Cancel, prevent the newline but do not submit, cancel, or clear the
  draft. Shift+Enter remains a newline and IME composition remains guarded.
- A writable selected user leaf with no child and no transient response owns an
  always-visible contextual action below that message: `生成回复` when Provider
  state is ready, otherwise `配置服务提供商以生成`. Provider setup opens the
  existing global settings dialog but never auto-starts generation after save.
  Answered users, assistant leaves, archived conversations, and transient
  responses do not expose this action.
- A durable assistant regeneration action is a single
  `AssistantRegenerationAction` object, never a boolean plus optional callback.
  The workspace derives it only for the final assistant in the valid active
  path with a ready Provider, writable conversation, and authoritative user
  parent. The pane routes it only to that final message; the node renders it in
  the existing Edit/Create Branch action bar. Its callback revalidates current
  state, selects the exact parent user, and starts one sibling generation while
  preserving the old assistant and Composer draft.
- `MessageNode` displays capabilities supplied through `canBranch` / `canEdit`; it must not infer authorization from raw roles beyond visual presentation.
- Branch and edit callbacks emit the source node ID. Editing is labeled as creating a branch and never mutates displayed history optimistically.
- Starting a branch from an assistant is workspace-owned intent, not a
  `MessageNode` editing mode: keep the current path rendered, preserve the
  Composer draft, focus the Composer through `ComposerHandle`, and route the
  next enabled Send to `createBranch` with that assistant ID. Clear the intent
  after authoritative success or when leaving the conversation/entering a
  blank draft; creation failure preserves both intent and draft for retry.
- Unknown IPC payloads are decoded in `lib/tauri`, before they reach feature components.

### 4. Validation & Error Matrix

| Condition | Component behavior |
|---|---|
| Tree is loading | Render a stable-size skeleton; do not show a fake root |
| Blank conversation draft | Render the existing enabled Composer without title/prompt form fields; do not fabricate or persist a root before send |
| Root or active node is absent | Render the supplied integrity error/recovery action; do not choose another node |
| Active path is empty for an existing conversation | Render an error/empty boundary supplied by the container |
| The conversation is archived | Keep history readable and disable all mutation capabilities |
| Branch/edit capability is false | Hide or disable the action consistently and prevent keyboard activation |
| Eligible assistant branch action is clicked | Keep the visible path unchanged, preserve and focus the Composer draft, and enable Send for branch creation |
| Branch creation fails | Preserve the Composer draft and branch target so the user can retry |
| Conversation changes before branch submit | Clear the stale branch target without clearing the Composer draft |
| Status is `error` | Show the safe error message; offer retry only when `retryable` is true |
| User cancels streaming | Preserve received partial content and show “回复已停止” without an error toast |
| Generation is `starting` or `streaming` | Show one enabled Composer `取消生成`; only clicking it invokes exact cancellation |
| Generation has reached a terminal result | Keep the draft editable, hide Cancel, and expose only terminal copy |
| Enter while Send is unavailable or Cancel is shown | Preserve the draft and perform no submit/cancel/newline action |
| Writable unanswered user leaf, Provider ready | Show always-visible `生成回复` beneath that user message |
| Writable unanswered user leaf, Provider not ready | Show `配置服务提供商以生成`; open Settings and require a later explicit Generate click |
| Final durable assistant, Provider ready, no active/recovery run | Show icon-only `重新生成` in the existing hover/focus action bar |
| Earlier assistant, user leaf, archived/invalid/loading, Provider not ready, or active/recovery run | Do not show durable assistant `重新生成` |
| Generation fails | Discard partial output; show “回复失败” and “重新生成” |
| Persistence explicitly fails | Preserve complete output; show “这条回复未能保存” and “重新生成” |
| Invoke result is uncertain | Keep the existing projection while the controller performs one silent reload; then show safe terminal copy if no result is proven |

### 5. Good / Base / Bad Cases

- **Good**: a branched fixture shows the active node and ancestors, sibling indicators in the outline, and only the active path in the message pane.
- **Base**: a blank draft renders an empty Composer and no durable root; the first successful send installs the authoritative user root.
- **Bad**: missing active-node data never falls back to rendering all conversation messages.

### 6. Tests Required

- `OutlineTree`: selecting, expanding, collapsing, roving focus, arrow-key navigation, and active-node semantics.
- `ConversationPane`: exact root-to-active order and an explicit assertion that sibling content is absent.
- `MessageNode`: branch/edit callbacks receive the source ID once; branch intent
  does not replace message content with a local textbox; disabled actions
  cannot fire.
- Loading, empty, provider-auth, retryable, non-retryable, streaming, and cancellation states.
- Generation presentation covers starting, streaming, phase-derived failure
  kinds, retained cancellation content, authoritative terminal replacement,
  exact copy, and absence of engineering copy.
- Composer tests cover the Send/Cancel union, exact cancel click count, draft
  preservation across action transitions, disabled plain Enter, Shift+Enter,
  IME composition, and terminal-state draft behavior.
- Workspace branch/Composer tests cover unchanged downstream visibility on
  click, focus and pre-existing draft preservation, exact assistant-parent
  submission, successful return to append behavior, failure retry, and stale
  intent clearing across conversation switches.
- Contextual generation tests cover Provider-ready and not-ready unanswered
  user leaves, controlled Settings opening, readiness after save without
  automatic generation, and absence for answered/assistant/archived/transient
  states.
- Durable assistant regeneration tests cover exact final-message routing,
  shared icon-button class/accessibility contracts, click-time state
  revalidation, exact parent-user targeting, sibling generation, old-node and
  draft preservation, and ineligible-state absence.
- A successful streaming-to-authoritative transition uses the same assistant
  article structure and list position without duplicate transient/durable
  content in one render.
- Blank-draft entry from empty, loaded, and all-archived history; first-send
  title derivation; complete prompt preservation; failure retry; and history
  selection exiting blank mode without clearing the preserved store projection.
- History titles remain single-line and width-truncated, with the complete title
  exposed through a Radix tooltip on both pointer hover and keyboard focus.
- Provider forms: labels, secret masking, keyboard submission, and no raw secret in rendered errors.

### 7. Wrong vs Correct

#### Wrong

```tsx
function OutlineTree() {
  const rows = await invoke("select", { sql: "SELECT * FROM nodes" });
  return rows.map(renderNode);
}
```

#### Correct

```tsx
function OutlineTree({ nodesById, rootNodeId, onSelect }: OutlineTreeProps) {
  return <TreeRows nodesById={nodesById} rootNodeId={rootNodeId} onSelect={onSelect} />;
}
```

The correct form is deterministic, fixture-driven, and independent of SQLite and Tauri.

## Props and Composition

- Define named props types; avoid inline object types on exported components.
- Prefer controlled state and explicit callbacks at feature boundaries.
- Use composition for reusable chrome (`asChild`, slots, trigger/content pairs) and keep domain behavior in the owning feature.
- Do not pass database rows or broad Zustand stores through props. Export narrow selectors and view models.
- Use discriminated unions instead of boolean combinations that represent impossible states.

## Styling and Accessibility

- Use Tailwind tokens and CSS variables from the shared theme; do not hard-code one-off hex colors in feature components.
- Preserve shadcn primitives as upgradeable building blocks; wrap them instead of editing generated internals for domain behavior.
- Boolean settings use the official shadcn `Switch`, not a homemade
  `role="switch"` button.
- Closed-choice settings (protocol, title model, grouped lists) use shadcn
  `Select` with `SelectGroup` / `SelectLabel` / `SelectSeparator` as needed.
  Do not fake a select with `DropdownMenu` + checkmarks.
- `FieldDescription` helptext has no trailing period (or `。`).
- The outline uses tree/treeitem semantics or an equivalent tested Radix pattern, visible focus, correct expanded/selected state, and roving keyboard focus.
- Every icon-only action has an accessible name. Menus, dialogs, and tooltips use Radix focus management.
- Canopy ships two UI locales (`zh-CN`, `en`) through the typed dictionary in
  `src/lib/i18n` (see [i18n Guidelines](./i18n-guidelines.md)). Components
  never hard-code user-visible copy: text, placeholders, tooltips, live
  regions, and accessible names come from `t()` / `useTranslation()`;
  `App.tsx` keeps `document.documentElement.lang` in sync with the active
  locale.
- Preserve brand and technical values such as `Canopy`, `OpenAI`, `API`, URLs,
  and model identifiers. Never translate user-authored conversation content or
  provider/model output.
- Do not rely on color alone for active paths, roles, errors, or conversation archive state.
- Respect reduced motion and keep the interface usable at desktop webview zoom levels.

Role enums remain stable domain values and are mapped only for presentation:

```tsx
// MessageBubble builds labels from the i18n dictionary at render time.
const ROLE_LABEL_KEYS: Record<PathMessageView["role"], StaticMessageKey> = {
  system: "conversation.roles.system",
  user: "conversation.roles.user",
  assistant: "conversation.roles.assistant",
  tool: "conversation.roles.tool",
}
const { t } = useTranslation()
// t(ROLE_LABEL_KEYS[role]) → 系统 / System
```

Tests query the Chinese accessible name (the test setup pins the locale store
to `zh-CN`) while contract and state tests continue to assert the original
enum value.

### Design Decision: Assistant Markdown Rendering Boundary

**Context**: Assistant content is untrusted provider output and appears through
both durable path nodes and an identity-free transient generation slot. If each
surface configures Markdown independently, syntax, streaming, security, and
controls drift. User, system, and tool messages must continue to display their
original text rather than unexpectedly interpreting Markdown markers.

**Decision**: Render non-editing assistant content through one feature-owned
`AssistantMarkdown` component. Durable content uses static mode; only the live
`streaming` generation phase uses streaming mode. The wrapper owns the renderer,
GFM/code plugins, Chinese controls, semantic styling, and the complete trust
boundary. `MessageNode` and transient generation presentation pass only the raw
content string and streaming state; they do not duplicate renderer options.

```tsx
type AssistantMarkdownProps = {
  content: string
  isStreaming?: boolean
}

return message.role === "assistant" ? (
  <AssistantMarkdown content={message.content} />
) : (
  <div className="whitespace-pre-wrap break-words">{message.content}</div>
)
```

The wrapper must:

- omit raw-HTML parsing and never use `dangerouslySetInnerHTML`;
- keep sanitization and URL hardening enabled, with an absolute-URL transform
  restricted to `http:`, `https:`, and `mailto:`;
- render blocked links as readable non-links and images as alt text without an
  `img` element or network request;
- add `target="_blank"` plus `rel="noopener noreferrer"` to allowed links;
- enable code copy but disable it while streaming, and omit code download and
  table export controls;
- keep long code/table content horizontally scrollable within the message and
  use semantic theme/focus tokens rather than raw colors;
- preserve CommonMark soft-break behavior instead of converting every newline
  into `<br>`.

Canopy pins `streamdown` exactly to `2.4.0`: version `2.5.0` directly declares
Mermaid even when the Mermaid plugin is not selected. Any renderer upgrade must
inspect the resolved dependency graph and production Vite bundle before changing
that pin. Asset names or Shiki grammars containing `mermaid` do not prove that
the Mermaid runtime is installed; check the lockfile/package graph.

Required tests assert GFM semantics, incomplete streamed emphasis/link/code,
code-copy disabled state, safe and unsafe URL protocols, raw-HTML/image
blocking, Chinese accessible controls, all three non-assistant roles remaining
plain text, and transient-to-durable rendering without duplicate content.

### Design Decision: Workspace-Global Settings Entry

**Context**: Provider configuration applies to the workspace, not to the
selected conversation. A conversation-header action therefore gives global
configuration the wrong ownership and competes with conversation-scoped
actions.

**Decision**: Expose workspace-global Settings through one persistent footer
action in the expanded conversation sidebar. Import `SettingsDialog` from
`features/settings/components`; the shell owns dialog chrome, category
navigation, and open/reset behavior. Compose provider editing through
`ProviderSettingsPanel` (`features/providers/components`) and global
conversation preferences through `ConversationSettingsPanel`
(`features/settings/components`). UI dependency direction is
`conversations → settings → providers`; `features/settings` must not import
from `features/conversations`, and cross-feature error/JSON helper types must
live in `lib/tauri` rather than a feature-owned `types/` module so providers
do not depend back on conversations. Keep one dialog instance and allow the owning
workspace to control its `open` / `onOpenChange` state so the contextual
`配置服务提供商以生成` action can open the same surface. Provider state, secret
handling, and typed client calls remain in the Provider feature/store.
Low-frequency sidebar footer actions use the flat `ghost` treatment with muted
default text and foreground hover emphasis so they remain subordinate to
history and tree navigation.

```tsx
<footer>
  <DialogTrigger asChild>
    <Button
      variant="ghost"
      className="w-full justify-start text-muted-foreground hover:text-foreground"
    >
      Settings
    </Button>
  </DialogTrigger>
</footer>
```

Do not duplicate the Provider trigger in the conversation header. The
message-scoped configuration action is an alternate opener for the same dialog,
not another settings surface. Saving Provider configuration must update the
contextual action to `生成回复` without starting a billable generation. Tests
must assert that Settings has one accessible persistent trigger in the sidebar
footer, both entry points open the titled dialog, controlled close is emitted,
focus is restored when closed, and the footer remains usable after the sidebar
is collapsed and reopened. Provider tests continue to cover keyboard submit,
secret clearing, save/delete, errors, read-only state, and generation/loading
locks through the global settings surface.

### Design Decision: New Conversation Affordance & Sidebar Toolbarization

**Context**: Starting a new conversation is the primary top-level user action.
When the sidebar is collapsed, users need direct access to start a new chat
without first expanding the sidebar. Within the sidebar, "新建会话" is a global
action rather than an item belonging strictly to the history list.

**Decision**:
1. **Sidebar Header Toolbar**: The top `h-12` bar of `<aside>` is dedicated to
   workspace branding (`Canopy`) and the primary `新建会话` icon button (`size="icon" className="size-8"` with Tooltip).
2. **Symmetrical Section Headers**: `历史记录` and `会话树` each have their
   own distinct, matching subheaders (`h-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3`).
3. **Collapsed Sidebar Quick Entry**: When `!isSidebarOpen`, the main window
   `<header>` renders an identical icon-only `新建会话` button (`size="icon" className="size-8"`)
   next to the sidebar expand toggle (`PanelLeftOpen`), complete with tooltip and `aria-label="新建会话"`.
   When the sidebar is open, this duplicate icon in the main header is hidden.
4. **State & Form Consistency**: Both entry points use the exact same icon-only
   affordance, trigger `store.enterConversationCreation`, and share disabled states
   during loading or active generation.

## Common Mistakes

- Rendering the entire conversation instead of the supplied active path.
- Treating a branch as a copied conversation in component state.
- Calling raw `invoke` from a component because it appears to be a small query.
- Mutating a historical message locally before the branch command succeeds.
- Letting a separately assigned UI agent redefine shared DTOs to fit a component.
- Testing only that ancestors appear without asserting that sibling content is absent.
- Rendering transient output as a warning/status card or exposing `Not saved`,
  commit, local-storage, or database vocabulary in the successful path.
- Wrapping assistant messages inside card borders or adding redundant visible role headers ("用户"/"助手") instead of accessible `aria-label` attributes.
- Rebuilding `Switch` or `Select` (including DropdownMenu-as-select) instead of
  the shadcn primitive.
- Leaving unused ReUI example files under `src/components/examples/`.
- Putting a period at the end of `FieldDescription` helptext.

## Scenario: Conversation Message Rendering (Bubble vs. Direct Output)

### 1. Scope / Trigger
Use when implementing or styling conversation message displays (`MessageBubble`, `MessageNode`, `ConversationPane`).

### 2. Design Patterns
- **User Messages**: Rendered as right-aligned message bubbles (`ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-foreground`). No visible "用户" header text. Accessible name preserved via `aria-label="用户消息"`.
- **Assistant Messages**: Rendered directly on the background full-width (`w-full bg-transparent border-0 text-foreground`) without card boundaries or box wrappers, similar to modern conversational AI interfaces (ChatGPT/Claude). No visible "助手" header text. Accessible name preserved via `aria-label="助手消息"`.
- **Actions**: Branching and editing action buttons are placed in subtle action
  bars below messages with hover/focus disclosure
  (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity`).
  Generation and recovery actions are different: `生成回复`,
  `配置服务提供商以生成`, and cancelled/failed `重新生成` remain visible below
  the exact message they affect so the recovery path does not depend on hover.
  A durable final-assistant `重新生成` belongs beside Edit/Create Branch in the
  existing hover/focus action bar, using the same icon-only button classes and
  accessibility contract. It must not be a second footer or header action.
  The workspace header contains no Generate or Cancel slot; active cancellation
  belongs to the Composer's circular action.

## Design Decision: Mind-map Canvas View

**Context**: The conversation tree also renders as a mind-map style canvas
(`MindMapCanvas`, React Flow v12 + `d3-hierarchy` tidy tree, left-to-right).
React Flow was chosen because nodes are real React components (shadcn/Tailwind
styling reuse) and pan/zoom/minimap/fit-view ship built-in on DOM/SVG — no
WebGL dependency on WebKitGTK.

**Decision**:

- `MindMapCanvas` is fully controlled: `rootNodeId`, `nodesById`,
  `activePathIds`, `onSelect` props only, no store access inside. The
  root-to-active chain stays owned by the store's `selectActivePath`; the
  workspace maps its path to `activePathIds`. Never re-derive the active
  path in the canvas.
- Clicking a canvas node means activating the whole branch through it:
  the workspace wires `onSelect` to the store action
  `selectBranchAtNode(nodeId)`, which targets the subtree's newest leaf
  (`newestLeafDescendant`, same semantics as `revealSearchHit`) and sets a
  queryless `reveal` so the message pane scrolls to the clicked node
  without highlighting. Plain `selectNode` truncates the path at the
  clicked node and is wrong for the mind-map. The canvas then fits the
  updated path via `useReactFlow().fitView` (queued by React Flow until
  the next node adopt; camera效果 only verifiable in a real browser, not
  jsdom).
- Layout lives in the pure module `features/conversations/mindmapLayout.ts`
  (defensive validation mirroring `projectVisibleRows`: null on missing
  nodes, parent mismatch, or cycle; component renders the
  `errors.unsafeTreeProjection` alert). Collapse state is component-local
  and scoped to the current root via derived state, not an effect reset.
- Flow nodes declare explicit `width`/`height` matching the fixed card
  metrics exported from the layout module.
- Flow nodes also declare `handles` (`MINDMAP_NODE_HANDLES`: target left,
  source right, card-local coordinates). React Flow **silently drops every
  edge** whose endpoint nodes lack handle bounds (`isNodeInitialized` fails
  before the error-008 path is even reached) — nodes render fine while all
  edges vanish. Declarative handles avoid DOM measurement, so edges exist on
  first paint and in jsdom; do not rely on `<Handle>` components inside the
  card for this view.
- Declared handles alone are NOT enough in a real browser: once the node
  ResizeObserver completes measurement, `updateNodeInternals` overwrites
  handleBounds from a `querySelectorAll('.source'/'.target')` DOM scan —
  with no Handle elements that scan yields `{source: null, target: null}`
  and every edge silently vanishes until the next node-store update
  re-adopts the user nodes (symptom: "edges missing until a node is
  clicked"). Keep the declaration (first paint + jsdom, where
  offsetWidth 0 means the measurement pass never runs) AND matching
  invisible `<Handle>` elements in the card; the regression test mocks
  offsetWidth/offsetHeight to exercise the overwrite path. Without them React Flow keeps
  nodes `visibility: hidden` until measured, which never happens in jsdom
  and flashes in production.
- Testing recipe (jsdom): stub `ResizeObserver` with a class whose
  `observe` synchronously invokes the callback with a `{ target,
  contentRect }` entry, stub `DOMMatrixReadOnly` (`m22 = 1`), and spy
  `HTMLElement.prototype.getBoundingClientRect` to a non-zero rect. Click
  nodes/buttons with `fireEvent`, not `userEvent`: jsdom dispatches pointer
  events with a null `view`, which crashes d3-zoom's drag bookkeeping.
- Keep React Flow's attribution visible (MIT courtesy); the OutlineTree
  remains the keyboard-accessible navigation surface for the same tree.
