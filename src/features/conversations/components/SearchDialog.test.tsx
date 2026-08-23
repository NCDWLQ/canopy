import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SearchDialog } from "./SearchDialog"
import { createConversationClient } from "@/lib/tauri"

const baseResultDto = {
  conversation_id: "conversation-1",
  title: "西瓜讨论",
  is_archived: false,
  title_matched: false,
  updated_at: 20,
  hits: [
    {
      node_id: "node-1",
      role: "user",
      created_at: 10,
      snippet: "我想查询 西瓜 WATERMELON 的品种",
    },
  ],
}

const titleOnlyResultDto = {
  conversation_id: "conversation-2",
  title: "归档的西瓜总结",
  is_archived: true,
  title_matched: true,
  updated_at: 5,
  hits: [],
}

const searchInput = () => screen.getByLabelText("搜索消息或标题…")

function renderDialog(respond: (query: string) => unknown) {
  const invoke = vi.fn((command: string, args: Record<string, unknown>) => {
    expect(command).toBe("search_conversations")
    const query = (args.request as { query: string }).query
    const value = respond(query)
    return value instanceof Promise ? value : Promise.resolve(value)
  })
  const client = createConversationClient({ invoke })
  const onReveal = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SearchDialog
      open
      onOpenChange={onOpenChange}
      client={client}
      onReveal={onReveal}
    />,
  )
  return { invoke, onReveal, onOpenChange }
}

describe("SearchDialog", () => {
  it("debounces searches and renders grouped results with highlighted snippets", async () => {
    const user = userEvent.setup()
    const { invoke, onReveal } = renderDialog(() => [
      baseResultDto,
      titleOnlyResultDto,
    ])

    expect(
      screen.getByText("输入关键词以搜索消息内容与会话标题。"),
    ).toBeInTheDocument()

    await user.type(searchInput(), "西瓜")
    await waitFor(
      () => {
        expect(invoke).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith("search_conversations", {
          request: { query: "西瓜" },
        })
      },
      { timeout: 2000 },
    )

    expect(screen.getByText("西瓜讨论")).toBeInTheDocument()
    expect(screen.getByText("归档的西瓜总结")).toBeInTheDocument()
    expect(screen.getByText("已归档")).toBeInTheDocument()
    expect(screen.getByText("标题匹配")).toBeInTheDocument()
    expect(screen.getByText("用户")).toBeInTheDocument()
    const mark = screen.getByText("西瓜")
    expect(mark.tagName).toBe("MARK")

    await user.click(screen.getByRole("button", { name: /品种/ }))
    expect(onReveal).toHaveBeenCalledWith("conversation-1", "node-1", "西瓜")
  })

  it("reports the empty state through localized copy", async () => {
    const user = userEvent.setup()
    renderDialog(() => [])

    await user.type(searchInput(), "不存在的词")
    await waitFor(
      () => expect(screen.getByText("没有匹配的会话。")).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  it("maps command failures to the localized code message", async () => {
    const user = userEvent.setup()
    // Rejection mimics the serialized CommandError wire shape the Tauri
    // transport delivers, carried on an Error instance for lint compliance.
    const wireFailure = Object.assign(new Error("会话数据库当前不可用。"), {
      code: "database_unavailable",
      message: "会话数据库当前不可用。",
      retryable: true,
    } as const)
    renderDialog(() => Promise.reject(wireFailure))

    await user.type(searchInput(), "任何")
    await waitFor(
      () =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "会话数据库当前不可用。",
        ),
      { timeout: 2000 },
    )
  })

  it("reveals a title-only hit without a node target and closes", async () => {
    const user = userEvent.setup()
    const { onReveal, onOpenChange } = renderDialog(() => [titleOnlyResultDto])

    await user.type(searchInput(), "西瓜")
    await waitFor(
      () => expect(screen.getByText("归档的西瓜总结")).toBeInTheDocument(),
      { timeout: 2000 },
    )

    await user.click(screen.getByRole("button", { name: "归档的西瓜总结" }))
    expect(onReveal).toHaveBeenCalledWith("conversation-2", null, "西瓜")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("drops stale responses when the query keeps changing", async () => {
    const user = userEvent.setup()
    const slowQuery: {
      resolve: ((value: unknown) => void) | null
    } = { resolve: null }
    renderDialog((query) => {
      if (query !== "西瓜") return []
      // The first query stays pending; the refined query must win.
      return new Promise((resolve) => {
        slowQuery.resolve = resolve
      })
    })

    await user.type(searchInput(), "西瓜")
    await waitFor(() => expect(slowQuery.resolve).not.toBeNull(), {
      timeout: 2000,
    })
    await user.type(searchInput(), "籽")
    await waitFor(
      () => expect(screen.getByText("没有匹配的会话。")).toBeInTheDocument(),
      { timeout: 2000 },
    )

    slowQuery.resolve?.([baseResultDto])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText("西瓜讨论")).not.toBeInTheDocument()
  })
})
