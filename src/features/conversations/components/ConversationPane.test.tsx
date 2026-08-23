import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationPane } from "./ConversationPane"
import type { PathMessageView } from "../types"

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
    Element.prototype.scrollIntoView = scrollIntoView

    beforeEach(() => {
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
    Element.prototype.scrollIntoView = scrollIntoView

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
      expect.objectContaining({ block: "center" }),
    )
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

  it("does not scroll when the reveal carries no node id", () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

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
