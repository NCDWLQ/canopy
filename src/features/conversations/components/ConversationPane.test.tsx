import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

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
})
