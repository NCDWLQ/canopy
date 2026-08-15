import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { MessageBubble } from "./MessageBubble"

describe("MessageBubble", () => {
  it("renders user messages as right-aligned bubbles with bg-muted and without text label", () => {
    render(
      <MessageBubble role="user" actions={<button>分支</button>}>
        用户问题内容
      </MessageBubble>,
    )

    const article = screen.getByRole("article", { name: "用户消息" })
    expect(article).toBeVisible()
    expect(article).toHaveClass("items-end")
    // Ensure "用户" plain label text is not rendered
    expect(screen.queryByText(/^用户$/)).not.toBeInTheDocument()
    expect(screen.getByText("用户问题内容")).toBeVisible()
    expect(screen.getByText("用户问题内容").closest("div")).toHaveClass(
      "bg-muted",
      "rounded-2xl",
    )
  })

  it("renders assistant messages directly on background with w-full and without text label", () => {
    render(
      <MessageBubble role="assistant" actions={<button>分支</button>}>
        助手回答内容
      </MessageBubble>,
    )

    const article = screen.getByRole("article", { name: "助手消息" })
    expect(article).toBeVisible()
    expect(article).toHaveClass("w-full", "items-start")
    // Ensure "助手" plain label text is not rendered
    expect(screen.queryByText(/^助手$/)).not.toBeInTheDocument()
    expect(screen.getByText("助手回答内容")).toBeVisible()
    expect(article).not.toHaveClass("border", "bg-card")
  })

  it("renders actions inside hover/focus container", () => {
    render(
      <MessageBubble
        role="user"
        actions={<button data-testid="action-btn">操作</button>}
      >
        内容
      </MessageBubble>,
    )

    const actionContainer = screen.getByTestId("action-btn").parentElement
    expect(actionContainer).toHaveClass("opacity-0")
    expect(actionContainer).toHaveClass("group-hover:opacity-100")
  })
})
