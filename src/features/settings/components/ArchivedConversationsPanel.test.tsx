import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  ArchivedConversationsPanel,
  type ArchivedConversationsPanelProps,
} from "./ArchivedConversationsPanel"

function panelProps(
  overrides?: Partial<ArchivedConversationsPanelProps>,
): ArchivedConversationsPanelProps {
  return {
    status: "ready",
    items: [
      { id: "archived-1", title: "Archived one", isCurrent: false },
      { id: "archived-2", title: "Archived two", isCurrent: true },
    ],
    error: null,
    disabled: false,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
}

describe("ArchivedConversationsPanel", () => {
  it("renders populated list with current row semantics", () => {
    render(<ArchivedConversationsPanel {...panelProps()} />)

    expect(screen.getByRole("list", { name: "已归档对话列表" })).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: "打开已归档对话：Archived one",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: "打开已归档对话：Archived two",
        current: "page",
      }),
    ).toBeVisible()
  })

  it("renders localized empty state", () => {
    render(
      <ArchivedConversationsPanel
        {...panelProps({ status: "empty", items: [] })}
      />,
    )

    expect(screen.getByText("暂无已归档对话")).toBeVisible()
    expect(
      screen.getByText("归档的对话会显示在这里，仍可只读打开。"),
    ).toBeVisible()
  })

  it("renders loading state", () => {
    render(
      <ArchivedConversationsPanel
        {...panelProps({ status: "loading", items: [] })}
      />,
    )

    expect(screen.getByText("正在加载已归档对话…")).toBeVisible()
  })

  it("renders retryable error state while preserving listed rows", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <ArchivedConversationsPanel
        {...panelProps({
          status: "error",
          error: {
            code: "internal",
            message: "internal",
            retryable: true,
          },
          onRetry,
        })}
      />,
    )

    expect(screen.getByText("Archived one")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "重试加载历史记录" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("opens archived conversation via primary selection", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ArchivedConversationsPanel {...panelProps({ onSelect })} />)

    await user.click(
      screen.getByRole("button", { name: "打开已归档对话：Archived one" }),
    )
    expect(onSelect).toHaveBeenCalledWith("archived-1")
  })

  it("routes rename, unarchive, and delete menu actions by id", async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onUnarchive = vi.fn()
    const onDelete = vi.fn()
    render(
      <ArchivedConversationsPanel
        {...panelProps({ onRename, onUnarchive, onDelete })}
      />,
    )

    await user.click(
      screen.getByRole("button", { name: "已归档对话操作：Archived one" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "重命名" }))
    expect(onRename).toHaveBeenCalledWith("archived-1")

    await user.keyboard("{Escape}")
    await user.click(
      screen.getByRole("button", { name: "已归档对话操作：Archived one" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "取消归档" }))
    expect(onUnarchive).toHaveBeenCalledWith("archived-1")

    await user.keyboard("{Escape}")
    await user.click(
      screen.getByRole("button", { name: "已归档对话操作：Archived one" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    expect(onDelete).toHaveBeenCalledWith("archived-1")
  })
})
