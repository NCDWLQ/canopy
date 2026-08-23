import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MindMapCanvas } from "./MindMapCanvas"
import type { TreeNodeView } from "../types"

// jsdom ships neither of the measurement APIs React Flow expects: its
// ResizeObserver entries drive node visibility, and DOMMatrixReadOnly feeds
// the zoom math. Without dimensions nodes stay `visibility: hidden`.
class ResizeObserverStub {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element): void {
    const contentRect = {
      width: 240,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    this.callback(
      [{ target, contentRect } as unknown as ResizeObserverEntry],
      this,
    )
  }

  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyStub {
  readonly m22 = 1
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: 240,
        height: 600,
        top: 0,
        left: 0,
        bottom: 600,
        right: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    },
  )
})

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

// fireEvent instead of userEvent: jsdom dispatches pointer events with a
// null `view`, which crashes d3-zoom's drag bookkeeping under React Flow's
// pan pane. Click handlers themselves are unaffected.
describe("MindMapCanvas", () => {
  it("renders every tree node and marks the active path", () => {
    const { container } = render(
      <MindMapCanvas
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
      />,
    )

    for (const preview of ["ROOT", "A", "LEFT", "L", "RIGHT"]) {
      expect(screen.getByText(preview)).toBeVisible()
    }

    const activeNode = container.querySelector('[data-node-id="user-right"]')
    expect(activeNode).toHaveAttribute("aria-current", "true")
    expect(
      container.querySelector('[data-node-id="assistant-a"]'),
    ).toHaveAttribute("data-on-active-path", "true")
    // Sibling branch nodes stay off the highlighted path.
    expect(
      container.querySelector('[data-node-id="user-left"]'),
    ).not.toHaveAttribute("data-on-active-path")
  })

  it("draws an edge per parent link and highlights the active-path edges", () => {
    const { container } = render(
      <MindMapCanvas
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
      />,
    )

    // React Flow silently drops edges whose endpoint nodes have no handle
    // bounds, so presence here is the regression guard for the declared
    // MINDMAP_NODE_HANDLES anchors.
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(4)

    const activeEdge = container.querySelector(
      '[data-testid="rf__edge-assistant-a__user-right"]',
    )
    expect(activeEdge).not.toBeNull()
    expect(activeEdge?.querySelector("path")?.getAttribute("style")).toContain(
      "var(--ring)",
    )

    const siblingEdge = container.querySelector(
      '[data-testid="rf__edge-assistant-a__user-left"]',
    )
    expect(siblingEdge).not.toBeNull()
    expect(siblingEdge?.querySelector("path")?.getAttribute("style")).toContain(
      "var(--border)",
    )
  })

  it("emits the clicked node id through onSelect", () => {
    const onSelect = vi.fn()
    render(
      <MindMapCanvas
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByText("LEFT"))

    expect(onSelect).toHaveBeenCalledWith("user-left")
  })

  it("collapses and re-expands branches from the node button", () => {
    render(
      <MindMapCanvas
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "收起 A 的分支" }))

    expect(screen.queryByText("RIGHT")).not.toBeInTheDocument()
    expect(screen.queryByText("LEFT")).not.toBeInTheDocument()
    expect(screen.getByText("3 条已折叠")).toBeVisible()
    expect(screen.getByText("A")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "展开 A 的分支" }))

    expect(screen.getByText("RIGHT")).toBeVisible()
    expect(screen.getByText("LEFT")).toBeVisible()
  })

  it("does not offer a collapse control on childless nodes", () => {
    render(
      <MindMapCanvas
        rootNodeId="only"
        nodesById={{
          only: { id: "only", role: "user", preview: "SOLO", childIds: [] },
        }}
        activePathIds={["only"]}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText("SOLO")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /分支/ }),
    ).not.toBeInTheDocument()
  })

  it("renders the integrity error for unsafe projections", () => {
    render(
      <MindMapCanvas
        rootNodeId="root"
        nodesById={{
          root: { id: "root", role: "user", preview: "R", childIds: ["a"] },
          a: {
            id: "a",
            parentId: "root",
            role: "assistant",
            preview: "A",
            childIds: ["root"],
          },
        }}
        activePathIds={["root"]}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("无法安全显示会话树。")
  })
})
