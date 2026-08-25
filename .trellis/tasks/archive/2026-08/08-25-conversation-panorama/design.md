# Technical design: Conversation Panorama terminology refactor

## Boundaries

This is a frontend-only naming and terminology migration. The existing
conversation store, Tauri contracts, tree data model, React Flow rendering,
and layout behavior remain unchanged. The only behavior-level change is the
names exposed by the local workspace view route and the associated public
component/module APIs.

## Rename map

| Existing | Replacement |
| --- | --- |
| `MindMapCanvas.tsx` | `ConversationPanorama.tsx` |
| `MindMapCanvas` | `ConversationPanorama` |
| `mindmapLayout.ts` | `panoramaLayout.ts` |
| `MindMap*` types / `projectMindMapLayout` | `Panorama*` types / `projectPanoramaLayout` |
| `MINDMAP_*` layout constants | `PANORAMA_*` layout constants |
| `mindMapCard` React Flow node type | `panoramaCard` |
| `isMindMapOpen` | `isPanoramaOpen` |
| `conversation.mindmap.*` | `conversation.panorama.*` |
| “思维导图” / “mind-map” | “对话全景” / “Conversation Panorama” |

The component's callback names remain semantic (`onSelect`,
`onOpenInConversation`) because they describe behavior rather than the old
visual metaphor. The pure layout algorithm remains a left-to-right tree; only
its public module and symbol names change.

## Data and view flow

```text
ConversationWorkspace
  ├─ isPanoramaOpen local view route
  ├─ Panorama button + conversation.panorama.* labels
  └─ ConversationPanorama
       └─ projectPanoramaLayout
            └─ PanoramaCardNode / panoramaCard React Flow nodes
```

`ConversationWorkspace` continues to own the store actions and active path.
`ConversationPanorama` remains a fully controlled component with the current
props and no store access. Double-click still calls the workspace callback,
which selects the branch and closes the Panorama route.

## Compatibility and migration

- There is no URL router, URL path, persisted view key, or external API for
  this feature, so no compatibility alias or migration layer is necessary.
- This is an atomic source migration: update the implementation, barrel
  export, tests, i18n dictionaries, and frontend design guideline together.
- Historical archived tasks and journals remain untouched to preserve the
  accuracy of project history.

## Risks and mitigations

- **Missed identifier**: search `src/` after the rename for all old English
  and Chinese terms, then run typecheck so barrel/import omissions fail fast.
- **React Flow behavior drift**: make only mechanical symbol/file changes and
  retain the explicit node dimensions, handles, and `panoramaCard` node type;
  preserve the existing canvas test setup and assertions.
- **Locale parity drift**: rename each dictionary key in the source-of-truth
  locale and the English locale in one patch; the dictionary parity test and
  typecheck provide two checks.

## Rollback

Revert the rename commit (or restore the rename map in reverse). No database,
IPC, persisted data, or remote route needs rollback.
