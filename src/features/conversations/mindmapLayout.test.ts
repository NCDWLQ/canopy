import { describe, expect, it } from "vitest"

import {
  MINDMAP_CARD_HEIGHT,
  MINDMAP_CARD_WIDTH,
  MINDMAP_COLUMN_STEP,
  projectMindMapLayout,
} from "./mindmapLayout"
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
  layout: NonNullable<ReturnType<typeof projectMindMapLayout>>,
  nodeId: string,
) {
  return layout.nodes.find((node) => node.id === nodeId)
}

describe("projectMindMapLayout", () => {
  it("lays out every visible node left-to-right with parent edges", () => {
    const layout = projectMindMapLayout({
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
    expect(root?.position.x).toBe(-MINDMAP_CARD_WIDTH / 2)
    expect(assistant?.position.x).toBe(
      MINDMAP_COLUMN_STEP - MINDMAP_CARD_WIDTH / 2,
    )
    expect(left && root ? left.position.x > root.position.x : false).toBe(true)
    // breadth coordinate stays inside the card height band
    expect(Math.abs(root!.position.y + MINDMAP_CARD_HEIGHT / 2)).toBeLessThan(
      MINDMAP_CARD_HEIGHT * 4,
    )

    expect(layout?.edges).toHaveLength(4)
    expect(
      layout?.edges.find(
        (edge) => edge.source === "assistant-a" && edge.target === "user-right",
      ),
    ).toBeDefined()
  })

  it("marks only root-to-active nodes and edges as on the active path", () => {
    const layout = projectMindMapLayout({
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
    expect(activeEdge?.style).toMatchObject({ stroke: "var(--ring)" })
    expect(siblingEdge?.style).toMatchObject({ stroke: "var(--border)" })
  })

  it("hides descendants of collapsed nodes and reports their count", () => {
    const layout = projectMindMapLayout({
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
    const layout = projectMindMapLayout({
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
        projectMindMapLayout({
          rootNodeId: "root",
          nodesById: unsafeNodes,
          activePathIds: [],
          collapsedIds: new Set(),
        }),
      ).toBeNull()
    }
  })
})
