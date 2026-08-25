import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationPane } from "./ConversationPane"
import type { PathMessageView } from "../types"
import { useLocaleStore } from "@/lib/i18n/locale-store"

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
)

function installScrollIntoView(mock: ReturnType<typeof vi.fn>) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: mock,
  })
}

afterEach(() => {
  useLocaleStore.getState().setLocale("zh-CN")
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  } else {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    )
  }
})

const user1: PathMessageView = {
  id: "user-1",
  role: "user",
  content: "USER_1_CONTENT",
  createdAt: 1,
  metadata: null,
}

const assistant1: PathMessageView = {
  id: "assistant-1",
  role: "assistant",
  content: "ASSISTANT_1_CONTENT",
  createdAt: 2,
  metadata: null,
}

const user2: PathMessageView = {
  id: "user-2",
  role: "user",
  content: "USER_2_CONTENT",
  createdAt: 3,
  metadata: null,
}

const assistant2: PathMessageView = {
  id: "assistant-2",
  role: "assistant",
  content: "ASSISTANT_2_CONTENT",
  createdAt: 4,
  metadata: null,
}

describe("ConversationPane", () => {
  it("renders the localized pending branch marker immediately after its assistant origin", () => {
    render(
      <ConversationPane
        path={[user1, assistant1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        pendingBranchOriginId={assistant1.id}
      />,
    )

    const marker = screen.getByRole("separator", {
      name: "由此处创建分支",
    })
    const assistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")

    expect(marker).toBeVisible()
    expect(marker).toHaveAttribute("data-variant", "separator")
    expect(marker).toHaveTextContent("由此处创建分支")
    expect(marker.querySelector('[data-slot="marker-icon"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    expect(marker.querySelector('[data-slot="marker-icon"] svg')).not.toBeNull()
    expect(assistantArticle?.nextElementSibling).toBe(marker)

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(
      screen.getByRole("separator", { name: "Branch from here" }),
    ).toHaveTextContent("Branch from here")
  })

  it("passes userGenerationAction only to the last user message on the path", () => {
    const onSelect = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        userGenerationAction={{ kind: "generate", onSelect }}
      />,
    )

    const buttons = screen.getAllByRole("button", { name: "生成回复" })
    expect(buttons).toHaveLength(1)

    // The button belongs to the user-2 message article
    const user2Article = screen.getByText("USER_2_CONTENT").closest("article")
    expect(user2Article).not.toBeNull()
    expect(user2Article).toContainElement(buttons[0]!)

    const user1Article = screen.getByText("USER_1_CONTENT").closest("article")
    expect(user1Article).not.toBeNull()
    expect(
      within(user1Article!).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
  })

  it("renders '回复已停止' and '重新生成' on cancelled transient generation", async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={{
          phase: "cancelled",
          content: "CANCELLED_PARTIAL_CONTENT",
        }}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getByText("CANCELLED_PARTIAL_CONTENT")).toBeVisible()
    expect(screen.getByText("回复已停止")).toBeVisible()

    const regenerateBtn = screen.getByRole("button", { name: "重新生成" })
    expect(regenerateBtn).toBeVisible()
    expect(regenerateBtn).toHaveAttribute("title", "重新生成")
    expect(regenerateBtn).toHaveAttribute("aria-label", "重新生成")
    expect(regenerateBtn).toHaveAttribute("data-variant", "ghost")
    expect(regenerateBtn).toHaveAttribute("data-size", "icon")
    expect(regenerateBtn).toHaveClass("size-7")
    expect(regenerateBtn).toHaveClass(
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(regenerateBtn).toHaveTextContent("")
    expect(regenerateBtn.querySelector("svg")).toHaveClass("size-3.5")
    expect(regenerateBtn.parentElement).not.toHaveClass("opacity-0")

    await user.click(regenerateBtn)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("renders '回复失败' and '重新生成' on failed transient generation", async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={{
          phase: "failed",
          failureKind: "generation",
        }}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getByText("回复失败")).toBeVisible()
    const regenerateBtn = screen.getByRole("button", { name: "重新生成" })
    expect(regenerateBtn).toBeVisible()
    expect(regenerateBtn).toHaveAttribute("title", "重新生成")
    expect(regenerateBtn).toHaveAttribute("aria-label", "重新生成")
    expect(regenerateBtn).toHaveAttribute("data-variant", "ghost")
    expect(regenerateBtn).toHaveAttribute("data-size", "icon")
    expect(regenerateBtn).toHaveClass("size-7")
    expect(regenerateBtn).toHaveClass(
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(regenerateBtn).toHaveTextContent("")
    expect(regenerateBtn.querySelector("svg")).toHaveClass("size-3.5")
    expect(regenerateBtn.parentElement).not.toHaveClass("opacity-0")

    await user.click(regenerateBtn)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it("routes one assistant regeneration action only to the final assistant", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ConversationPane
        path={[user1, assistant1, user2, assistant2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: assistant2.id,
          onSelect,
        }}
      />,
    )

    const buttons = screen.getAllByRole("button", { name: "重新生成" })
    expect(buttons).toHaveLength(1)
    const regenBtn = buttons[0]!
    expect(regenBtn).toBeVisible()
    expect(regenBtn).toHaveAttribute("title", "重新生成")

    const finalAssistantArticle = screen
      .getByText(assistant2.content)
      .closest("article")
    const earlierAssistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")
    expect(finalAssistantArticle).toContainElement(regenBtn)
    expect(
      within(earlierAssistantArticle!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()

    await user.click(regenBtn)
    expect(onSelect).toHaveBeenCalledWith(assistant2.id)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("does not route a durable assistant action to an earlier message or alongside a transient recovery", () => {
    const props = {
      status: "ready" as const,
      canBranch: () => false,
      canEdit: () => false,
      onCreateBranch: vi.fn(),
      onEditAsBranch: vi.fn(),
      onRegenerate: vi.fn(),
    }
    const { rerender } = render(
      <ConversationPane
        {...props}
        path={[user1, assistant1, user2]}
        transientGeneration={null}
        assistantRegenerationAction={{
          assistantNodeId: assistant1.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()

    rerender(
      <ConversationPane
        {...props}
        path={[user1, assistant1]}
        transientGeneration={{ phase: "cancelled", content: "PARTIAL" }}
        assistantRegenerationAction={{
          assistantNodeId: assistant1.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    const assistantArticle = screen
      .getByText(assistant1.content)
      .closest("article")
    expect(
      within(assistantArticle!).queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "重新生成" })).toHaveLength(1)
  })

  describe("auto-scroll", () => {
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      installScrollIntoView(scrollIntoView)
      scrollIntoView.mockClear()
    })

    const props = {
      status: "ready" as const,
      canBranch: () => false,
      canEdit: () => false,
      onCreateBranch: vi.fn(),
      onEditAsBranch: vi.fn(),
      onRegenerate: vi.fn(),
    }

    it("does not scroll when the same path is rebuilt with new identities", () => {
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(1)

      // Identity churn mirrors unrelated store updates such as background
      // generation deltas in another conversation.
      rerender(
        <ConversationPane
          {...props}
          path={[{ ...user1 }, { ...assistant1 }]}
          transientGeneration={null}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })

    it("scrolls when the displayed tail changes or transient content grows", () => {
      const { rerender } = render(
        <ConversationPane
          {...props}
          path={[user1, assistant1]}
          transientGeneration={null}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(1)

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          transientGeneration={null}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(2)

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL",
            thinking: "",
          }}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(3)

      rerender(
        <ConversationPane
          {...props}
          path={[user1, assistant1, user2]}
          transientGeneration={{
            phase: "streaming",
            content: "PARTIAL_GROWN",
            thinking: "",
          }}
        />,
      )
      expect(scrollIntoView).toHaveBeenCalledTimes(4)
    })
  })
})

describe("ConversationPane search reveal", () => {
  it("anchors every message with its node id and scrolls the revealed hit into view", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)

    const { rerender } = render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
      />,
    )
    expect(
      screen.getByText("USER_1_CONTENT").closest("article"),
    ).toHaveAttribute("data-node-id", "user-1")
    expect(
      screen.getByText("USER_2_CONTENT").closest("article"),
    ).toHaveAttribute("data-node-id", "user-2")
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    )

    rerender(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-1", query: "USER_1" }}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    // The scroll targets the matched text, not the message article: a long
    // message anchored on its article can leave the match off-screen.
    const scrollTarget = scrollIntoView.mock.contexts.at(-1) as
      Element | undefined
    expect(scrollTarget?.tagName).toBe("MARK")
  })

  it("uses instant match scrolling when reduced motion is requested", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: user1.id, query: "USER_1" }}
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      inline: "nearest",
      behavior: "auto",
    })
  })

  it("aligns the exact assistant match range to the container top inside a long markdown block", () => {
    const scrollIntoView = vi.fn()
    const scrollBy = vi.fn()
    installScrollIntoView(scrollIntoView)
    const originalScrollBy = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollBy",
    )
    Object.defineProperty(Element.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy,
    })

    const originalRangeRect = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getBoundingClientRect",
    )
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => ({
        top: 820,
        bottom: 840,
        left: 0,
        right: 80,
        width: 80,
        height: 20,
        x: 0,
        y: 820,
        toJSON: () => ({}),
      })),
    })
    const elementRectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        top: 100,
        bottom: 500,
        left: 0,
        right: 800,
        width: 800,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      })

    try {
      render(
        <ConversationPane
          path={[
            {
              ...assistant1,
              content: `${"long markdown text ".repeat(100)}NEEDLE tail`,
            },
          ]}
          status="ready"
          canBranch={() => false}
          canEdit={() => false}
          onCreateBranch={vi.fn()}
          onEditAsBranch={vi.fn()}
          transientGeneration={null}
          onRegenerate={vi.fn()}
          reveal={{
            conversationId: "c1",
            nodeId: assistant1.id,
            query: "needle",
          }}
        />,
      )

      expect(scrollBy).toHaveBeenCalledWith({
        top: 720,
        behavior: "smooth",
      })
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (originalRangeRect === undefined) {
        Reflect.deleteProperty(Range.prototype, "getBoundingClientRect")
      } else {
        Object.defineProperty(
          Range.prototype,
          "getBoundingClientRect",
          originalRangeRect,
        )
      }
      elementRectSpy.mockRestore()
      if (originalScrollBy === undefined) {
        Reflect.deleteProperty(Element.prototype, "scrollBy")
      } else {
        Object.defineProperty(Element.prototype, "scrollBy", originalScrollBy)
      }
    }
  })

  it("highlights matches only inside the revealed message", () => {
    const { container } = render(
      <ConversationPane
        path={[user1, assistant1, user2]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-1", query: "USER_1" }}
      />,
    )

    const user1Article = container.querySelector('[data-node-id="user-1"]')
    expect(user1Article?.querySelector("mark")?.textContent).toBe("USER_1")

    const user2Article = container.querySelector('[data-node-id="user-2"]')
    expect(user2Article?.querySelector("mark")).toBeNull()
    expect(user2Article?.textContent).toContain("USER_2_CONTENT")
  })

  it("marks only the first occurrence inside the revealed message", () => {
    const twice: PathMessageView = {
      id: "user-twice",
      role: "user",
      content: "NEEDLE first then needle again",
      createdAt: 2,
      metadata: null,
    }
    const { container } = render(
      <ConversationPane
        path={[user1, twice]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: "user-twice", query: "needle" }}
      />,
    )

    const article = container.querySelector('[data-node-id="user-twice"]')
    const marks = article?.querySelectorAll("mark") ?? []
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe("NEEDLE")
    expect(article?.textContent).toBe("NEEDLE first then needle again")
  })

  it("anchors an assistant highlight in message content, not thinking UI", () => {
    installScrollIntoView(vi.fn())
    class TestHighlight {
      readonly ranges: readonly Range[]

      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    const registry = new Map<string, unknown>()
    vi.stubGlobal("CSS", { highlights: registry })
    vi.stubGlobal("Highlight", TestHighlight)

    render(
      <ConversationPane
        path={[
          {
            ...assistant1,
            thinking: "thinking NEEDLE must not win",
            content: "rendered NEEDLE is the searchable content",
          },
        ]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{
          conversationId: "c1",
          nodeId: assistant1.id,
          query: "needle",
        }}
      />,
    )

    const highlight = registry.get("canopy-search-reveal") as TestHighlight
    expect(highlight.ranges[0]?.toString()).toBe("NEEDLE")
    expect(
      highlight.ranges[0]?.startContainer.parentElement?.closest(
        ".assistant-markdown",
      ),
    ).not.toBeNull()
  })

  it("does not scroll when the reveal carries no node id", () => {
    const scrollIntoView = vi.fn()
    installScrollIntoView(scrollIntoView)

    render(
      <ConversationPane
        path={[user1]}
        status="ready"
        canBranch={() => false}
        canEdit={() => false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        transientGeneration={null}
        onRegenerate={vi.fn()}
        reveal={{ conversationId: "c1", nodeId: null, query: "USER_1" }}
      />,
    )
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    )
    expect(screen.queryByText("USER_1_CONTENT")).toBeInTheDocument()
  })
})
