import { hierarchy, tree } from "d3-hierarchy"
import {
  Position,
  type Edge,
  type Node as FlowNode,
  type NodeHandle,
} from "@xyflow/react"

import type { TreeNodeView } from "./types"

// Card metrics shared by the layout and the card component. Cards render at
// a fixed size and nodes declare both `width`/`height` and `measured` up
// front: React Flow's fitView only considers `measured`, and adoptUserNodes
// resets measured from the user node (it does not fall back to width/height).
// Without a seeded measured, any re-adopt after the first ResizeObserver pass
// leaves fitView with an empty node set — Controls "fit view" appears dead.
// d3 returns breadth/depth centers while React Flow positions are top-left
// corners, so the projection subtracts half the card size.
export const PANORAMA_CARD_WIDTH = 224
export const PANORAMA_CARD_HEIGHT = 80

// Breadth-axis step (sibling cards) and depth-axis step (levels). The
// separation multiplier widens spacing between unrelated cousin subtrees.
export const PANORAMA_ROW_STEP = 104
export const PANORAMA_COLUMN_STEP = 300
const COUSIN_SEPARATION = 1.3

export type PanoramaCardData = {
  nodeId: string
  role: TreeNodeView["role"]
  preview: string
  isActiveNode: boolean
  isOnActivePath: boolean
  childCount: number
  isCollapsed: boolean
  collapsedDescendantCount: number
}

// Declarative anchor points: React Flow refuses to render an edge until the
// endpoint nodes have handle bounds (error 008 / silent null otherwise).
// Declaring them on the node skips DOM measurement entirely, so edges exist
// on the very first paint.
const PANORAMA_NODE_HANDLES: NodeHandle[] = [
  {
    type: "target",
    position: Position.Left,
    x: 0,
    y: PANORAMA_CARD_HEIGHT / 2,
  },
  {
    type: "source",
    position: Position.Right,
    x: PANORAMA_CARD_WIDTH,
    y: PANORAMA_CARD_HEIGHT / 2,
  },
]

export type PanoramaNodeData = PanoramaCardData & {
  onToggleBranch: (nodeId: string) => void
}

export type PanoramaCardNode = FlowNode<PanoramaCardData, "panoramaCard">
export type PanoramaFlowNode = FlowNode<PanoramaNodeData, "panoramaCard">
export type PanoramaFlowEdge = Edge

export type PanoramaLayoutInput = {
  rootNodeId: string
  nodesById: Readonly<Record<string, TreeNodeView>>
  /** Ordered root -> active node IDs, owned by the store's path selector. */
  activePathIds: readonly string[]
  collapsedIds: ReadonlySet<string>
}

export type PanoramaLayout = {
  nodes: PanoramaCardNode[]
  edges: PanoramaFlowEdge[]
}

// Iterative pre-order walk that validates the whole tree (identity, parent
// links, cycle-freedom) and accumulates descendant counts per node. Children
// always appear after their parent in the walk order, so the reversed pass
// is a valid bottom-up accumulation. Returns null on any inconsistency.
function measureSubtrees(
  rootNodeId: string,
  nodesById: Readonly<Record<string, TreeNodeView>>,
): ReadonlyMap<string, number> | null {
  const order: string[] = []
  const visited = new Set<string>()
  const pending: Array<{ id: string; parentId: string | undefined }> = [
    { id: rootNodeId, parentId: undefined },
  ]

  while (pending.length > 0) {
    const frame = pending.pop()
    if (frame === undefined) return null

    const node = nodesById[frame.id]
    if (
      node === undefined ||
      node.id !== frame.id ||
      node.parentId !== frame.parentId
    ) {
      return null
    }
    if (visited.has(frame.id)) return null
    visited.add(frame.id)
    order.push(frame.id)

    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = node.childIds[index]
      if (childId === undefined) return null
      pending.push({ id: childId, parentId: node.id })
    }
  }

  const descendantCounts = new Map<string, number>()
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const nodeId = order[index]
    if (nodeId === undefined) return null
    const node = nodesById[nodeId]
    if (node === undefined) return null

    let count = 0
    for (const childId of node.childIds) {
      const childCount = descendantCounts.get(childId)
      if (childCount === undefined) return null
      count += childCount + 1
    }
    descendantCounts.set(nodeId, count)
  }

  return descendantCounts
}

