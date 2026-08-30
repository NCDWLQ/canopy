import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MessageNode } from "./MessageNode"
import type { PathMessageView } from "../types"

const assistantMarkdownRender = vi.fn(({ content }: { content: string }) => (
  <div data-testid="assistant-markdown">{content}</div>
))

vi.mock("./AssistantMarkdown", () => ({
  AssistantMarkdown: (props: { content: string }) =>
    assistantMarkdownRender(props),
}))

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

const systemMessage: PathMessageView = {
  id: "system-1",
  role: "system",
  content: "SYSTEM_CONTENT_SENTINEL",
  createdAt: 3,
  metadata: null,
}

const stubClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
  return writeText
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

  it("renders persisted assistant thinking collapsed by default", async () => {
    const user = userEvent.setup()
    render(
      <MessageNode
        message={{ ...assistantMessage, thinking: "THINKING_SENTINEL" }}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
      />,
    )

    expect(screen.getByText("思考过程")).toBeVisible()
    expect(screen.queryByText("THINKING_SENTINEL")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "思考过程" }))
    expect(screen.getByText("THINKING_SENTINEL")).toBeVisible()
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
    const copyBtn = screen.getByRole("button", { name: "复制" })
    expect(regenBtn).toBeVisible()
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
    expect(regenBtn.className).toBe(copyBtn.className)
    expect(regenBtn.parentElement).not.toHaveClass(
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

  it("emits branch intent without replacing the assistant content", async () => {
    const user = userEvent.setup()
    const onCreateBranch = vi.fn()
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={true}
        canEdit={false}
        onCreateBranch={onCreateBranch}
        onEditAsBranch={vi.fn()}
        assistantRegenerationAction={{
          assistantNodeId: assistantMessage.id,
          onSelect: vi.fn(),
        }}
      />,
    )

    expect(screen.getByRole("button", { name: "重新生成" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "从此处创建分支" }))

    expect(onCreateBranch).toHaveBeenCalledWith(assistantMessage.id)
    expect(onCreateBranch).toHaveBeenCalledTimes(1)
    expect(screen.getByText(assistantMessage.content)).toBeVisible()
    expect(screen.getByRole("button", { name: "重新生成" })).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "分支消息内容" }),
    ).not.toBeInTheDocument()
  })

  it("copies user message content and shows copied feedback", async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "复制" }))
    expect(writeText).toHaveBeenCalledWith("USER_CONTENT_SENTINEL")
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible()
  })

  it("copies assistant message content", async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "复制" }))
    expect(writeText).toHaveBeenCalledWith("ASSISTANT_CONTENT_SENTINEL")
  })

  it("does not render copy action for system messages", () => {
    render(
      <MessageNode
        message={systemMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        onExportMessage={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "复制" }),
    ).not.toBeInTheDocument()
  })

  it("renders the export action on assistant messages and reports the node id", async () => {
    const user = userEvent.setup()
    const onExportMessage = vi.fn()
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        onExportMessage={onExportMessage}
      />,
    )

    const exportBtn = screen.getByRole("button", { name: "导出对话至该消息" })
    expect(exportBtn).toBeVisible()
    expect(exportBtn).toHaveAttribute("data-variant", "ghost")
    expect(exportBtn).toHaveAttribute("data-size", "icon")
    expect(exportBtn).toHaveClass(
      "size-7",
      "text-muted-foreground",
      "hover:text-foreground",
    )
    expect(exportBtn).toBeEnabled()

    await user.click(exportBtn)
    expect(onExportMessage).toHaveBeenCalledWith(assistantMessage.id)
    expect(onExportMessage).toHaveBeenCalledTimes(1)
  })

  it("does not render the export action on user messages", () => {
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        onExportMessage={vi.fn()}
      />,
    )

    expect(
      screen.queryByRole("button", { name: "导出对话至该消息" }),
    ).not.toBeInTheDocument()
  })

  it("disables the export action while the conversation is generating", () => {
    render(
      <MessageNode
        message={assistantMessage}
        canBranch={false}
        canEdit={false}
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        onExportMessage={vi.fn()}
        exportDisabled={true}
      />,
    )

    expect(
      screen.getByRole("button", { name: "导出对话至该消息" }),
    ).toBeDisabled()
  })

  it("keeps the export action hidden without an export handler", () => {
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
      screen.queryByRole("button", { name: "导出对话至该消息" }),
    ).not.toBeInTheDocument()
  })

  it("renders the branch switcher when provided and hides it while editing", async () => {
    const user = userEvent.setup()
    render(
      <MessageNode
        message={userMessage}
        canBranch={false}
        canEdit
        onCreateBranch={vi.fn()}
        onEditAsBranch={vi.fn()}
        branchSwitcher={{
          index: 1,
          count: 2,
          onPrev: vi.fn(),
          onNext: vi.fn(),
          prevDisabled: false,
          nextDisabled: true,
        }}
      />,
    )

    expect(screen.getByRole("group", { name: "分支 2/2" })).toBeVisible()

    await user.click(screen.getByRole("button", { name: "编辑为新分支" }))
    expect(
      screen.queryByRole("group", { name: "分支 2/2" }),
    ).not.toBeInTheDocument()
  })

  it("skips rerendering when memoized message props are unchanged", () => {
    assistantMarkdownRender.mockClear()
    const sharedProps = {
      message: assistantMessage,
      canBranch: false,
      canEdit: false,
      onCreateBranch: vi.fn(),
      onEditAsBranch: vi.fn(),
    }
    const { rerender } = render(<MessageNode {...sharedProps} />)
    expect(assistantMarkdownRender).toHaveBeenCalledTimes(1)

    rerender(<MessageNode {...sharedProps} />)
    expect(assistantMarkdownRender).toHaveBeenCalledTimes(1)

    rerender(
      <MessageNode
        {...sharedProps}
        message={{ ...assistantMessage, content: "UPDATED_ASSISTANT_CONTENT" }}
      />,
    )
    expect(assistantMarkdownRender).toHaveBeenCalledTimes(2)
  })
})
