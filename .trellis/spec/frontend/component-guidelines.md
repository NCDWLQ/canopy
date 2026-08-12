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
variables, Lucide icons, and the `@/*` aliases rooted at `src/`.

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
  features/providers/components/   # provider settings and model selection
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
  out of the outline and never assign it a durable node identity before exact
  completion. Do not label it as transient/not saved or expose commit,
  database, or reconciliation implementation terms.
- `starting` renders “正在思考”; `streaming` appends content in that assistant
  slot; `committing` keeps the complete bubble silent. Visible recovery begins
  only after the controller's grace period with “正在恢复这条回复…”.
- Generation failure shows “回复失败” plus “重新生成” without retaining partial
  output. Persistence failure retains the complete content and shows
  “这条回复未能保存” plus “重新生成”. Cancellation retains received partial
  content and shows “回复已停止”. A reconciliation retry appears only after an
  automatic authoritative reload cannot prove completion.
- `MessageNode` displays capabilities supplied through `canBranch` / `canEdit`; it must not infer authorization from raw roles beyond visual presentation.
- Branch and edit callbacks emit the source node ID. Editing is labeled as creating a branch and never mutates displayed history optimistically.
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
| Status is `error` | Show the safe error message; offer retry only when `retryable` is true |
| User cancels streaming | Preserve received partial content and show “回复已停止” without an error toast |
| Generation fails before acknowledgement | Discard partial output; show “回复失败” and “重新生成” |
| Persistence explicitly fails after ready | Preserve complete output; show “这条回复未能保存” and “重新生成” |
| Commit result is uncertain | Keep the full assistant bubble silent during the grace period; then show recovery without a button until automatic reload needs help |

### 5. Good / Base / Bad Cases

- **Good**: a branched fixture shows the active node and ancestors, sibling indicators in the outline, and only the active path in the message pane.
- **Base**: a blank draft renders an empty Composer and no durable root; the first successful send installs the authoritative user root.
- **Bad**: missing active-node data never falls back to rendering all conversation messages.

### 6. Tests Required

- `OutlineTree`: selecting, expanding, collapsing, roving focus, arrow-key navigation, and active-node semantics.
- `ConversationPane`: exact root-to-active order and an explicit assertion that sibling content is absent.
- `MessageNode`: branch/edit callbacks receive the source ID once; disabled actions cannot fire.
- Loading, empty, provider-auth, retryable, non-retryable, streaming, and cancellation states.
- Generation presentation covers starting, streaming, silent committing,
  delayed reconciling, phase-derived failure kinds, retained cancellation
  content, gated recovery retry, exact copy, and absence of engineering copy.
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
- The outline uses tree/treeitem semantics or an equivalent tested Radix pattern, visible focus, correct expanded/selected state, and roving keyboard focus.
- Every icon-only action has an accessible name. Menus, dialogs, and tooltips use Radix focus management.
- Do not rely on color alone for active paths, roles, errors, or conversation archive state.
- Respect reduced motion and keep the interface usable at desktop webview zoom levels.

### Design Decision: Workspace-Global Settings Entry

**Context**: Provider configuration applies to the workspace, not to the
selected conversation. A conversation-header action therefore gives global
configuration the wrong ownership and competes with conversation-scoped
actions.

**Decision**: Expose workspace-global Settings through one persistent footer
action in the expanded conversation sidebar. Open a titled Radix/shadcn dialog
and compose feature-owned settings content inside it; keep Provider state,
secret handling, and typed client calls in the Provider feature. Low-frequency
sidebar footer actions use the flat `ghost` treatment with muted default text
and foreground hover emphasis so they remain subordinate to history and tree
navigation.

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

Do not duplicate the Provider trigger in the conversation header. Tests must
assert that Settings has one accessible trigger in the sidebar footer, opens a
titled dialog, restores focus when closed, and remains usable after the sidebar
is collapsed and reopened. Provider tests continue to cover keyboard submit,
secret clearing, save/delete, errors, read-only state, and generation/loading
locks through the global settings surface.

## Common Mistakes

- Rendering the entire conversation instead of the supplied active path.
- Treating a branch as a copied conversation in component state.
- Calling raw `invoke` from a component because it appears to be a small query.
- Mutating a historical message locally before the branch command succeeds.
- Letting a separately assigned UI agent redefine shared DTOs to fit a component.
- Testing only that ancestors appear without asserting that sibling content is absent.
- Rendering transient output as a warning/status card or exposing `Not saved`,
  commit, local-storage, or database vocabulary in the successful path.