// Collects the visible node set: descendants of collapsed nodes are hidden.
function collectVisibleIds(
  rootNodeId: string,
  nodesById: Readonly<Record<string, TreeNodeView>>,
  collapsedIds: ReadonlySet<string>,
): ReadonlySet<string> | null {
  const visible = new Set<string>()
  const pending: string[] = [rootNodeId]

  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (nodeId === undefined || visible.has(nodeId)) return null
    visible.add(nodeId)

    const node = nodesById[nodeId]
    if (node === undefined) return null
    if (!collapsedIds.has(nodeId)) {
      for (const childId of node.childIds) pending.push(childId)
    }
  }

  return visible
}

type HierarchyDatum = { id: string; children: HierarchyDatum[] }

function buildHierarchyDatum(
  nodeId: string,
  nodesById: Readonly<Record<string, TreeNodeView>>,
  visibleIds: ReadonlySet<string>,
): HierarchyDatum {
  const node = nodesById[nodeId]
  const children = (node?.childIds ?? []).filter((childId) =>
    visibleIds.has(childId),
  )
  return {
    id: nodeId,
    children: children.map((childId) =>
      buildHierarchyDatum(childId, nodesById, visibleIds),
    ),
  }
}

export function projectPanoramaLayout({
  rootNodeId,
  nodesById,
  activePathIds,
  collapsedIds,
}: PanoramaLayoutInput): PanoramaLayout | null {
  const root = nodesById[rootNodeId]
  if (root === undefined || root.parentId !== undefined) return null

  const descendantCounts = measureSubtrees(rootNodeId, nodesById)
  if (descendantCounts === null) return null

  const visibleIds = collectVisibleIds(rootNodeId, nodesById, collapsedIds)
  if (visibleIds === null) return null

  const activeNodeId = activePathIds.at(-1) ?? null
  const activePathSet = new Set(activePathIds)

  // Left-to-right orientation: depth (d.y) maps to x, breadth (d.x) to y.
  const rootDatum = tree<HierarchyDatum>()
    .nodeSize([PANORAMA_ROW_STEP, PANORAMA_COLUMN_STEP])
    .separation((a, b) => (a.parent === b.parent ? 1 : COUSIN_SEPARATION))(
    hierarchy(
      buildHierarchyDatum(rootNodeId, nodesById, visibleIds),
      (datum) => datum.children,
    ),
  )

  const nodes: PanoramaCardNode[] = []
  const edges: PanoramaFlowEdge[] = []

  for (const datum of rootDatum.descendants()) {
    // d3 exposes the wrapped payload as `.data`; the node id lives there.
    const nodeId = datum.data.id
    const node = nodesById[nodeId]
    if (node === undefined) return null

    const isOnActivePath = activePathSet.has(nodeId)
    const isCollapsed = collapsedIds.has(nodeId)
    nodes.push({
      id: nodeId,
      type: "panoramaCard",
      position: {
        x: datum.y - PANORAMA_CARD_WIDTH / 2,
        y: datum.x - PANORAMA_CARD_HEIGHT / 2,
      },
      width: PANORAMA_CARD_WIDTH,
      height: PANORAMA_CARD_HEIGHT,
      measured: {
        width: PANORAMA_CARD_WIDTH,
        height: PANORAMA_CARD_HEIGHT,
      },
      handles: PANORAMA_NODE_HANDLES,
      data: {
        nodeId,
        role: node.role,
        preview: node.preview,
        isActiveNode: activeNodeId === nodeId,
        isOnActivePath,
        childCount: node.childIds.length,
        isCollapsed,
        collapsedDescendantCount: descendantCounts.get(nodeId) ?? 0,
      },
    })

    const parentId = node.parentId
    if (parentId !== undefined && visibleIds.has(parentId)) {
      const edgeOnActivePath = isOnActivePath && activePathSet.has(parentId)
      edges.push({
        id: `${parentId}__${nodeId}`,
        source: parentId,
        target: nodeId,
        type: "smoothstep",
        // Connector lines carry information: use muted-foreground, not the
        // border token (near-invisible on the light canvas), and foreground
        // for the active path so it dominates in both color schemes.
        style: edgeOnActivePath
          ? { stroke: "var(--foreground)", strokeWidth: 2 }
          : {
              stroke: "var(--muted-foreground)",
              strokeOpacity: 0.6,
              strokeWidth: 1.25,
            },
      })
    }
  }

  return { nodes, edges }
}
