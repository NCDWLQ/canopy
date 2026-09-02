import * as React from "react"
import {
  Background,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type FitViewOptions,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import {
  Bot,
  GitBranch,
  Maximize2,
  Minus,
  Plus,
  Terminal,
  Trash2,
  User,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import type { TreeNodeView } from "../types"
import {
  PANORAMA_CARD_HEIGHT,
  PANORAMA_CARD_WIDTH,
  projectPanoramaLayout,
  type PanoramaFlowNode,
} from "../panoramaLayout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n"
import { useTheme } from "@/lib/theme"

import "@xyflow/react/dist/style.css"

// The canvas is a visual branch overview of the conversation tree.
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

function PanoramaNodeCard({ data }: NodeProps<PanoramaFlowNode>) {
  const { t } = useTranslation()
  const label = data.preview || t("conversation.outline.emptyContent")
  const roleLabel = t(ROLE_LABEL_KEYS[data.role])
  const isCollapsed = data.isCollapsed
  // Same eligibility rule as the conversation pane's branch action: only an
  // assistant reply that already has children can spawn a sibling branch.
  const canBranch =
    data.role === "assistant" &&
    data.childCount > 0 &&
    data.onCreateBranch !== null
  const canDelete =
    data.role === "user" &&
    !data.isRoot &&
    data.onDeleteNode !== null &&
    data.onDeleteNode !== undefined

  return (
    <div
      data-node-id={data.nodeId}
      data-on-active-path={data.isOnActivePath ? "true" : undefined}
      aria-current={data.isActiveNode ? "true" : undefined}
      aria-label={`${roleLabel}：${label}`}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-left transition-colors motion-reduce:transition-none",
        data.role === "user"
          ? "border-border bg-muted"
          : "border-border bg-card",
        data.isOnActivePath && "border-ring/60",
        data.isActiveNode && "border-ring ring-2 ring-ring/50",
      )}
      style={{ width: PANORAMA_CARD_WIDTH, height: PANORAMA_CARD_HEIGHT }}
    >
      {/* The declared PANORAMA_NODE_HANDLES cover the first paint, but the
          node ResizeObserver later overwrites handleBounds from a DOM scan
          (querySelectorAll('.source'/'.target')); with no handle elements
          that scan yields null and every edge silently disappears. Keep
          invisible Handle elements in sync with the declaration so measured
          bounds match. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!border-0 !bg-transparent"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!border-0 !bg-transparent"
      />
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
            {t("conversation.panorama.hiddenCount", {
              count: data.collapsedDescendantCount,
            })}
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 break-words text-xs leading-snug text-foreground">
        {label}
      </p>
      {data.childCount > 0 && (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="absolute -right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-background dark:bg-background text-muted-foreground hover:bg-muted dark:hover:bg-muted hover:text-foreground"
              aria-label={t(
                isCollapsed
                  ? "conversation.panorama.expandBranch"
                  : "conversation.panorama.collapseBranch",
                { label },
              )}
              aria-expanded={!isCollapsed}
              onClick={(event) => {
                event.stopPropagation()
                data.onToggleBranch(data.nodeId)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
              }}
            >
              {isCollapsed ? (
                <Plus className="size-3.5" aria-hidden="true" />
              ) : (
                <Minus className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isCollapsed
              ? data.collapsedDescendantCount > 0
                ? t("conversation.panorama.expandBranchTooltipCount", {
                    count: data.collapsedDescendantCount,
                  })
                : t("conversation.panorama.expandBranchTooltip")
              : t("conversation.panorama.collapseBranchTooltip")}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Branch action as a hover-revealed bar floating below the card, like
          the message bubble action row. The bar must not grow the node (fixed
          card metrics drive the layout), so it stays absolutely positioned in
          the row gap and shrinks to the button's own footprint. */}
      {canBranch && (
        <div className="absolute right-2 top-full z-10 mt-0.5 flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("conversation.message.branchFromHere")}
                onClick={(event) => {
                  event.stopPropagation()
                  data.onCreateBranch?.(data.nodeId)
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                }}
              >
                <GitBranch className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("conversation.message.branchFromHere")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      {canDelete && (
        <div className="absolute right-2 top-full z-10 mt-0.5 flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("conversation.panorama.deleteNode")}
                onClick={(event) => {
                  event.stopPropagation()
                  data.onDeleteNode?.(data.nodeId)
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("conversation.panorama.deleteNode")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { panoramaCard: PanoramaNodeCard }

const EMPTY_COLLAPSED_IDS: ReadonlySet<string> = new Set()

function viewportTransitionDuration(): number {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    ? 0
    : 200
}

function PanoramaControls({
  fitViewOptions,
}: {
  fitViewOptions: FitViewOptions
}) {
  const { t } = useTranslation()
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  return (
    <Panel
      position="bottom-left"
      className="overflow-hidden rounded-lg border border-border bg-background"
      aria-label={t("conversation.panorama.controls")}
    >
      <div className="flex flex-col divide-y divide-border">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-none"
              aria-label={t("conversation.panorama.zoomIn")}
              onClick={() => void zoomIn({ duration: viewportTransitionDuration() })}
            >
              <ZoomIn className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            {t("conversation.panorama.zoomIn")}
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-none"
              aria-label={t("conversation.panorama.zoomOut")}
              onClick={() => void zoomOut({ duration: viewportTransitionDuration() })}
            >
              <ZoomOut className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            {t("conversation.panorama.zoomOut")}
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-none"
              aria-label={t("conversation.panorama.fitView")}
              onClick={() =>
                void fitView({
                  ...fitViewOptions,
                  duration: viewportTransitionDuration(),
                })
              }
            >
              <Maximize2 className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={4}>
            {t("conversation.panorama.fitView")}
          </TooltipContent>
        </Tooltip>
      </div>
    </Panel>
  )
}

/** Screen-space inset before a click triggers a viewport nudge. */
const NODE_VIEW_PADDING = 48

export type ConversationPanoramaProps = {
  rootNodeId: string
  nodesById: Readonly<Record<string, TreeNodeView>>
  /** Ordered root -> selected node IDs from the store's path selector. */
  activePathIds: readonly string[]
  /**
   * Ordered root -> newest-leaf IDs for path chrome. Defaults to
   * `activePathIds` when omitted.
   */
  highlightedPathIds?: readonly string[]
  onSelect: (nodeId: string) => void
  /** Leave the canvas and open the conversation pane on this message. */
  onOpenInConversation: (nodeId: string) => void
  /**
   * Starts the branch composer on a card's node; null while mutations are
   * locked, which hides the branch affordance on every card.
   */
  onCreateBranch: ((nodeId: string) => void) | null
  /** Opens the delete confirmation for a user branch node; null hides it. */
  onDeleteNode?: ((nodeId: string) => void) | null
}

export function ConversationPanorama(props: ConversationPanoramaProps) {
  // The inner view needs useReactFlow for camera control, which requires a
  // provider above the component that renders <ReactFlow>.
  return (
    <ReactFlowProvider>
      <ConversationPanoramaView {...props} />
    </ReactFlowProvider>
  )
}

function ConversationPanoramaView({
  rootNodeId,
  nodesById,
  activePathIds,
  highlightedPathIds,
  onSelect,
  onOpenInConversation,
  onCreateBranch,
  onDeleteNode,
}: ConversationPanoramaProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const { getNode, getViewport, setViewport } = useReactFlow()
  const storeApi = useStoreApi()
  // Collapse state is scoped to a conversation: when the root changes the
  // previous set is discarded instead of being reset through an effect.
  const [collapseState, setCollapseState] = React.useState<{
    rootNodeId: string | null
    collapsedIds: ReadonlySet<string>
  }>({ rootNodeId: null, collapsedIds: EMPTY_COLLAPSED_IDS })
  const collapsedIds =
    collapseState.rootNodeId === rootNodeId
      ? collapseState.collapsedIds
      : EMPTY_COLLAPSED_IDS

  // Click should not reframe the canvas. Only nudge when the clicked card is
  // clipped by the viewport — pan just enough to clear the padding, keep zoom.
  const ensureNodeVisible = React.useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId)
      if (node === undefined) return
      const { width: paneWidth, height: paneHeight } = storeApi.getState()
      if (paneWidth <= 0 || paneHeight <= 0) return

      const cardWidth =
        node.measured?.width ?? node.width ?? PANORAMA_CARD_WIDTH
      const cardHeight =
        node.measured?.height ?? node.height ?? PANORAMA_CARD_HEIGHT
      const { x: viewportX, y: viewportY, zoom } = getViewport()
      const screenLeft = node.position.x * zoom + viewportX
      const screenTop = node.position.y * zoom + viewportY
      const screenRight = screenLeft + cardWidth * zoom
      const screenBottom = screenTop + cardHeight * zoom

      let deltaX = 0
      let deltaY = 0
      if (screenLeft < NODE_VIEW_PADDING) {
        deltaX = NODE_VIEW_PADDING - screenLeft
      } else if (screenRight > paneWidth - NODE_VIEW_PADDING) {
        deltaX = paneWidth - NODE_VIEW_PADDING - screenRight
      }
      if (screenTop < NODE_VIEW_PADDING) {
        deltaY = NODE_VIEW_PADDING - screenTop
      } else if (screenBottom > paneHeight - NODE_VIEW_PADDING) {
        deltaY = paneHeight - NODE_VIEW_PADDING - screenBottom
      }
      if (deltaX === 0 && deltaY === 0) return

      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ??
        false
      void setViewport(
        {
          x: viewportX + deltaX,
          y: viewportY + deltaY,
          zoom,
        },
        { duration: reducedMotion ? 0 : 280 },
      )
    },
    [getNode, getViewport, setViewport, storeApi],
  )

  const handleNodeClick: NonNullable<
    React.ComponentProps<typeof ReactFlow>["onNodeClick"]
  > = (_, node) => {
    onSelect(node.id)
    ensureNodeVisible(node.id)
  }

  const handleNodeDoubleClick: NonNullable<
    React.ComponentProps<typeof ReactFlow>["onNodeDoubleClick"]
  > = (_, node) => {
    onOpenInConversation(node.id)
  }

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
      projectPanoramaLayout({
        rootNodeId,
        nodesById,
        activePathIds,
        highlightedPathIds,
        collapsedIds,
      }),
    [rootNodeId, nodesById, activePathIds, highlightedPathIds, collapsedIds],
  )

  // Keep node object identity stable across parent re-renders so React Flow
  // can reuse internals (measured bounds) via referential equality. Mapping
  // a fresh array every render forced adoptUserNodes to rebuild nodes and
  // wipe measured — which silently disables Controls fitView.
  const nodes: PanoramaFlowNode[] | null = React.useMemo(() => {
    if (layout === null) return null
    return layout.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRoot: node.id === rootNodeId,
        onToggleBranch: handleToggleBranch,
        onCreateBranch,
        onDeleteNode,
      },
    }))
  }, [layout, handleToggleBranch, onCreateBranch, onDeleteNode, rootNodeId])

  const fitViewOptions = React.useMemo(
    () => ({ padding: 0.15, maxZoom: 0.9 }),
    [],
  )

  if (layout === null || nodes === null) {
    return (
      <div className="p-6 text-sm text-destructive" role="alert">
        {t("errors.unsafeTreeProjection")}
      </div>
    )
  }

  return (
    <div
      className="h-full w-full [--xy-background-pattern-dots-color:var(--border)]"
      role="region"
      aria-label={t("conversation.panorama.canvas")}
    >
      {/* key by root so switching conversations remounts the flow and
          re-fits the viewport */}
      <ReactFlow
        key={rootNodeId}
        colorMode={resolvedTheme}
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={1.75}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={28} />
        <PanoramaControls fitViewOptions={fitViewOptions} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
