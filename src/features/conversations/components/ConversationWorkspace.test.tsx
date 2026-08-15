import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationWorkspace } from "./ConversationWorkspace"
import { useConversationStore } from "../store"
import type { ConversationNodeView, ConversationTreeView } from "../types"
import { useProviderProfileStore } from "@/features/providers/store"
import type { GenerationEventView } from "@/features/providers/types"
import {
  ConversationCommandError,
  createConversationClient,
  createProviderClient,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

vi.mock("@/lib/tauri", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tauri")>()
  return {
    ...original,
    createConversationClient: vi.fn(),
    createProviderClient: vi.fn(),
  }
})

const root: ConversationNodeView = {
  id: "root",
  conversationId: "conversation-1",
  role: "user",
  content: "ROOT_SENTINEL",
  createdAt: 1,
  metadata: null,
}

const assistant: ConversationNodeView = {
  id: "assistant",
  parentId: root.id,
  conversationId: root.conversationId,
  role: "assistant",
  content: "ASSISTANT_SENTINEL",
  createdAt: 2,
  metadata: null,
}

const left: ConversationNodeView = {
  id: "left",
  parentId: assistant.id,
  conversationId: root.conversationId,
  role: "user",
  content: "LEFT_BRANCH_SENTINEL",
  createdAt: 3,
  metadata: null,
}

const right: ConversationNodeView = {
  id: "right",
  parentId: assistant.id,
  conversationId: root.conversationId,
  role: "user",
  content: "RIGHT_BRANCH_SENTINEL",
  createdAt: 4,
  metadata: null,
}

const tree: ConversationTreeView = {
  conversation: {
    id: root.conversationId,
    title: "Branch proof",
    rootNodeId: root.id,
    isArchived: false,
  },
  rootNodeId: root.id,
  nodes: [root, assistant, left, right],
  nodesById: {
    root: {
      id: root.id,
      role: root.role,
      preview: root.content,
      childIds: [assistant.id],
    },
    assistant: {
      id: assistant.id,
      parentId: root.id,
      role: assistant.role,
      preview: assistant.content,
      childIds: [left.id, right.id],
    },
    left: {
      id: left.id,
      parentId: assistant.id,
      role: left.role,
      preview: left.content,
      childIds: [],
    },
    right: {
      id: right.id,
      parentId: assistant.id,
      role: right.role,
      preview: right.content,
      childIds: [],
    },
  },
}

const rootOnlyTree: ConversationTreeView = {
  conversation: {
    id: "new-conversation",
    title: "ONE_USER_ROOT_SENTINEL",
    rootNodeId: "new-root",
    isArchived: false,
  },
  rootNodeId: "new-root",
  nodes: [
    {
      id: "new-root",
      conversationId: "new-conversation",
      role: "user",
      content: "ONE_USER_ROOT_SENTINEL",
      createdAt: 10,
      metadata: null,
    },
  ],
  nodesById: {
    "new-root": {
      id: "new-root",
      role: "user",
      preview: "ONE_USER_ROOT_SENTINEL",
      childIds: [],
    },
  },
}

function createMockClient() {
  return {
    createConversation: vi.fn<ConversationClient["createConversation"]>(),
    appendNode: vi.fn<ConversationClient["appendNode"]>(),
    createBranch: vi.fn<ConversationClient["createBranch"]>(),
    editNodeAsBranch: vi.fn<ConversationClient["editNodeAsBranch"]>(),
    listConversations: vi
      .fn<ConversationClient["listConversations"]>()
      .mockResolvedValue([]),
    loadConversationTree: vi
      .fn<ConversationClient["loadConversationTree"]>()
      .mockResolvedValue(tree),
    loadActivePath: vi.fn<ConversationClient["loadActivePath"]>(),
    archiveConversation: vi.fn<ConversationClient["archiveConversation"]>(),
  } satisfies ConversationClient
}

function createMockProviderClient() {
  return {
    saveProviderProfile: vi.fn<ProviderClient["saveProviderProfile"]>(),
    loadProviderProfile: vi
      .fn<ProviderClient["loadProviderProfile"]>()
      .mockRejectedValue(
        new ConversationCommandError({
          code: "not_found",
          message: "Provider profile not found.",
          retryable: false,
        }),
      ),
    deleteProviderProfile: vi.fn<ProviderClient["deleteProviderProfile"]>(),
    generateFromActivePath: vi.fn<ProviderClient["generateFromActivePath"]>(),
    cancelGeneration: vi.fn<ProviderClient["cancelGeneration"]>(),
    commitGeneration: vi.fn<ProviderClient["commitGeneration"]>(),
  } satisfies ProviderClient
}

