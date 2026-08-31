import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationPanorama } from "./ConversationPanorama"
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
describe("ConversationPanorama", () => {
  it("renders every tree node and marks the active path", () => {
    const { container } = render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
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
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    // React Flow silently drops edges whose endpoint nodes have no handle
    // bounds, so presence here is the regression guard for the declared
    // PANORAMA_NODE_HANDLES anchors.
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(4)

    const activeEdge = container.querySelector(
      '[data-testid="rf__edge-assistant-a__user-right"]',
    )
    expect(activeEdge).not.toBeNull()
    expect(activeEdge?.querySelector("path")?.getAttribute("style")).toContain(
      "var(--foreground)",
    )

    const siblingEdge = container.querySelector(
      '[data-testid="rf__edge-assistant-a__user-left"]',
    )
    expect(siblingEdge).not.toBeNull()
    expect(siblingEdge?.querySelector("path")?.getAttribute("style")).toContain(
      "var(--muted-foreground)",
    )
  })

  it("emits the clicked node id through onSelect", () => {
    const onSelect = vi.fn()
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={onSelect}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    // Non-leaf card: selection must report this id, not a descendant leaf.
    fireEvent.click(screen.getByText("A"))

    expect(onSelect).toHaveBeenCalledWith("assistant-a")
  })

  it("emits the double-clicked node id through onOpenInConversation", () => {
    const onOpenInConversation = vi.fn()
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={onOpenInConversation}
        onCreateBranch={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByText("LEFT"))

    expect(onOpenInConversation).toHaveBeenCalledWith("user-left")
  })

  it("does not open conversation when collapsing a branch", () => {
    const onOpenInConversation = vi.fn()
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={onOpenInConversation}
        onCreateBranch={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByRole("button", { name: "收起 A 的分支" }))

    expect(onOpenInConversation).not.toHaveBeenCalled()
  })

  it("collapses and re-expands branches from the node button", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
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

  it("renders tooltip triggers with short text for branch toggles", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    const collapseButton = screen.getByRole("button", {
      name: "收起 A 的分支",
    })
    expect(collapseButton).toHaveAttribute("data-slot", "tooltip-trigger")

    fireEvent.click(collapseButton)

    const expandButton = screen.getByRole("button", {
      name: "展开 A 的分支",
    })
    expect(expandButton).toHaveAttribute("data-slot", "tooltip-trigger")
  })

  it("does not offer a collapse control on childless nodes", () => {
    render(
      <ConversationPanorama
        rootNodeId="only"
        nodesById={{
          only: { id: "only", role: "user", preview: "SOLO", childIds: [] },
        }}
        activePathIds={["only"]}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    expect(screen.getByText("SOLO")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /分支/ }),
    ).not.toBeInTheDocument()
  })

  it("offers the branch action only on assistant cards with children", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    // assistant-a has children; the user cards and childless assistant-left
    // follow the same eligibility rule as the conversation pane.
    const branchButtons = screen.getAllByRole("button", {
      name: "从此处创建分支",
    })
    expect(branchButtons).toHaveLength(1)
    const branchCard = branchButtons[0]?.closest("[data-node-id]")
    expect(branchCard).toHaveAttribute("data-node-id", "assistant-a")
    // The action floats below the card as a hover-revealed bar, like the
    // message bubble action row.
    expect(branchCard).toHaveClass("group")
    expect(branchButtons[0]?.parentElement).toHaveClass("top-full", "opacity-0")
  })

  it("emits the node id through onCreateBranch without selecting the card", () => {
    const onCreateBranch = vi.fn()
    const onSelect = vi.fn()
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={onSelect}
        onOpenInConversation={vi.fn()}
        onCreateBranch={onCreateBranch}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "从此处创建分支" }))

    expect(onCreateBranch).toHaveBeenCalledWith("assistant-a")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("hides the branch action while mutations are locked", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={null}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "从此处创建分支" }),
    ).not.toBeInTheDocument()
  })

  it("offers delete only on non-root user nodes when deletion is enabled", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
        onDeleteNode={vi.fn()}
      />,
    )

    const deleteButtons = screen.getAllByRole("button", {
      name: "删除该分支",
    })
    expect(deleteButtons).toHaveLength(2)
    const deleteNodeIds = deleteButtons.map((button) =>
      button.closest("[data-node-id]")?.getAttribute("data-node-id"),
    )
    expect(deleteNodeIds).toEqual(
      expect.arrayContaining(["user-left", "user-right"]),
    )
    expect(
      within(screen.getByText("ROOT").closest("[data-node-id]")!).queryByRole(
        "button",
        { name: "删除该分支" },
      ),
    ).not.toBeInTheDocument()
  })

  it("emits the node id through onDeleteNode without selecting the card", () => {
    const onDeleteNode = vi.fn()
    const onSelect = vi.fn()
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={onSelect}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
        onDeleteNode={onDeleteNode}
      />,
    )

    fireEvent.click(
      within(screen.getByText("LEFT").closest("[data-node-id]")!).getByRole(
        "button",
        { name: "删除该分支" },
      ),
    )

    expect(onDeleteNode).toHaveBeenCalledWith("user-left")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("hides delete while mutations are locked", () => {
    render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
        onDeleteNode={null}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "删除该分支" }),
    ).not.toBeInTheDocument()
  })

  it("renders the integrity error for unsafe projections", () => {
    render(
      <ConversationPanorama
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
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("无法安全显示对话树。")
  })

  it("keeps edges after the post-mount measurement pass", () => {
    // In a real browser the node ResizeObserver completes measurement
    // (offsetWidth/offsetHeight) and React Flow overwrites handleBounds from
    // a DOM scan. Without Handle elements in the card that scan yields null
    // and every edge disappears until the next node-store update — the
    // "edges missing until a node is clicked" regression. jsdom's
    // offsetWidth is always 0, so the pass only runs with these stubs.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(224)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80)

    const { container } = render(
      <ConversationPanorama
        rootNodeId="root"
        nodesById={nodesById}
        activePathIds={activePathIds}
        onSelect={vi.fn()}
        onOpenInConversation={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    )

    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(4)
    expect(container.querySelectorAll(".react-flow__handle")).not.toHaveLength(
      0,
    )
  })
})
