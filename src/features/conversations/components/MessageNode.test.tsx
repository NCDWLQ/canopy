import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MessageNode } from "./MessageNode"
import type { PathMessageView } from "../types"

const userMessage: PathMessageView = {
  id: "user-1",
  role: "user",
  content: "USER_CONTENT_SENTINEL",
  createdAt: 1,
  metadata: null,
}

const assistantMessage: PathMessageView = {
  id: "assistant-1",
  role: "assistant",
  content: "ASSISTANT_CONTENT_SENTINEL",
  createdAt: 2,
  metadata: null,
}

describe("MessageNode", () => {
  it("renders contextual '生成回复' action when provider is ready and triggers onSelect", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        generationAction={{ kind: "generate", onSelect }}
      />,
    )

    const generateBtn = screen.getByRole("button", { name: "生成回复" })
    expect(generateBtn).toBeVisible()
    await user.click(generateBtn)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("renders contextual '配置服务提供商以生成' action when provider is not ready and triggers onSelect", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        generationAction={{ kind: "configure-provider", onSelect }}
      />,
    )

    const configureBtn = screen.getByRole("button", {
      name: "配置服务提供商以生成",
    })
    expect(configureBtn).toBeVisible()
    await user.click(configureBtn)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("does not render generation action when none is provided", () => {
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "配置服务提供商以生成" }),
    ).not.toBeInTheDocument()
  })

  it("hides generation action when entering edit mode", async () => {
    const user = userEvent.setup()
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit={true}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        generationAction={{ kind: "generate", onSelect: vi.fn() }}
      />,
    )

    expect(screen.getByRole("button", { name: "生成回复" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "编辑为新分支" }))
    expect(
      screen.queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
  })

  it("renders the narrow assistant regeneration action with the same disclosed icon style", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={true}
        canEdit={true}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: assistantMessage.id,
          onSelect,
        }}
      />,
    )

    const regenBtn = screen.getByRole("button", { name: "重新生成" })
    const editBtn = screen.getByRole("button", { name: "编辑为新分支" })
    const branchBtn = screen.getByRole("button", { name: "从此处创建分支" })
    expect(regenBtn).toBeVisible()
    expect(regenBtn).toHaveAttribute("title", "重新生成")
    expect(regenBtn).toHaveAttribute("aria-label", "重新生成")
    expect(regenBtn).toHaveAttribute("data-variant", "ghost")
    expect(regenBtn).toHaveAttribute("data-size", "icon")
    expect(regenBtn).toHaveClass(
      "size-7",
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(regenBtn).toHaveTextContent("")
    expect(regenBtn.querySelector("svg")).toHaveClass("size-3.5")
    expect(regenBtn.className).toBe(editBtn.className)
    expect(regenBtn.className).toBe(branchBtn.className)
    expect(regenBtn.parentElement).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "transition-opacity",
    )

    await user.click(regenBtn)
    expect(onSelect).toHaveBeenCalledWith(assistantMessage.id)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("does not render an assistant regeneration action targeted at another node", () => {
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: "another-assistant",
          onSelect: vi.fn(),
        }}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
  })

  it("hides durable '重新生成' when entering branch mode", async () => {
    const user = userEvent.setup()
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={true}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: assistantMessage.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    expect(screen.getByRole("button", { name: "重新生成" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "从此处创建分支" }))
    expect(
      screen.queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
  })
})