function resetStore() {
  useConversationStore.setState({
    isCreatingConversation: false,
    conversationId: null,
    isArchived: false,
    rootNodeId: null,
    activeNodeId: null,
    nodesById: {},
    fullNodes: {},
    expandedIds: new Set(),
    status: "idle",
    error: null,
    generation: { phase: "idle" },
    history: { status: "idle", summaries: [], error: null },
  })
  useProviderProfileStore.setState({ phase: "idle", profile: null })
}

describe("ConversationWorkspace", () => {
  let client: ReturnType<typeof createMockClient>
  let providerClient: ReturnType<typeof createMockProviderClient>

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    client = createMockClient()
    providerClient = createMockProviderClient()
    vi.mocked(createConversationClient).mockReturnValue(client)
    vi.mocked(createProviderClient).mockReturnValue(providerClient)
    resetStore()
  })

  it("restores persisted history once on a clean StrictMode mount", async () => {
    let resolveTree: ((value: ConversationTreeView) => void) | undefined
    client.listConversations.mockResolvedValueOnce([
      {
        ...tree.conversation,
        updatedAt: right.createdAt,
      },
    ])
    client.loadConversationTree.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTree = resolve
      }),
    )

    render(
      <StrictMode>
        <ConversationWorkspace />
      </StrictMode>,
    )

    expect(screen.getByText("正在加载会话历史记录…")).toBeVisible()
    await waitFor(() => {
      expect(client.listConversations).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledWith(
        tree.conversation.id,
      )
    })
    expect(screen.getByText("正在加载会话历史记录…")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "开始新会话" }),
    ).not.toBeInTheDocument()

    act(() => {
      resolveTree?.(tree)
    })
    const pane = await screen.findByTestId("conversation-pane")
    expect(
      screen.getByRole("button", { name: "Branch proof" }),
    ).toHaveAttribute("aria-current", "page")
    expect(within(pane).getByText(right.content)).toBeVisible()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "开始新会话" }),
    ).not.toBeInTheDocument()
  })

  it("opens global Settings from the persistent sidebar footer only", async () => {
    const user = userEvent.setup()
    render(<ConversationWorkspace />)
    const sidebar = screen.getByRole("complementary", {
      name: "会话树侧栏",
    })

    const settingsButton = within(sidebar).getByRole("button", {
      name: "设置",
    })
    expect(settingsButton).toBeVisible()
    expect(settingsButton.closest("footer")).not.toBeNull()
    expect(screen.getAllByRole("button", { name: "设置" })).toHaveLength(1)
    expect(
      screen.queryByRole("button", { name: "服务提供商" }),
    ).not.toBeInTheDocument()

    await user.click(settingsButton)
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    expect(screen.getByRole("heading", { name: "服务提供商" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "关闭" }))

    await user.click(screen.getByRole("button", { name: "收起侧栏" }))
    expect(
      within(sidebar).queryByRole("button", { name: "设置" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "展开侧栏" }))
    expect(within(sidebar).getByRole("button", { name: "设置" })).toBeVisible()
  })

  it("switches history without leaking nodes from the prior conversation", async () => {
    const user = userEvent.setup()
    const otherRoot: ConversationNodeView = {
      id: "other-root",
      conversationId: "conversation-other",
      role: "user",
      content: "OTHER_CONVERSATION_SENTINEL",
      createdAt: 8,
      metadata: null,
    }
    const otherTree: ConversationTreeView = {
      conversation: {
        id: otherRoot.conversationId,
        title: "Other history",
        rootNodeId: otherRoot.id,
        isArchived: true,
      },
      rootNodeId: otherRoot.id,
      nodes: [otherRoot],
      nodesById: {
        [otherRoot.id]: {
          id: otherRoot.id,
          role: otherRoot.role,
          preview: otherRoot.content,
          childIds: [],
        },
      },
    }
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
      { ...otherTree.conversation, updatedAt: otherRoot.createdAt },
    ])
    client.loadConversationTree.mockImplementation((id) =>
      Promise.resolve(id === otherTree.conversation.id ? otherTree : tree),
    )
    render(<ConversationWorkspace />)
    const initialPane = await screen.findByTestId("conversation-pane")
    await within(initialPane).findByText(right.content)

    await user.click(screen.getByRole("button", { name: /Other history/ }))

    const pane = await screen.findByTestId("conversation-pane")
    await waitFor(() => {
      expect(within(pane).getByText(otherRoot.content)).toBeVisible()
    })
    expect(within(pane).queryByText(root.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(screen.getByText("已归档 — 只读")).toBeVisible()
  })

  it("shows a retryable discovery error instead of the empty form", async () => {
    const user = userEvent.setup()
    client.listConversations.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "History is temporarily unavailable.",
        retryable: true,
      }),
    )
    render(<ConversationWorkspace />)

    const sidebar = screen.getByLabelText("会话树侧栏")
    expect(
      await within(sidebar).findByRole("button", {
        name: "重试加载历史记录",
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "开始新会话" }),
    ).not.toBeInTheDocument()

    client.listConversations.mockResolvedValueOnce([])
    await user.click(
      within(sidebar).getByRole("button", { name: "重试加载历史记录" }),
    )
    expect(
      await screen.findByRole("heading", { name: "开始新会话" }),
    ).toBeVisible()
  })

  it("renders the exact selected path in order and excludes its sibling", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)

    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    const messages = within(pane).getAllByRole("article")
    expect(messages).toHaveLength(3)
    expect(messages.map((message) => message.textContent)).toEqual([
      expect.stringContaining(root.content),
      expect.stringContaining(assistant.content),
      expect.stringContaining(right.content),
    ])
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
  })

  it("renders Markdown only for durable assistant messages", async () => {
    const markdownTree: ConversationTreeView = {
      ...tree,
      nodes: tree.nodes.map((node) => {
        if (node.id === assistant.id) {
          return { ...node, content: "## 助手富文本标题" }
        }
        if (node.id === root.id) {
          return { ...node, content: "## 用户原始标记" }
        }
        return node
      }),
    }
    client.loadConversationTree.mockResolvedValueOnce(markdownTree)
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)

    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    expect(
      within(pane).getByRole("heading", { name: "助手富文本标题" }),
    ).toBeVisible()
    expect(
      within(pane).queryByRole("heading", { name: "用户原始标记" }),
    ).not.toBeInTheDocument()
    expect(within(pane).getByText("## 用户原始标记")).toBeVisible()
  })

  it("supports roving tree focus and arrow-key parent/child navigation", async () => {
    const user = userEvent.setup()
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    render(<ConversationWorkspace />)

    const rootItem = screen.getByRole("treeitem", { name: /ROOT_SENTINEL/ })
    rootItem.focus()
    await user.keyboard("{ArrowDown}")

    const assistantItem = screen.getByRole("treeitem", {
      name: /ASSISTANT_SENTINEL/,
    })
    expect(assistantItem).toHaveFocus()
    expect(assistantItem).toHaveAttribute("tabindex", "0")

    await user.keyboard("{ArrowRight}")
    expect(assistantItem).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")

    const rightItem = screen.getByRole("treeitem", {
      name: /RIGHT_BRANCH_SENTINEL/,
    })
    expect(rightItem).toHaveFocus()
    expect(rightItem).toHaveAttribute("aria-selected", "true")
    expect(
      within(screen.getByTestId("conversation-pane")).queryByText(left.content),
    ).not.toBeInTheDocument()

    await user.keyboard("{ArrowLeft}")
    expect(assistantItem).toHaveFocus()
  })

  it("keeps an archived conversation readable and disables every write affordance", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, isArchived: true },
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)

    render(<ConversationWorkspace />)

    expect(screen.getByRole("button", { name: "新建会话" })).toBeVisible()
    expect(screen.getByText("已归档 — 只读")).toBeVisible()
    expect(
      within(screen.getByTestId("conversation-pane")).getByText(right.content),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "归档" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "编辑为新分支" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /从此处创建分支/ }),
    ).not.toBeInTheDocument()
  })

  it("edits as a new sibling while preserving the historical source", async () => {
    const user = userEvent.setup()
    const edited: ConversationNodeView = {
      ...right,
      id: "right-edited",
      content: "RIGHT_EDITED_SENTINEL",
      createdAt: 5,
    }
    client.editNodeAsBranch.mockResolvedValueOnce(edited)
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    await user.click(screen.getByRole("button", { name: "编辑为新分支" }))
    const input = screen.getByRole("textbox", {
      name: "编辑消息内容",
    })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, edited.content)
    await user.click(screen.getByRole("button", { name: "保存为新分支" }))

    await waitFor(() => {
      expect(
        within(screen.getByTestId("conversation-pane")).getByText(
          edited.content,
        ),
      ).toBeVisible()
    })
    expect(client.editNodeAsBranch).toHaveBeenCalledWith({
      conversationId: root.conversationId,
      sourceNodeId: right.id,
      content: edited.content,
    })
    expect(useConversationStore.getState().fullNodes[right.id]).toEqual(right)
    expect(useConversationStore.getState().fullNodes[edited.id]).toEqual(edited)
  })

  it("creates only the returned user root and keeps generation unavailable without a provider", async () => {
    const user = userEvent.setup()
    client.createConversation.mockResolvedValueOnce(rootOnlyTree)
    render(<ConversationWorkspace />)

    const composer = await screen.findByRole("textbox", {
      name: "消息输入框",
    })
    expect(screen.getByRole("button", { name: "新建会话" })).toBeVisible()
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("First message")).not.toBeInTheDocument()
    await user.type(composer, "ONE_USER_ROOT_SENTINEL")
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(
        within(screen.getByTestId("conversation-pane")).getByText(
          "ONE_USER_ROOT_SENTINEL",
        ),
      ).toBeVisible()
    })
    expect(client.createConversation).toHaveBeenCalledWith({
      title: "ONE_USER_ROOT_SENTINEL",
      content: "ONE_USER_ROOT_SENTINEL",
    })
    expect(screen.queryByLabelText("助手消息")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
  })

  it("switches a loaded conversation to a blank Composer without clearing its projection", async () => {
    const user = userEvent.setup()
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    render(<ConversationWorkspace />)
    await within(await screen.findByTestId("conversation-pane")).findByText(
      right.content,
    )
    const before = useConversationStore.getState()

    await user.click(screen.getByRole("button", { name: "新建会话" }))

    expect(screen.getByTestId("blank-conversation-pane")).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    const creating = useConversationStore.getState()
    expect(creating.isCreatingConversation).toBe(true)
    expect(creating.conversationId).toBe(before.conversationId)
    expect(creating.activeNodeId).toBe(before.activeNodeId)
    expect(creating.nodesById).toBe(before.nodesById)
    expect(creating.history).toBe(before.history)

    await user.click(screen.getByRole("button", { name: "Branch proof" }))
    await waitFor(() => {
      expect(screen.getByTestId("conversation-pane")).toBeVisible()
      expect(useConversationStore.getState().isCreatingConversation).toBe(false)
    })
  })

  it("derives a scalar-safe title while preserving the complete first prompt", async () => {
    const user = userEvent.setup()
    const prompt = `\u{3000}${"🙂".repeat(39)}界   full prompt tail\n`
    const expectedTitle = `${"🙂".repeat(39)}界…`
    client.createConversation.mockResolvedValueOnce({
      ...rootOnlyTree,
      conversation: { ...rootOnlyTree.conversation, title: expectedTitle },
      nodes: [{ ...rootOnlyTree.nodes[0]!, content: prompt }],
      nodesById: {
        "new-root": {
          ...rootOnlyTree.nodesById["new-root"]!,
          preview: prompt,
        },
      },
    })
    render(<ConversationWorkspace />)
    const composer = await screen.findByRole("textbox", {
      name: "消息输入框",
    })

    await user.type(composer, prompt)
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.createConversation).toHaveBeenCalledWith({
        title: expectedTitle,
        content: prompt,
      })
    })
  })

  it("retains the first Composer draft for a safe retry after creation failure", async () => {
    const user = userEvent.setup()
    client.createConversation
      .mockRejectedValueOnce(
        new ConversationCommandError({
          code: "database_unavailable",
          message: "Conversation could not be saved.",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce(rootOnlyTree)
    render(<ConversationWorkspace />)
    const composer = await screen.findByRole("textbox", {
      name: "消息输入框",
    })
    await user.type(composer, rootOnlyTree.nodes[0]!.content)

    await user.click(screen.getByRole("button", { name: "发送消息" }))

    expect(
      await screen.findByText("Conversation could not be saved."),
    ).toBeVisible()
    expect(composer).toHaveValue(rootOnlyTree.nodes[0]!.content)
    expect(composer).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "发送消息" }))
    await waitFor(() => {
      expect(client.createConversation).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId("conversation-pane")).toBeVisible()
    })
  })

  it("keeps the New conversation action available for all-archived history", async () => {
    client.listConversations.mockResolvedValueOnce([
      {
        ...tree.conversation,
        isArchived: true,
        updatedAt: right.createdAt,
      },
    ])
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, isArchived: true },
    })

    render(<ConversationWorkspace />)

    expect(
      await screen.findByRole("button", { name: "新建会话" }),
    ).toBeEnabled()
    expect(await screen.findByText("已归档 — 只读")).toBeVisible()
  })

  it("visually truncates history titles and exposes the complete title on hover and focus", async () => {
    const user = userEvent.setup()
    const longTitle =
      "A complete automatic conversation title that is wider than the sidebar"
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, title: longTitle, updatedAt: right.createdAt },
    ])
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, title: longTitle },
    })
    render(<ConversationWorkspace />)
    const historyButton = await screen.findByRole("button", { name: longTitle })
    const title = within(historyButton).getByText(longTitle)

    expect(title).toHaveClass("truncate")
    await user.hover(historyButton)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(longTitle)
    await user.unhover(historyButton)
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })
    act(() => historyButton.focus())
    expect(await screen.findByRole("tooltip")).toHaveTextContent(longTitle)
  })

  it("renders one transient response and merges only the authoritative completion", async () => {
    const user = userEvent.setup()
    const generationId = "11111111-1111-4111-8111-111111111111"
    const commitToken = "22222222-2222-4222-8222-222222222222"
    const visibleStreamedContent = "WORKSPACE_STREAM_SENTINEL"
    const streamedContent = `## ${visibleStreamedContent}`
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.loadProviderProfile.mockReset()
    providerClient.loadProviderProfile.mockResolvedValue({
      baseEndpoint: "http://127.0.0.1:7788/v1",
      model: "fixture-model",
      hasApiKey: false,
      updatedAt: 10,
    })
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValue({ accepted: true })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const generateButton = await screen.findByRole("button", {
      name: "生成",
    })
    await waitFor(() => expect(generateButton).toBeEnabled())
    await user.click(generateButton)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      root.conversationId,
      right.id,
      expect.any(Function),
    )

    act(() => {
      onEvent!({
        type: "started",
        generationId,
        conversationId: root.conversationId,
        activeNodeId: right.id,
        model: "fixture-model",
      })
      onEvent!({ type: "delta", generationId, content: streamedContent })
    })

    const pane = screen.getByTestId("conversation-pane")
    const transientArticle = within(pane)
      .getByRole("heading", { name: visibleStreamedContent })
      .closest("article")
    expect(transientArticle).toHaveAccessibleName("助手消息")
    expect(
      within(pane).getAllByRole("article", { name: "助手消息" }),
    ).toHaveLength(2)
    expect(transientArticle).toHaveClass("w-full")
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(pane).not.toHaveTextContent("Not saved")
    expect(pane).not.toHaveTextContent("Saving the accepted response")
    expect(
      Object.values(useConversationStore.getState().fullNodes).some(
        (node) => node.content === streamedContent,
      ),
    ).toBe(false)

    const completed: ConversationNodeView = {
      id: "workspace-completed",
      parentId: right.id,
      conversationId: root.conversationId,
      role: "assistant",
      content: streamedContent,
      model: "fixture-model",
      createdAt: 5,
      metadata: null,
    }
    act(() => {
      onEvent!({ type: "ready_to_commit", generationId, commitToken })
    })
    await waitFor(() => {
      expect(providerClient.commitGeneration).toHaveBeenCalledWith(
        generationId,
        commitToken,
      )
    })
    act(() => {
      onEvent!({ type: "completed", generationId, node: completed })
    })

    await waitFor(() => {
      expect(
        within(pane).getByRole("heading", { name: visibleStreamedContent }),
      ).toBeVisible()
    })
    const authoritativeArticle = within(pane)
      .getByRole("heading", { name: visibleStreamedContent })
      .closest("article")
    expect(authoritativeArticle).toHaveAccessibleName("助手消息")
    expect(authoritativeArticle).toHaveClass("w-full")
    expect(
      within(pane).getAllByRole("article", { name: "助手消息" }),
    ).toHaveLength(2)
    expect(useConversationStore.getState().fullNodes[completed.id]).toEqual(
      completed,
    )
    expect(document.body).not.toHaveTextContent(commitToken)
  })

  it("projects every terminal phase through the ordinary assistant message surface", async () => {
    const user = userEvent.setup()
    const generationId = "11111111-1111-4111-8111-111111111111"
    const run = {
      runId: 41,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      generationId,
      model: "fixture-model",
    } as const
    const recoveryError = {
      code: "network_failure" as const,
      message: "Internal recovery detail that must stay hidden.",
      retryable: true,
    }
    const retryLoad = new Promise<ConversationTreeView>(() => undefined)

    providerClient.loadProviderProfile.mockReset()
    providerClient.loadProviderProfile.mockResolvedValue({
      baseEndpoint: "http://127.0.0.1:7788/v1",
      model: run.model,
      hasApiKey: false,
      updatedAt: 10,
    })
    providerClient.generateFromActivePath.mockReturnValue(
      new Promise(() => undefined),
    )
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "生成" })).toBeEnabled()
    })
    const pane = screen.getByTestId("conversation-pane")

    act(() => {
      useConversationStore.setState({
        generation: { ...run, phase: "starting" },
      })
    })
    expect(within(pane).getByText("正在思考")).toBeVisible()

    act(() => {
      useConversationStore.setState({
        generation: { ...run, phase: "streaming", content: "PARTIAL_REPLY" },
      })
    })
    expect(within(pane).getByText("PARTIAL_REPLY")).toBeVisible()
    expect(within(pane).queryByText("正在思考")).not.toBeInTheDocument()

    act(() => {
      useConversationStore.setState({
        generation: { ...run, phase: "committing", content: "FULL_REPLY" },
      })
    })
    expect(within(pane).getByText("FULL_REPLY")).toBeVisible()
    expect(within(pane).queryByRole("status")).not.toBeInTheDocument()

    act(() => {
      useConversationStore.setState({
        generation: {
          ...run,
          phase: "reconciling",
          content: "FULL_REPLY",
          error: recoveryError,
          needsUserAction: false,
        },
      })
    })
    expect(within(pane).getByText("正在恢复这条回复…")).toBeVisible()
    expect(
      within(pane).queryByRole("button", { name: "重试恢复" }),
    ).not.toBeInTheDocument()

    act(() => {
      useConversationStore.setState({
        generation: {
          phase: "failed",
          runId: run.runId,
          failureKind: "generation",
          error: recoveryError,
        },
      })
    })
    expect(within(pane).getByText("回复失败")).toBeVisible()
    expect(within(pane).queryByText("FULL_REPLY")).not.toBeInTheDocument()
    await user.click(within(pane).getByRole("button", { name: "重新生成" }))
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      root.conversationId,
      right.id,
      expect.any(Function),
    )

    act(() => {
      useConversationStore.setState({
        generation: {
          phase: "failed",
          runId: run.runId,
          failureKind: "persistence",
          content: "FULL_REPLY",
          error: recoveryError,
        },
      })
    })
    expect(within(pane).getByText("FULL_REPLY")).toBeVisible()
    expect(within(pane).getByText("这条回复未能保存")).toBeVisible()
    expect(within(pane).getByRole("button", { name: "重新生成" })).toBeEnabled()

    act(() => {
      useConversationStore.setState({
        generation: {
          phase: "cancelled",
          runId: run.runId,
          content: "PARTIAL_REPLY",
        },
      })
    })
    expect(within(pane).getByText("PARTIAL_REPLY")).toBeVisible()
    expect(within(pane).getByText("回复已停止")).toBeVisible()

    client.loadConversationTree.mockClear()
    client.loadConversationTree.mockReturnValueOnce(retryLoad)
    act(() => {
      useConversationStore.setState({
        generation: {
          ...run,
          phase: "reconciling",
          content: "FULL_REPLY",
          error: recoveryError,
          needsUserAction: true,
        },
      })
    })
    await user.click(within(pane).getByRole("button", { name: "重试恢复" }))
    expect(client.loadConversationTree).toHaveBeenCalledWith(
      root.conversationId,
    )
    expect(
      within(pane).queryByRole("button", { name: "重试恢复" }),
    ).not.toBeInTheDocument()

    expect(pane).not.toHaveTextContent(recoveryError.message)
    expect(pane).not.toHaveTextContent("Not saved")
    expect(pane).not.toHaveTextContent("database")
    expect(document.body).not.toHaveTextContent(generationId)
  })

  it("renders an integrity recovery state without leaking any path", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    const disconnectedNodes = {
      ...useConversationStore.getState().fullNodes,
    }
    delete disconnectedNodes[assistant.id]
    useConversationStore.setState({ fullNodes: disconnectedNodes })

    render(<ConversationWorkspace />)

    expect(screen.getAllByText("无法安全显示会话树。")).toHaveLength(2)
    const pane = screen.getByTestId("conversation-pane")
    expect(within(pane).queryByText(root.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(pane).not.toHaveTextContent("tree_integrity")
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
  })

  it("uses instant scrolling when reduced motion is requested", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)

    render(<ConversationWorkspace />)

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto" })
  })
})
