import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import { openUrl } from "@tauri-apps/plugin-opener"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { MessageNode } from "./MessageNode"

describe("AssistantMarkdown", () => {
  it("renders CommonMark and GFM content with semantic elements", () => {
    render(
      <AssistantMarkdown
        content={`# 标题

普通 **加粗**、~~删除~~ 与 \`inlineCode()\`。

> 引用

- [x] 已完成
- [ ] 未完成

| 名称 | 值 |
| --- | --- |
| Canopy | 可用 |

---`}
      />,
    )

    expect(screen.getByRole("heading", { name: "标题" })).toBeVisible()
    expect(screen.getByText("加粗")).toHaveAttribute(
      "data-streamdown",
      "strong",
    )
    expect(screen.getByText("删除").closest("del")).not.toBeNull()
    expect(screen.getByText("inlineCode()").tagName).toBe("CODE")
    expect(screen.getByText("引用").closest("blockquote")).not.toBeNull()
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    expect(screen.getByRole("table")).toBeVisible()
  })

  it("renders tables with a single scroll wrapper and a copy dropdown", () => {
    render(
      <AssistantMarkdown
        content={"| 名称 | 值 |\n| --- | --- |\n| Canopy | 可用 |"}
      />,
    )

    const table = screen.getByRole("table")
    expect(table.closest('[data-streamdown="table-wrapper"]')).not.toBeNull()
    expect(table.parentElement).toHaveClass("overflow-x-auto")
    expect(screen.getByRole("button", { name: "复制表格" })).toBeEnabled()
  })

  it("preserves standard Markdown soft-break behavior", () => {
    const { container } = render(
      <AssistantMarkdown content={"第一行\n第二行"} />,
    )

    expect(screen.getByText(/第一行\s*第二行/)).toBeVisible()
    expect(container.querySelector("br")).toBeNull()
  })

  it("keeps system, user, and tool message Markdown markers as plain text", () => {
    for (const role of ["system", "user", "tool"] as const) {
      const marker = `${role} 原始标记`
      const { unmount } = render(
        <MessageNode
          message={{
            id: role,
            role,
            content: `## ${marker}`,
            createdAt: 1,
            metadata: null,
          }}
          canBranch={false}
          canEdit={false}
          onCreateBranch={() => undefined}
          onEditAsBranch={() => undefined}
        />,
      )

      expect(screen.queryByRole("heading", { name: marker })).toBeNull()
      expect(screen.getByText(`## ${marker}`)).toBeVisible()
      unmount()
    }
  })

  it("shows Chinese copy controls without download controls", () => {
    render(
      <AssistantMarkdown
        content={"```typescript\nconst answer: number = 42\n```"}
      />,
    )

    expect(screen.getByText("const answer: number = 42")).toBeVisible()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: /下载|download/i }),
    ).not.toBeInTheDocument()
  })

  it("keeps incomplete emphasis, links, and inline code readable while streaming", () => {
    render(<AssistantMarkdown content={"开始 **强调"} isStreaming />)
    expect(screen.getByText(/开始/)).toBeVisible()
    cleanup()

    render(
      <AssistantMarkdown
        content={"[未完成链接](https://example.com"}
        isStreaming
      />,
    )
    expect(screen.getByText(/未完成链接/)).toBeVisible()
    cleanup()

    render(<AssistantMarkdown content={"`未完成行内代码"} isStreaming />)
    expect(screen.getByText(/未完成行内代码/)).toBeVisible()
  })

  it("disables code copying while a fence is streaming", () => {
    render(
      <AssistantMarkdown
        content={"```typescript\nconst growing ="}
        isStreaming
      />,
    )

    expect(screen.getByText(/const growing =/)).toBeVisible()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeDisabled()
  })

  it("keeps unknown fenced-code languages readable", () => {
    render(
      <AssistantMarkdown content={"```canopy-unknown\nplain fallback\n```"} />,
    )

    expect(screen.getByText("plain fallback")).toBeVisible()
    expect(screen.getByRole("button", { name: "复制代码" })).toBeEnabled()
  })

  it("allows only reviewed absolute link protocols and opens them via plugin-opener on click", async () => {
    const user = userEvent.setup()
    render(
      <AssistantMarkdown
        content={`[安全网页](https://example.com/path)

[安全邮件](mailto:team@example.com)

[脚本](javascript:alert(1)) [数据](data:text/html,bad) [文件](file:///tmp/a) [桌面](tauri://host) [相对](./relative)`}
      />,
    )

    const safeLink = screen.getByRole("link", { name: "安全网页" })
    expect(safeLink).toHaveAttribute("href", "https://example.com/path")
    expect(safeLink).toHaveAttribute("target", "_blank")
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByRole("link", { name: "安全邮件" })).toHaveAttribute(
      "href",
      "mailto:team@example.com",
    )

    await user.click(safeLink)
    expect(openUrl).toHaveBeenCalledWith("https://example.com/path")

    for (const label of ["脚本", "数据", "文件", "桌面", "相对"]) {
      expect(screen.getByText(label, { exact: false }).closest("a")).toBeNull()
    }
  })

  it("renders allowlisted remote Markdown images with no-referrer", () => {
    render(
      <AssistantMarkdown
        content={`![说明](https://example.com/a.png)

![明文图](http://example.com/b.png)`}
      />,
    )

    const httpsImage = screen.getByRole("img", { name: "说明" })
    expect(httpsImage).toHaveAttribute("src", "https://example.com/a.png")
    expect(httpsImage).toHaveAttribute("referrerpolicy", "no-referrer")

    const httpImage = screen.getByRole("img", { name: "明文图" })
    expect(httpImage).toHaveAttribute("src", "http://example.com/b.png")
    expect(httpImage).toHaveAttribute("referrerpolicy", "no-referrer")
  })

  it("renders allowlisted remote images while streaming", () => {
    render(
      <AssistantMarkdown
        content={"![流式图](https://example.com/stream.png)"}
        isStreaming
      />,
    )

    const image = screen.getByRole("img", { name: "流式图" })
    expect(image).toHaveAttribute("src", "https://example.com/stream.png")
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer")
  })

  it("blocks unsafe image schemes and raw HTML without creating loadable img", () => {
    const { container } = render(
      <AssistantMarkdown
        content={`<script>globalThis.compromised = true</script>

<button onclick="globalThis.compromised = true">原始按钮</button>

<img src="https://example.com/raw.png" alt="原始图片" />

![数据图](data:image/png;base64,aaaa)
![文件图](file:///tmp/a.png)
![脚本图](javascript:alert(1))
![相对图](./relative.png)`}
      />,
    )

    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("button[onclick]")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("数据图")).toBeVisible()
    expect(screen.getByText("文件图")).toBeVisible()
    expect(screen.getByText("脚本图")).toBeVisible()
    expect(screen.getByText("相对图")).toBeVisible()
  })
})
