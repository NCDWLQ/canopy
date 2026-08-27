import { describe, expect, it } from "vitest"

import {
  PANORAMA_CARD_HEIGHT,
  PANORAMA_CARD_WIDTH,
  PANORAMA_COLUMN_STEP,
  projectPanoramaLayout,
} from "./panoramaLayout"
import type { TreeNodeView } from "./types"

const nodesById: Readonly<Record<string, TreeNodeView>> = {
  root: {
    id: "root",
    role: "user",
    preview: "ROOT",
    childIds: ["assistant-a"],
  },
  "assistant-a": {
    id: "assistant-a",
    parentId: "root",
    role: "assistant",
    preview: "A",
    childIds: ["user-left", "user-right"],
  },
  "user-left": {
    id: "user-left",
    parentId: "assistant-a",
    role: "user",
    preview: "LEFT",
    childIds: ["assistant-left"],
  },
  "assistant-left": {
    id: "assistant-left",
    parentId: "user-left",
    role: "assistant",
    preview: "L",
    childIds: [],
  },
  "user-right": {
    id: "user-right",
    parentId: "assistant-a",
    role: "user",
    preview: "RIGHT",
    childIds: [],
  },
}

const activePathIds = ["root", "assistant-a", "user-right"]

function nodeById(
  layout: NonNullable<ReturnType<typeof projectPanoramaLayout>>,
  nodeId: string,
) {
  return layout.nodes.find((node) => node.id === nodeId)
}

describe("projectPanoramaLayout", () => {
  it("lays out every visible node left-to-right with parent edges", () => {
    const layout = projectPanoramaLayout({
      rootNodeId: "root",
      nodesById,
      activePathIds,
      collapsedIds: new Set(),
    })
    expect(layout).not.toBeNull()

    const ids = layout?.nodes.map((node) => node.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        "root",
        "assistant-a",
        "user-left",
        "assistant-left",
        "user-right",
      ]),
    )

    const root = nodeById(layout!, "root")
    const assistant = nodeById(layout!, "assistant-a")
    const left = nodeById(layout!, "user-left")
    expect(root?.position.x).toBe(-PANORAMA_CARD_WIDTH / 2)
    expect(assistant?.position.x).toBe(
      PANORAMA_COLUMN_STEP - PANORAMA_CARD_WIDTH / 2,
    )
    expect(left && root ? left.position.x > root.position.x : false).toBe(true)
    // breadth coordinate stays inside the card height band
    expect(Math.abs(root!.position.y + PANORAMA_CARD_HEIGHT / 2)).toBeLessThan(
      PANORAMA_CARD_HEIGHT * 4,
    )

    expect(layout?.edges).toHaveLength(4)
    expect(
      layout?.edges.find(
        (edge) => edge.source === "assistant-a" && edge.target === "user-right",
      ),
    ).toBeDefined()
  })

  it("marks only root-to-active nodes and edges as on the active path", () => {
    const layout = projectPanoramaLayout({
      rootNodeId: "root",
      nodesById,
      activePathIds,
      collapsedIds: new Set(),
    })!

    expect(nodeById(layout, "root")?.data.isOnActivePath).toBe(true)
    expect(nodeById(layout, "assistant-a")?.data.isOnActivePath).toBe(true)
    expect(nodeById(layout, "user-right")?.data).toMatchObject({
      isOnActivePath: true,
      isActiveNode: true,
    })
    expect(nodeById(layout, "user-left")?.data).toMatchObject({
      isOnActivePath: false,
      isActiveNode: false,
    })
    expect(nodeById(layout, "assistant-left")?.data.isOnActivePath).toBe(false)

    const activeEdge = layout.edges.find(
      (edge) => edge.source === "assistant-a" && edge.target === "user-right",
    )
    const siblingEdge = layout.edges.find(
      (edge) => edge.source === "assistant-a" && edge.target === "user-left",
    )
    expect(activeEdge?.style).toMatchObject({ stroke: "var(--foreground)" })
    expect(siblingEdge?.style).toMatchObject({
      stroke: "var(--muted-foreground)",
    })
  })

  it("keeps selection on a mid-branch node while highlighting through its newest leaf", () => {
    const layout = projectPanoramaLayout({
      rootNodeId: "root",
      nodesById,
      activePathIds: ["root", "assistant-a"],
      highlightedPathIds: ["root", "assistant-a", "user-right"],
      collapsedIds: new Set(),
    })!

    expect(nodeById(layout, "assistant-a")?.data).toMatchObject({
      isActiveNode: true,
      isOnActivePath: true,
    })
    expect(nodeById(layout, "user-right")?.data).toMatchObject({
      isActiveNode: false,
      isOnActivePath: true,
    })
    expect(nodeById(layout, "user-left")?.data.isOnActivePath).toBe(false)

    const highlightedEdge = layout.edges.find(
      (edge) => edge.source === "assistant-a" && edge.target === "user-right",
    )
    expect(highlightedEdge?.style).toMatchObject({
      stroke: "var(--foreground)",
    })
  })

  it("hides descendants of collapsed nodes and reports their count", () => {
    const layout = projectPanoramaLayout({
      rootNodeId: "root",
      nodesById,
      activePathIds: ["root", "assistant-a"],
      collapsedIds: new Set(["assistant-a"]),
    })!

    expect(layout.nodes.map((node) => node.id).sort()).toEqual([
      "assistant-a",
      "root",
    ])
    expect(nodeById(layout, "assistant-a")?.data).toMatchObject({
      isCollapsed: true,
      childCount: 2,
      collapsedDescendantCount: 3,
    })
    expect(layout.edges).toHaveLength(1)
  })

  it("renders a single-node tree without edges", () => {
    const layout = projectPanoramaLayout({
      rootNodeId: "only",
      nodesById: {
        only: { id: "only", role: "user", preview: "SOLO", childIds: [] },
      },
      activePathIds: ["only"],
      collapsedIds: new Set(),
    })!

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(nodeById(layout, "only")?.data).toMatchObject({
      isActiveNode: true,
      childCount: 0,
    })
  })

  it("returns null for unsafe projections", () => {
    const cases: Readonly<Record<string, TreeNodeView>>[] = [
      // missing root
      {},
      // root with a parent is not a root
      {
        root: {
          id: "root",
          parentId: "other",
          role: "user",
          preview: "R",
          childIds: [],
        },
      },
      // child references a missing node
      {
        root: { id: "root", role: "user", preview: "R", childIds: ["ghost"] },
      },
      // child parent link disagrees with the tree
      {
        root: { id: "root", role: "user", preview: "R", childIds: ["child"] },
        child: { id: "child", role: "assistant", preview: "C", childIds: [] },
      },
      // cycle: root -> a -> b -> a
      {
        root: { id: "root", role: "user", preview: "R", childIds: ["a"] },
        a: {
          id: "a",
          parentId: "root",
          role: "assistant",
          preview: "A",
          childIds: ["b"],
        },
        b: {
          id: "b",
          parentId: "a",
          role: "user",
          preview: "B",
          childIds: ["a"],
        },
      },
    ]

    for (const unsafeNodes of cases) {
      expect(
        projectPanoramaLayout({
          rootNodeId: "root",
          nodesById: unsafeNodes,
          activePathIds: [],
          collapsedIds: new Set(),
        }),
      ).toBeNull()
    }
  })
})
