import * as React from "react"
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import { Bot, Minus, Plus, Terminal, User, Wrench } from "lucide-react"

import type { TreeNodeView } from "../types"
import {
  MINDMAP_CARD_HEIGHT,
  MINDMAP_CARD_WIDTH,
  projectMindMapLayout,
  type MindMapFlowNode,
} from "../mindmapLayout"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n"

import "@xyflow/react/dist/style.css"

// The canvas is a visual branch overview; the OutlineTree remains the
// keyboard-accessible navigation surface for the same tree.
function RoleIcon({ role }: { role: TreeNodeView["role"] }) {
  switch (role) {
    case "user":
      return <User className="size-3.5 shrink-0" aria-hidden="true" />
    case "assistant":
      return <Bot className="size-3.5 shrink-0" aria-hidden="true" />
    case "system":
      return <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
    case "tool":
      return <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
  }
}

const ROLE_LABEL_KEYS = {
  system: "conversation.messageBubble.roleSystem",
  user: "conversation.messageBubble.roleUser",
  assistant: "conversation.messageBubble.roleAssistant",
  tool: "conversation.messageBubble.roleTool",
} as const

function MindMapNodeCard({ data }: NodeProps<MindMapFlowNode>) {
  const { t } = useTranslation()
  const label = data.preview || t("conversation.outline.emptyContent")
  const roleLabel = t(ROLE_LABEL_KEYS[data.role])
  const isCollapsed = data.isCollapsed

  return (
    <div
      data-node-id={data.nodeId}
      data-on-active-path={data.isOnActivePath ? "true" : undefined}
      aria-current={data.isActiveNode ? "true" : undefined}
      aria-label={`${roleLabel}：${label}`}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-left shadow-sm transition-colors motion-reduce:transition-none",
        data.role === "user"
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card",
        data.isOnActivePath && "border-ring/60",
        data.isActiveNode && "border-ring ring-2 ring-ring/50",
      )}
      style={{ width: MINDMAP_CARD_WIDTH, height: MINDMAP_CARD_HEIGHT }}
    >
      {/* Edge anchors are declared on the node in mindmapLayout (see
          MINDMAP_NODE_HANDLES); lines meet the card edges directly. */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <RoleIcon role={data.role} />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {roleLabel}
        </span>
        {isCollapsed && data.collapsedDescendantCount > 0 && (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 text-[10px] leading-none"
          >
            {t("conversation.mindmap.hiddenCount", {
              count: data.collapsedDescendantCount,
            })}
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 break-words text-xs leading-snug text-foreground">
        {label}
      </p>
      {data.childCount > 0 && (
        <button
          type="button"
          className="absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          aria-label={t(
            isCollapsed
              ? "conversation.mindmap.expandBranch"
              : "conversation.mindmap.collapseBranch",
            { label },
          )}
          aria-expanded={!isCollapsed}
          onClick={(event) => {
            event.stopPropagation()
            data.onToggleBranch(data.nodeId)
          }}
        >
          {isCollapsed ? (
            <Plus aria-hidden="true" />
          ) : (
            <Minus aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { mindMapCard: MindMapNodeCard }

const EMPTY_COLLAPSED_IDS: ReadonlySet<string> = new Set()

export type MindMapCanvasProps = {
  rootNodeId: string
  nodesById: Readonly<Record<string, TreeNodeView>>
  /** Ordered root -> active node IDs from the store's path selector. */
  activePathIds: readonly string[]
  onSelect: (nodeId: string) => void
}

export function MindMapCanvas({
  rootNodeId,
  nodesById,
  activePathIds,
  onSelect,
}: MindMapCanvasProps) {
  const { t } = useTranslation()
  // Collapse state is scoped to a conversation: when the root changes the
  // previous set is discarded instead of being reset through an effect.
  const [collapseState, setCollapseState] = React.useState<{
    rootNodeId: string
    collapsedIds: ReadonlySet<string>
  }>(() => ({ rootNodeId, collapsedIds: new Set() }))
  const collapsedIds =
    collapseState.rootNodeId === rootNodeId
      ? collapseState.collapsedIds
      : EMPTY_COLLAPSED_IDS

  const handleToggleBranch = React.useCallback(
    (nodeId: string) => {
      setCollapseState((previous) => {
        const base =
          previous.rootNodeId === rootNodeId
            ? previous.collapsedIds
            : EMPTY_COLLAPSED_IDS
        const next = new Set(base)
        if (next.has(nodeId)) next.delete(nodeId)
        else next.add(nodeId)
        return { rootNodeId, collapsedIds: next }
      })
    },
    [rootNodeId],
  )

  const layout = React.useMemo(
    () =>
      projectMindMapLayout({
        rootNodeId,
        nodesById,
        activePathIds,
        collapsedIds,
      }),
    [rootNodeId, nodesById, activePathIds, collapsedIds],
  )

  if (layout === null) {
    return (
      <div className="p-6 text-sm text-destructive" role="alert">
        {t("errors.unsafeTreeProjection")}
      </div>
    )
  }

  const nodes: MindMapFlowNode[] = layout.nodes.map((node) => ({
    ...node,
    data: { ...node.data, onToggleBranch: handleToggleBranch },
  }))

  return (
    <div
      className="h-full w-full [--xy-background-pattern-dots-color:var(--border)]"
      role="region"
      aria-label={t("conversation.mindmap.canvas")}
    >
      {/* key by root so switching conversations remounts the flow and
          re-fits the viewport */}
      <ReactFlow
        key={rootNodeId}
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.9 }}
        minZoom={0.1}
        maxZoom={1.75}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={28} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
