import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationWorkspace } from "./ConversationWorkspace"
import { messageNodeRenderProbe } from "./messageNodeRenderProbe"
import { workspaceRenderProbe } from "./workspaceRenderProbe"
import { useConversationStore, type GenerationRun } from "../store"
import type { ConversationNodeView, ConversationTreeView } from "../types"
import { useProviderStore } from "@/features/providers/store"
import type {
  GenerationEventView,
  ProviderView,
} from "@/features/providers/types"
import {
  ConversationCommandError,
  createConversationClient,
  createProviderClient,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
)

afterEach(() => {
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

const provider: ProviderView = {
  id: "provider-1",
  name: "Fixture provider",
  protocol: "openai_compatible",
  baseEndpoint: "http://127.0.0.1:7788/v1",
  model: "fixture-model",
  models: ["fixture-model"],
  hasApiKey: false,
  createdAt: 10,
  updatedAt: 11,
}

function configureActiveProvider(next: ProviderView = provider) {
  useProviderStore.setState({
    phase: "ready",
    providers: [next],
    activeProviderId: next.id,
  })
}

function clearActiveProvider() {
  useProviderStore.setState({
    phase: "unconfigured",
    providers: [],
    activeProviderId: null,
  })
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
    renameConversation: vi.fn<ConversationClient["renameConversation"]>(),
    deleteConversation: vi
      .fn<ConversationClient["deleteConversation"]>()
      .mockResolvedValue({ conversationId: root.conversationId }),
    deleteConversationNode: vi
      .fn<ConversationClient["deleteConversationNode"]>()
      .mockResolvedValue({ nodeId: left.id }),
    unarchiveConversation: vi
      .fn<ConversationClient["unarchiveConversation"]>()
      .mockResolvedValue(tree.conversation),
    searchConversations: vi
      .fn<ConversationClient["searchConversations"]>()
      .mockResolvedValue([]),
    writeExportFile: vi
      .fn<ConversationClient["writeExportFile"]>()
      .mockResolvedValue({ bytesWritten: 0 }),
    setConversationProvider: vi
      .fn<NonNullable<ConversationClient["setConversationProvider"]>>()
      .mockResolvedValue({
        id: root.conversationId,
        providerId: null,
        model: null,
        reasoningEffort: null,
      }),
    setConversationSystemPrompt:
      vi.fn<ConversationClient["setConversationSystemPrompt"]>(),
  } satisfies ConversationClient
}

function createMockProviderClient() {
  return {
    listProviders: vi.fn<ProviderClient["listProviders"]>().mockResolvedValue({
      providers: [provider],
      activeProviderId: provider.id,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      defaultSystemPrompt: null,
    }),
    saveProvider: vi.fn<ProviderClient["saveProvider"]>(),
    deleteProvider: vi.fn<ProviderClient["deleteProvider"]>(),
    setActiveProvider: vi.fn<ProviderClient["setActiveProvider"]>(),
    setAutoGenerateTitle: vi.fn<ProviderClient["setAutoGenerateTitle"]>(),
    setTitleModelBinding: vi.fn<ProviderClient["setTitleModelBinding"]>(),
    setLanguage: vi.fn<ProviderClient["setLanguage"]>(),
    setTheme: vi.fn<ProviderClient["setTheme"]>(),
    setDefaultSystemPrompt: vi.fn<ProviderClient["setDefaultSystemPrompt"]>(),
    revealProviderApiKey: vi
      .fn<ProviderClient["revealProviderApiKey"]>()
      .mockResolvedValue(null),
    listProviderModels: vi.fn<ProviderClient["listProviderModels"]>(),
    generateFromActivePath: vi.fn<ProviderClient["generateFromActivePath"]>(),
    cancelGeneration: vi
      .fn<ProviderClient["cancelGeneration"]>()
      .mockResolvedValue({ accepted: true }),
  } satisfies ProviderClient
}

function resetStore() {
  useConversationStore.setState({
    isCreatingConversation: false,
    conversationId: null,
    title: null,
    isArchived: false,
    providerId: null,
    model: null,
    reasoningEffort: null,
    systemPrompt: null,
    draftBinding: null,
    draftReasoningEffort: null,
    draftSystemPrompt: null,
    rootNodeId: null,
    activeNodeId: null,
    nodesById: {},
    fullNodes: {},
    expandedIds: new Set(),
    status: "idle",
    error: null,
    generationRuns: {},
    history: { status: "idle", summaries: [], error: null },
  })
  useProviderStore.setState({
    phase: "idle",
    providers: [],
    activeProviderId: null,
    autoGenerateTitle: true,
    titleModelBinding: null,
    defaultSystemPrompt: null,
  })
}

function seedGenerationRun(run: GenerationRun) {
  useConversationStore.setState((state) => ({
    generationRuns: { ...state.generationRuns, [run.conversationId]: run },
  }))
}

describe("ConversationWorkspace", () => {
  let client: ReturnType<typeof createMockClient>
  let providerClient: ReturnType<typeof createMockProviderClient>

  beforeEach(() => {
    workspaceRenderProbe.count = 0
    messageNodeRenderProbe.reset()
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

    expect(screen.getByText("正在加载对话历史记录…")).toBeVisible()
    await waitFor(() => {
      expect(client.listConversations).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledWith(
        tree.conversation.id,
      )
    })
    expect(screen.getByText("正在加载对话历史记录…")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "开始新对话" }),
    ).not.toBeInTheDocument()

    act(() => {
      resolveTree?.(tree)
    })
    const pane = await screen.findByTestId("conversation-pane")
    const currentHistoryRow = screen.getByRole("button", {
      name: "Branch proof",
    })
    expect(currentHistoryRow).toHaveAttribute("aria-current", "page")
    // The row surface (hover/selected pill) lives on the wrapper so hovering
    // the archive action keeps the row highlighted.
    expect(currentHistoryRow.parentElement).toHaveClass("bg-sidebar-accent")
    expect(within(pane).getByText(right.content)).toBeVisible()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "开始新对话" }),
    ).not.toBeInTheDocument()
  })

  it("opens global Settings from the persistent sidebar footer only", async () => {
    const user = userEvent.setup()
    render(<ConversationWorkspace />)
    const sidebar = screen.getByRole("complementary", {
      name: "对话侧栏",
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
    // The dialog opens on the general category; provider settings are one
    // nav click away.
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "关闭" }))

    await user.click(screen.getByRole("button", { name: "收起侧栏" }))
    expect(
      within(sidebar).queryByRole("button", { name: "设置" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "展开侧栏" }))
    expect(within(sidebar).getByRole("button", { name: "设置" })).toBeVisible()
  })

  it("opens SettingsDialog from the provider picker manage action directly to the providers panel", async () => {
    const user = userEvent.setup()
    render(<ConversationWorkspace />)
    await user.click(
      await screen.findByRole("button", { name: "选择模型与推理强度" }),
    )
    expect(screen.getByRole("button", { name: "对话设置" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "管理模型提供商" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    expect(
      screen.getByRole("button", { name: "模型提供商", current: "page" }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "全部提供商" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    const sidebar = screen.getByRole("complementary", { name: "对话侧栏" })
    await user.click(within(sidebar).getByRole("button", { name: "设置" }))
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    expect(
      screen.getByRole("button", { name: "通用", current: "page" }),
    ).toBeVisible()
  })

  it("renders new conversation button in main header when sidebar is collapsed and triggers conversation creation", async () => {
    const user = userEvent.setup()
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    render(<ConversationWorkspace />)
    await within(await screen.findByTestId("conversation-pane")).findByText(
      right.content,
    )

    const sidebar = screen.getByRole("complementary", { name: "对话侧栏" })
    expect(within(sidebar).getByText("Canopy")).toBeVisible()
    expect(within(sidebar).getByText("历史记录")).toBeVisible()
    expect(within(sidebar).queryByText("对话树")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText(root.content)).not.toBeInTheDocument()
    expect(
      within(sidebar).getByRole("button", { name: "新建对话" }),
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "收起侧栏" }))

    const newChatButton = screen.getByRole("button", { name: "新建对话" })
    expect(newChatButton).toBeVisible()

    await user.click(newChatButton)

    expect(screen.getByTestId("blank-conversation-pane")).toBeVisible()
    expect(useConversationStore.getState().isCreatingConversation).toBe(true)
    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" }),
    ).toBeVisible()
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

    await user.click(screen.getByRole("button", { name: /^Other history/ }))

    const pane = await screen.findByTestId("conversation-pane")
    await waitFor(() => {
      expect(within(pane).getByText(otherRoot.content)).toBeVisible()
    })
    expect(within(pane).queryByText(root.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(screen.getByText("已归档 — 只读")).toBeVisible()
  })

  it("keeps streaming in the background across sidebar switches and re-attaches on return", async () => {
    const user = userEvent.setup()
    const generationId = "44444444-4444-4444-8444-444444444444"
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const otherRoot: ConversationNodeView = {
      id: "bg-other-root",
      conversationId: "conversation-bg-other",
      role: "user",
      content: "BG_OTHER_SENTINEL",
      createdAt: 8,
      metadata: null,
    }
    const otherTree: ConversationTreeView = {
      conversation: {
        id: otherRoot.conversationId,
        title: "Other history",
        rootNodeId: otherRoot.id,
        isArchived: false,
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
    configureActiveProvider()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return new Promise(() => undefined)
      },
    )
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
      { ...otherTree.conversation, updatedAt: 2 },
    ])
    client.loadConversationTree.mockImplementation((id) =>
      Promise.resolve(id === otherTree.conversation.id ? otherTree : tree),
    )

    render(<ConversationWorkspace />)
    const pane = await screen.findByTestId("conversation-pane")
    await within(pane).findByText(right.content)

    await user.click(within(pane).getByRole("button", { name: "生成回复" }))
    act(() => {
      onEvent!({
        type: "started",
        generationId,
        conversationId: root.conversationId,
        activeNodeId: right.id,
        model: "fixture-model",
      })
    })
    act(() => {
      onEvent!({ type: "delta", generationId, content: "BACKGROUND_PART_" })
    })
    expect(within(pane).getByText("BACKGROUND_PART_")).toBeVisible()

    // The generating row shows a running indicator and every row stays
    // clickable while the run is active. The "…" menu trigger carries the
    // row title in its accessible name, so title queries stay exact.
    const generatingRow = screen
      .getByRole("button", { name: /^Branch proof/ })
      .closest("li")
    expect(generatingRow).not.toBeNull()
    expect(
      within(generatingRow!).getByRole("status", { name: "正在生成回复" }),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "新建对话" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: /^Other history/ }))
    await waitFor(() => {
      expect(within(pane).getByText(otherRoot.content)).toBeVisible()
    })
    expect(within(pane).queryByText("BACKGROUND_PART_")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()

    // The background run keeps accumulating while another conversation is
    // loaded.
    act(() => {
      onEvent!({ type: "delta", generationId, content: "MORE" })
    })

    await user.click(screen.getByRole("button", { name: /^Branch proof/ }))
    await waitFor(() => {
      expect(within(pane).getByText("BACKGROUND_PART_MORE")).toBeVisible()
    })
    expect(screen.getByRole("button", { name: "停止生成" })).toBeEnabled()
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

    const sidebar = screen.getByLabelText("对话侧栏")
    expect(
      await within(sidebar).findByRole("button", {
        name: "重试加载历史记录",
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "开始新对话" }),
    ).not.toBeInTheDocument()

    client.listConversations.mockResolvedValueOnce([])
    await user.click(
      within(sidebar).getByRole("button", { name: "重试加载历史记录" }),
    )
    expect(
      await screen.findByRole("heading", { name: "开始新对话" }),
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

  it("switches sibling branches from the linear branch switcher", async () => {
    const user = userEvent.setup()
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)

    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    expect(within(pane).getByText(right.content)).toBeVisible()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(within(pane).getByRole("group", { name: "分支 2/2" })).toBeVisible()

    await user.click(within(pane).getByRole("button", { name: "上一条分支" }))

    await waitFor(() => {
      expect(within(pane).getByText(left.content)).toBeVisible()
    })
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(within(pane).getByRole("group", { name: "分支 1/2" })).toBeVisible()
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

  it("keeps an archived conversation readable and disables every write affordance", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, isArchived: true },
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          {
            ...tree.conversation,
            isArchived: true,
            updatedAt: right.createdAt,
          },
        ],
        error: null,
      },
    })

    render(<ConversationWorkspace />)

    expect(screen.getByRole("button", { name: "新建对话" })).toBeVisible()
    expect(screen.getByText("已归档 — 只读")).toBeVisible()
    expect(
      within(screen.getByTestId("conversation-pane")).getByText(right.content),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
    // The archived history row keeps its badge; with the row menu closed
    // there is no archive entry point anywhere (header action removed, the
    // archived row's menu offers unarchive instead — covered separately).
    expect(screen.getByText("已归档")).toBeVisible()
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

  it("truncates at the pending branch origin while preserving the Composer draft, then returns to append behavior after success", async () => {
    const user = userEvent.setup()
    const branchUser: ConversationNodeView = {
      id: "branch-user",
      parentId: assistant.id,
      conversationId: root.conversationId,
      role: "user",
      content: "BRANCH_COMPOSER_DRAFT_SENTINEL",
      createdAt: 5,
      metadata: null,
    }
    const branchAssistant: ConversationNodeView = {
      id: "branch-assistant",
      parentId: branchUser.id,
      conversationId: root.conversationId,
      role: "assistant",
      content: "BRANCH_ASSISTANT_SENTINEL",
      createdAt: 6,
      metadata: null,
    }
    const appendedUser: ConversationNodeView = {
      id: "appended-after-branch",
      parentId: branchAssistant.id,
      conversationId: root.conversationId,
      role: "user",
      content: "NORMAL_APPEND_SENTINEL",
      createdAt: 7,
      metadata: null,
    }
    client.createBranch.mockResolvedValueOnce(branchUser)
    client.appendNode.mockResolvedValueOnce(appendedUser)
    providerClient.generateFromActivePath.mockResolvedValue({
      type: "cancelled",
      generationId: "branch-generation",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, branchUser.content)
    expect(within(pane).getByText(assistant.content)).toBeVisible()
    expect(within(pane).getByText(right.content)).toBeVisible()

    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()
    await user.click(
      within(assistantArticle!).getByRole("button", {
        name: "从此处创建分支",
      }),
    )

    expect(composer).toHaveFocus()
    expect(composer).toHaveValue(branchUser.content)
    expect(composer).toHaveAttribute("placeholder", "输入分支消息…")
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
    expect(within(pane).getByText(assistant.content)).toBeVisible()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    const branchMarker = within(pane).getByRole("separator", {
      name: "由此处创建分支",
    })
    expect(branchMarker).toHaveAttribute("data-variant", "separator")
    expect(useConversationStore.getState().fullNodes[right.id]).toEqual(right)
    expect(
      useConversationStore.getState().nodesById[assistant.id]?.childIds,
    ).toEqual([left.id, right.id])
    expect(
      within(pane).queryByRole("textbox", { name: "分支消息内容" }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.createBranch).toHaveBeenCalledWith({
        conversationId: root.conversationId,
        parentNodeId: assistant.id,
        content: branchUser.content,
      })
      expect(composer).toHaveValue("")
      expect(within(pane).getByText(branchUser.content)).toBeVisible()
    })
    await waitFor(() =>
      expect(
        useConversationStore.getState().generationRuns[root.conversationId]
          ?.phase,
      ).toBe("cancelled"),
    )
    expect(
      within(pane).queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(useConversationStore.getState().fullNodes[right.id]).toEqual(right)
    act(() => {
      useConversationStore.setState((state) => ({
        fullNodes: {
          ...state.fullNodes,
          [branchAssistant.id]: branchAssistant,
        },
        nodesById: {
          ...state.nodesById,
          [branchUser.id]: {
            id: branchUser.id,
            parentId: assistant.id,
            role: branchUser.role,
            preview: branchUser.content,
            childIds: [branchAssistant.id],
          },
          [branchAssistant.id]: {
            id: branchAssistant.id,
            parentId: branchUser.id,
            role: branchAssistant.role,
            preview: branchAssistant.content,
            childIds: [],
          },
        },
        activeNodeId: branchAssistant.id,
      }))
    })

    await user.type(composer, appendedUser.content)
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.appendNode).toHaveBeenCalledWith({
        conversationId: root.conversationId,
        parentNodeId: branchAssistant.id,
        content: appendedUser.content,
      })
    })
    expect(client.createBranch).toHaveBeenCalledTimes(1)
  })

  it("retains branch intent and the Composer draft when branch creation fails", async () => {
    const user = userEvent.setup()
    const branchUser: ConversationNodeView = {
      id: "retry-branch-user",
      parentId: assistant.id,
      conversationId: root.conversationId,
      role: "user",
      content: "RETRY_BRANCH_DRAFT_SENTINEL",
      createdAt: 5,
      metadata: null,
    }
    client.createBranch
      .mockRejectedValueOnce(new Error("branch failed"))
      .mockResolvedValueOnce(branchUser)
    providerClient.generateFromActivePath.mockResolvedValue({
      type: "cancelled",
      generationId: "branch-generation",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, branchUser.content)
    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()
    await user.click(
      within(assistantArticle!).getByRole("button", {
        name: "从此处创建分支",
      }),
    )
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(
      within(pane).getByRole("separator", { name: "由此处创建分支" }),
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.createBranch).toHaveBeenCalledTimes(1)
      expect(composer).toHaveValue(branchUser.content)
      expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
      expect(
        within(pane).getByRole("separator", { name: "由此处创建分支" }),
      ).toBeVisible()
    })

    act(() => {
      useConversationStore.setState({ status: "ready", error: null })
    })
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.createBranch).toHaveBeenCalledTimes(2)
      expect(client.createBranch).toHaveBeenLastCalledWith({
        conversationId: root.conversationId,
        parentNodeId: assistant.id,
        content: branchUser.content,
      })
      expect(composer).toHaveValue("")
    })
    expect(
      within(pane).queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
  })

  it("clears branch intent when normal tree navigation selects another branch", async () => {
    const user = userEvent.setup()
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, "TREE_NAVIGATION_DRAFT_SENTINEL")
    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()
    await user.click(
      within(assistantArticle!).getByRole("button", {
        name: "从此处创建分支",
      }),
    )
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(
      within(pane).getByRole("separator", { name: "由此处创建分支" }),
    ).toBeVisible()

    act(() => {
      useConversationStore.getState().selectNode(left.id)
    })

    await waitFor(() => {
      expect(within(pane).getByText(left.content)).toBeVisible()
    })
    expect(within(pane).getByText(assistant.content)).toBeVisible()
    expect(
      within(pane).queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
    expect(composer).toHaveValue("TREE_NAVIGATION_DRAFT_SENTINEL")
  })

  it("clears branch intent when switching conversations without clearing the Composer draft", async () => {
    const user = userEvent.setup()
    const otherRoot: ConversationNodeView = {
      id: "branch-switch-root",
      conversationId: "conversation-branch-switch",
      role: "user",
      content: "BRANCH_SWITCH_OTHER_SENTINEL",
      createdAt: 8,
      metadata: null,
    }
    const otherTree: ConversationTreeView = {
      conversation: {
        id: otherRoot.conversationId,
        title: "Branch switch history",
        rootNodeId: otherRoot.id,
        isArchived: false,
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
    client.loadConversationTree.mockImplementation((conversationId) =>
      Promise.resolve(
        conversationId === otherTree.conversation.id ? otherTree : tree,
      ),
    )
    await useConversationStore
      .getState()
      .loadConversation(client, tree.conversation.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          { ...otherTree.conversation, updatedAt: 2 },
        ],
        error: null,
      },
    })
    render(<ConversationWorkspace />)

    const pane = await screen.findByTestId("conversation-pane")
    await within(pane).findByText(right.content)
    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, "BRANCH_SWITCH_DRAFT_SENTINEL")
    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()
    await user.click(
      within(assistantArticle!).getByRole("button", {
        name: "从此处创建分支",
      }),
    )
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(
      within(pane).getByRole("separator", { name: "由此处创建分支" }),
    ).toBeVisible()

    await user.click(
      screen.getByRole("button", { name: /^Branch switch history/ }),
    )
    await within(pane).findByText(otherRoot.content)
    expect(
      within(pane).queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Branch proof/ }))
    await within(pane).findByText(right.content)

    expect(composer).toHaveValue("BRANCH_SWITCH_DRAFT_SENTINEL")
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
    expect(client.createBranch).not.toHaveBeenCalled()
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
    providerClient.generateFromActivePath.mockResolvedValue({
      type: "cancelled",
      generationId: "edit-generation",
    })
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
    await waitFor(() =>
      expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
        root.conversationId,
        edited.id,
        expect.any(Function),
      ),
    )
    expect(useConversationStore.getState().fullNodes[right.id]).toEqual(right)
    expect(useConversationStore.getState().fullNodes[edited.id]).toEqual(edited)
  })

  it("creates only the returned user root and keeps generation unavailable without a provider", async () => {
    const user = userEvent.setup()
    providerClient.listProviders.mockResolvedValue({
      providers: [],
      activeProviderId: null,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      defaultSystemPrompt: null,
    })
    client.createConversation.mockResolvedValueOnce(rootOnlyTree)
    render(<ConversationWorkspace />)

    const composer = await screen.findByRole("textbox", {
      name: "消息输入框",
    })
    expect(screen.getByRole("button", { name: "新建对话" })).toBeVisible()
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
    expect(
      screen.queryByRole("button", { name: "生成" }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId("conversation-pane")).getByRole("button", {
        name: "配置服务提供商以生成",
      }),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toHaveAttribute(
      "placeholder",
      "当前位置不可直接发送，可创建分支",
    )
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
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
    const loadedPane = screen.getByTestId("conversation-pane")
    const assistantArticle = within(loadedPane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()
    await user.click(
      within(assistantArticle!).getByRole("button", {
        name: "从此处创建分支",
      }),
    )
    expect(
      within(loadedPane).queryByText(right.content),
    ).not.toBeInTheDocument()
    expect(
      within(loadedPane).getByRole("separator", { name: "由此处创建分支" }),
    ).toBeVisible()
    const before = useConversationStore.getState()

    await user.click(screen.getByRole("button", { name: "新建对话" }))

    expect(screen.getByTestId("blank-conversation-pane")).toBeVisible()
    expect(
      screen.queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    const creating = useConversationStore.getState()
    expect(creating.isCreatingConversation).toBe(true)
    expect(creating.conversationId).toBe(before.conversationId)
    expect(creating.activeNodeId).toBe(before.activeNodeId)
    expect(creating.nodesById).toBe(before.nodesById)
    expect(creating.history).toBe(before.history)

    await user.click(screen.getByRole("button", { name: /^Branch proof/ }))
    await waitFor(() => {
      expect(screen.getByTestId("conversation-pane")).toBeVisible()
      expect(useConversationStore.getState().isCreatingConversation).toBe(false)
    })
    const restoredPane = screen.getByTestId("conversation-pane")
    expect(within(restoredPane).getByText(right.content)).toBeVisible()
    expect(
      within(restoredPane).queryByRole("separator", {
        name: "由此处创建分支",
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
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

    // The blank-conversation alert maps the error through
    // commandErrorMessage(code); the raw backend message is never echoed.
    expect(await screen.findByText("对话数据库当前不可用。")).toBeVisible()
    expect(
      screen.queryByText("Conversation could not be saved."),
    ).not.toBeInTheDocument()
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
      await screen.findByRole("button", { name: "新建对话" }),
    ).toBeEnabled()
    expect(await screen.findByText("已归档 — 只读")).toBeVisible()
  })

  it("visually truncates history titles and exposes the complete title via a native tooltip", async () => {
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
    expect(title).toHaveAttribute("title", longTitle)
    expect(within(historyButton).queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("renders one transient response and merges only the authoritative completion", async () => {
    const user = userEvent.setup()
    const generationId = "11111111-1111-4111-8111-111111111111"
    const visibleStreamedContent = "WORKSPACE_STREAM_SENTINEL"
    const streamedContent = `## ${visibleStreamedContent}`
    let onEvent: ((event: GenerationEventView) => void) | undefined
    let completeGeneration:
      | ((
          value: Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>,
        ) => void)
      | undefined
    const generationResult = new Promise<
      Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>
    >((resolve) => {
      completeGeneration = resolve
    })
    configureActiveProvider()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return generationResult
      },
    )
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const pane = await screen.findByTestId("conversation-pane")
    const generateButton = await within(pane).findByRole("button", {
      name: "生成回复",
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
      completeGeneration?.({ type: "completed", generationId, node: completed })
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
  })

  it("projects every terminal phase through the ordinary assistant message surface", async () => {
    const user = userEvent.setup()
    const generationId = "11111111-1111-4111-8111-111111111111"
    const run = {
      runId: 41,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId,
      model: "fixture-model",
    } as const
    const recoveryError = {
      code: "network_failure" as const,
      message: "Internal recovery detail that must stay hidden.",
      retryable: true,
    }
    configureActiveProvider({ ...provider, model: run.model })
    providerClient.generateFromActivePath.mockReturnValue(
      new Promise(() => undefined),
    )
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)
    const pane = screen.getByTestId("conversation-pane")
    await waitFor(() => {
      expect(
        within(pane).getByRole("button", { name: "生成回复" }),
      ).toBeEnabled()
    })

    act(() => {
      seedGenerationRun({ ...run, phase: "starting" })
    })
    expect(within(pane).getByText("正在思考")).toBeVisible()

    act(() => {
      seedGenerationRun({
        ...run,
        phase: "streaming",
        thinking: "",
        content: "PARTIAL_REPLY",
      })
    })
    expect(within(pane).getByText("PARTIAL_REPLY")).toBeVisible()
    expect(within(pane).queryByText("正在思考")).not.toBeInTheDocument()

    act(() => {
      seedGenerationRun({
        ...run,
        phase: "failed",
        failureKind: "generation",
        error: recoveryError,
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
      seedGenerationRun({
        ...run,
        phase: "failed",
        failureKind: "persistence",
        content: "FULL_REPLY",
        error: recoveryError,
      })
    })
    expect(within(pane).getByText("FULL_REPLY")).toBeVisible()
    expect(within(pane).getByText("这条回复未能保存")).toBeVisible()
    expect(within(pane).getByRole("button", { name: "重新生成" })).toBeEnabled()

    act(() => {
      seedGenerationRun({
        ...run,
        phase: "cancelled",
        content: "PARTIAL_REPLY",
      })
    })
    expect(within(pane).getByText("PARTIAL_REPLY")).toBeVisible()
    expect(within(pane).getByText("回复已停止")).toBeVisible()
    expect(within(pane).getByRole("button", { name: "重新生成" })).toBeEnabled()

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

    // The pane renders the per-code representative copy
    // (commandErrorMessage); the raw store error message is never echoed to
    // the UI, and the removed sidebar tree no longer duplicates this state.
    expect(screen.queryByText("无法安全显示对话树。")).not.toBeInTheDocument()
    expect(screen.getAllByText("无法验证对话树。")).toHaveLength(1)
    const pane = screen.getByTestId("conversation-pane")
    expect(within(pane).getByText("无法验证对话树。")).toBeVisible()
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

  it("renders Composer cancel action during starting/streaming and cancels generation on click", async () => {
    const user = userEvent.setup()
    const generationId = "22222222-2222-4222-8222-222222222222"
    let onEvent: ((event: GenerationEventView) => void) | undefined

    configureActiveProvider()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return new Promise(() => undefined)
      },
    )
    providerClient.cancelGeneration.mockResolvedValue({ accepted: true })

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...tree.conversation, updatedAt: right.createdAt }],
        error: null,
      },
    })
    render(<ConversationWorkspace />)

    const pane = await screen.findByTestId("conversation-pane")
    const generateButton = await within(pane).findByRole("button", {
      name: "生成回复",
    })
    await user.click(generateButton)

    act(() => {
      onEvent!({
        type: "started",
        generationId,
        conversationId: root.conversationId,
        activeNodeId: right.id,
        model: "fixture-model",
      })
    })

    const cancelButton = screen.getByRole("button", { name: "停止生成" })
    expect(cancelButton).toBeVisible()
    expect(cancelButton).toBeEnabled()
    // The header archive entry point is gone; the history-row "…" menu stays
    // visible and enabled during streaming, and merely opening its dialog
    // must never interrupt anything.
    const menuTrigger = screen.getByRole("button", {
      name: "对话操作：Branch proof",
    })
    expect(menuTrigger).toBeVisible()
    expect(menuTrigger).toBeEnabled()
    await user.click(menuTrigger)
    await user.click(screen.getByRole("menuitem", { name: "归档" }))
    const dialog = screen.getByRole("alertdialog", { name: "归档对话？" })
    expect(within(dialog).getByText("Branch proof")).toBeVisible()
    expect(
      within(dialog).getByText(
        "归档后对话转为只读，并在历史记录中标记为已归档。",
      ),
    ).toBeVisible()
    expect(within(dialog).getByText("归档将打断正在进行的生成。")).toBeVisible()
    expect(client.archiveConversation).not.toHaveBeenCalled()
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(client.archiveConversation).not.toHaveBeenCalled()
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()
    expect(
      useConversationStore.getState().generationRuns[root.conversationId]
        ?.phase,
    ).toBe("streaming")
    expect(
      screen.queryByRole("button", { name: "发送消息" }),
    ).not.toBeInTheDocument()
    // Workspace header must not have cancel or generate buttons
    expect(
      screen.queryByRole("button", { name: "生成" }),
    ).not.toBeInTheDocument()

    await user.click(cancelButton)
    expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    expect(providerClient.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(menuTrigger).toBeEnabled()
  })

  it("archives a non-current history row by ID from the confirm dialog without disturbing the loaded conversation", async () => {
    const user = userEvent.setup()
    const otherSummary = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          otherSummary,
        ],
        error: null,
      },
    })
    client.archiveConversation.mockResolvedValueOnce({
      id: otherSummary.id,
      title: otherSummary.title,
      rootNodeId: otherSummary.rootNodeId,
      isArchived: true,
    })
    render(<ConversationWorkspace />)

    const selectButton = screen.getByRole("button", { name: "Other row" })
    const otherRow = selectButton.closest("li")
    expect(otherRow).not.toBeNull()
    // The workspace is writable and ready — the state that used to render the
    // header archive button. Each row exposes exactly one "…" menu trigger;
    // no header entry.
    expect(screen.getAllByRole("button", { name: /对话操作：/ })).toHaveLength(
      2,
    )
    const menuTrigger = within(otherRow!).getByRole("button", {
      name: "对话操作：Other row",
    })
    // Sibling buttons inside one group wrapper — no nested <button> markup.
    const rowWrapper = menuTrigger.parentElement
    expect(rowWrapper?.querySelectorAll("button")).toHaveLength(2)
    expect(rowWrapper?.contains(selectButton)).toBe(true)
    expect(selectButton.contains(menuTrigger)).toBe(false)
    expect(menuTrigger.contains(selectButton)).toBe(false)
    // Hover/focus reveal without layout shift. Vertical centering uses
    // inset-y-0 + my-auto for clean alignment within the row height.
    // The open-state selector keeps the trigger visible while its portaled
    // menu is open — group-hover ends once the pointer leaves the row.
    expect(menuTrigger).toHaveClass(
      "inset-y-0",
      "my-auto",
      "size-7",
      "text-muted-foreground",
      "opacity-0",
      "transition-opacity",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "data-[state=open]:opacity-100",
      "hover:text-foreground",
    )

    await user.click(menuTrigger)
    await user.click(screen.getByRole("menuitem", { name: "归档" }))
    const dialog = screen.getByRole("alertdialog", { name: "归档对话？" })
    expect(within(dialog).getByText("Other row")).toBeVisible()
    expect(
      within(dialog).getByText(
        "归档后对话转为只读，并在历史记录中标记为已归档。",
      ),
    ).toBeVisible()
    expect(
      within(dialog).queryByText("归档将打断正在进行的生成。"),
    ).not.toBeInTheDocument()
    expect(client.archiveConversation).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "归档" }))

    await waitFor(() => {
      expect(client.archiveConversation).toHaveBeenCalledTimes(1)
      expect(client.archiveConversation).toHaveBeenCalledWith(otherSummary.id)
    })
    const state = useConversationStore.getState()
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id)
        ?.isArchived,
    ).toBe(true)
    // The global conversation projection is untouched: selection kept, rows
    // stay enabled, and no sidebar-wide loading/error status is applied.
    expect(state.conversationId).toBe(root.conversationId)
    expect(state.isArchived).toBe(false)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
    expect(screen.getByRole("button", { name: /^Branch proof/ })).toBeEnabled()
    expect(screen.getByRole("button", { name: /^Other row/ })).toBeEnabled()
    expect(within(otherRow!).getByText("已归档")).toBeVisible()
    // The row keeps its "…" trigger; the archive action now lives inside it.
    expect(
      within(otherRow!).getByRole("button", {
        name: "对话操作：Other row",
      }),
    ).toBeVisible()
  })

  it("cancels the generating current conversation before archiving it from the row dialog", async () => {
    const user = userEvent.setup()
    const generationId = "33333333-3333-4333-8333-333333333333"
    let onEvent: ((event: GenerationEventView) => void) | undefined
    configureActiveProvider()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return new Promise(() => undefined)
      },
    )
    client.archiveConversation.mockResolvedValueOnce({
      ...tree.conversation,
      isArchived: true,
    })

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...tree.conversation, updatedAt: right.createdAt }],
        error: null,
      },
    })
    render(<ConversationWorkspace />)

    const pane = await screen.findByTestId("conversation-pane")
    await user.click(
      await within(pane).findByRole("button", { name: "生成回复" }),
    )
    act(() => {
      onEvent!({
        type: "started",
        generationId,
        conversationId: root.conversationId,
        activeNodeId: right.id,
        model: "fixture-model",
      })
    })

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "归档" }))
    const dialog = screen.getByRole("alertdialog", { name: "归档对话？" })
    expect(within(dialog).getByText("归档将打断正在进行的生成。")).toBeVisible()

    await user.click(within(dialog).getByRole("button", { name: "归档" }))

    await waitFor(() => {
      expect(providerClient.cancelGeneration).toHaveBeenCalledTimes(1)
      expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
      expect(client.archiveConversation).toHaveBeenCalledTimes(1)
      expect(client.archiveConversation).toHaveBeenCalledWith(
        root.conversationId,
      )
    })
    // The run is cancelled before the archive command is sent.
    const [cancelOrder] =
      providerClient.cancelGeneration.mock.invocationCallOrder
    const [archiveOrder] = client.archiveConversation.mock.invocationCallOrder
    expect(cancelOrder).toBeDefined()
    expect(archiveOrder).toBeDefined()
    expect(cancelOrder!).toBeLessThan(archiveOrder!)

    await waitFor(() => {
      const state = useConversationStore.getState()
      expect(state.isArchived).toBe(true)
      expect(state.status).toBe("ready")
      // The archived conversation is read-only; its cancelled run record is
      // cleared instead of lingering as an unusable transient bubble.
      expect(state.generationRuns[root.conversationId]).toBeUndefined()
      expect(
        state.history.summaries.find((item) => item.id === root.conversationId)
          ?.isArchived,
      ).toBe(true)
    })
    expect(screen.getByText("已归档 — 只读")).toBeVisible()
    expect(screen.getByText("已归档")).toBeVisible()
  })

  it("archives another row during generation without disturbing the active run", async () => {
    const user = userEvent.setup()
    const otherSummary = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          otherSummary,
        ],
        error: null,
      },
    })
    seedGenerationRun({
      runId: 31,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId: "other-row-gen-id",
      model: "fixture-model",
      phase: "streaming",
      thinking: "",
      content: "PARTIAL_REPLY",
    })
    client.archiveConversation.mockResolvedValueOnce({
      id: otherSummary.id,
      title: otherSummary.title,
      rootNodeId: otherSummary.rootNodeId,
      isArchived: true,
    })
    render(<ConversationWorkspace />)

    const otherRow = screen
      .getByRole("button", { name: "Other row" })
      .closest("li")
    expect(otherRow).not.toBeNull()
    await user.click(
      within(otherRow!).getByRole("button", { name: "对话操作：Other row" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "归档" }))
    const dialog = screen.getByRole("alertdialog", { name: "归档对话？" })
    expect(
      within(dialog).queryByText("归档将打断正在进行的生成。"),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "归档" }))

    await waitFor(() => {
      expect(client.archiveConversation).toHaveBeenCalledWith(otherSummary.id)
    })
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()
    expect(
      useConversationStore.getState().generationRuns[root.conversationId]
        ?.phase,
    ).toBe("streaming")
    expect(useConversationStore.getState().status).toBe("ready")
    expect(screen.getByRole("button", { name: "停止生成" })).toBeEnabled()
  })

  it("decides interruption at confirm time when the run finishes while the dialog is open", async () => {
    const user = userEvent.setup()
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...tree.conversation, updatedAt: right.createdAt }],
        error: null,
      },
    })
    seedGenerationRun({
      runId: 57,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId: "confirm-time-gen-id",
      model: "fixture-model",
      phase: "streaming",
      thinking: "",
      content: "PARTIAL_REPLY",
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "归档" }))
    const dialog = screen.getByRole("alertdialog", { name: "归档对话？" })
    expect(within(dialog).getByText("归档将打断正在进行的生成。")).toBeVisible()

    act(() => {
      useConversationStore.setState({ generationRuns: {} })
    })
    expect(
      within(dialog).queryByText("归档将打断正在进行的生成。"),
    ).not.toBeInTheDocument()

    client.archiveConversation.mockResolvedValueOnce({
      ...tree.conversation,
      isArchived: true,
    })
    await user.click(within(dialog).getByRole("button", { name: "归档" }))

    await waitFor(() => {
      expect(client.archiveConversation).toHaveBeenCalledWith(
        root.conversationId,
      )
    })
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()
    expect(useConversationStore.getState().isArchived).toBe(true)
  })

  it("offers rename plus archive or unarchive per row archive state", async () => {
    const user = userEvent.setup()
    const archivedSummary = {
      id: "conversation-other",
      title: "Archived row",
      rootNodeId: "other-root",
      isArchived: true,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          archivedSummary,
        ],
        error: null,
      },
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "归档" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "取消归档" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeVisible()

    await user.keyboard("{Escape}")
    await user.click(
      screen.getByRole("button", { name: "对话操作：Archived row" }),
    )
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "取消归档" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "归档" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeVisible()
  })

  it("renames through the dialog with prefill, validation, and localized errors", async () => {
    const user = userEvent.setup()
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...tree.conversation, updatedAt: right.createdAt }],
        error: null,
      },
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "重命名" }))

    const dialog = screen.getByRole("dialog", { name: "重命名对话" })
    const input = within(dialog).getByRole<HTMLInputElement>("textbox", {
      name: "对话标题",
    })
    expect(input).toHaveValue("Branch proof")
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe("Branch proof".length)

    const saveButton = within(dialog).getByRole("button", { name: "保存" })
    await user.clear(input)
    expect(saveButton).toBeDisabled()
    expect(within(dialog).getByText("标题不能为空。")).toBeVisible()
    await user.type(input, "界".repeat(201))
    expect(saveButton).toBeDisabled()
    expect(within(dialog).getByText("标题不能超过 200 个字符。")).toBeVisible()
    expect(client.renameConversation).not.toHaveBeenCalled()

    client.renameConversation.mockResolvedValueOnce({
      ...tree.conversation,
      title: "手动重命名",
    })
    await user.clear(input)
    await user.type(input, "  手动重命名  ")
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() => {
      expect(client.renameConversation).toHaveBeenCalledWith({
        conversationId: root.conversationId,
        title: "手动重命名",
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
    expect(useConversationStore.getState().title).toBe("手动重命名")
    expect(screen.getByRole("button", { name: "手动重命名" })).toBeVisible()

    client.renameConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "not_found",
        message: "Conversation is gone.",
        retryable: false,
      }),
    )
    await user.click(
      screen.getByRole("button", { name: "对话操作：手动重命名" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "重命名" }))
    const retryDialog = screen.getByRole("dialog", { name: "重命名对话" })
    const retryInput = within(retryDialog).getByRole("textbox", {
      name: "对话标题",
    })
    expect(retryInput).toHaveValue("手动重命名")
    await user.click(within(retryDialog).getByRole("button", { name: "保存" }))
    expect(
      await within(retryDialog).findByText("未找到请求的资源。"),
    ).toBeVisible()
    expect(retryDialog).toBeVisible()
    expect(
      within(retryDialog).queryByText("Conversation is gone."),
    ).not.toBeInTheDocument()
  })

  it("deletes the current conversation back to the blank new-conversation state", async () => {
    const user = userEvent.setup()
    const otherSummary = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          otherSummary,
        ],
        error: null,
      },
    })
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: root.conversationId,
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    const dialog = screen.getByRole("alertdialog", { name: "删除对话？" })
    expect(within(dialog).getByText("Branch proof")).toBeVisible()
    expect(
      within(dialog).getByText(
        "删除后无法恢复，该对话及其全部消息将被永久移除。",
      ),
    ).toBeVisible()
    expect(
      within(dialog).queryByText("删除将打断正在进行的生成并放弃其结果。"),
    ).not.toBeInTheDocument()
    const confirmButton = within(dialog).getByRole("button", { name: "删除" })
    expect(confirmButton).toHaveAttribute("data-variant", "destructive")
    expect(client.deleteConversation).not.toHaveBeenCalled()

    await user.click(confirmButton)

    await waitFor(() => {
      expect(client.deleteConversation).toHaveBeenCalledWith(
        root.conversationId,
      )
    })
    expect(await screen.findByTestId("blank-conversation-pane")).toBeVisible()
    const state = useConversationStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.status).toBe("idle")
    expect(state.title).toBeNull()
    // No landing conversation is auto-loaded; the remaining row survives.
    expect(client.loadConversationTree).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: /^Other row/ })).toBeVisible()

    // Cancelling the dialog performs no deletion.
    await user.click(
      screen.getByRole("button", { name: "对话操作：Other row" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(client.deleteConversation).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("cancels the active run before deleting and shows the interrupt warning", async () => {
    const user = userEvent.setup()
    const generationId = "55555555-5555-4555-8555-555555555555"
    seedGenerationRun({
      runId: 61,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId,
      model: "fixture-model",
      phase: "streaming",
      thinking: "",
      content: "PARTIAL_REPLY",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...tree.conversation, updatedAt: right.createdAt }],
        error: null,
      },
    })
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: root.conversationId,
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Branch proof" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    const dialog = screen.getByRole("alertdialog", { name: "删除对话？" })
    expect(
      within(dialog).getByText("删除将打断正在进行的生成并放弃其结果。"),
    ).toBeVisible()

    await user.click(within(dialog).getByRole("button", { name: "删除" }))

    await waitFor(() => {
      expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
      expect(client.deleteConversation).toHaveBeenCalledWith(
        root.conversationId,
      )
    })
    const [cancelOrder] =
      providerClient.cancelGeneration.mock.invocationCallOrder
    const [deleteOrder] = client.deleteConversation.mock.invocationCallOrder
    expect(cancelOrder).toBeDefined()
    expect(deleteOrder).toBeDefined()
    expect(cancelOrder!).toBeLessThan(deleteOrder!)
    await waitFor(() => {
      const state = useConversationStore.getState()
      expect(state.conversationId).toBeNull()
      expect(state.generationRuns[root.conversationId]).toBeUndefined()
      expect(state.history.status).toBe("empty")
    })
  })

  it("deletes a non-current row without disturbing the loaded conversation", async () => {
    const user = userEvent.setup()
    const otherSummary = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          otherSummary,
        ],
        error: null,
      },
    })
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: otherSummary.id,
    })
    render(<ConversationWorkspace />)

    await user.click(
      screen.getByRole("button", { name: "对话操作：Other row" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "删除" }))
    await user.click(screen.getByRole("button", { name: "删除" }))

    await waitFor(() => {
      expect(client.deleteConversation).toHaveBeenCalledWith(otherSummary.id)
    })
    const state = useConversationStore.getState()
    expect(state.conversationId).toBe(root.conversationId)
    expect(state.status).toBe("ready")
    expect(state.history.summaries.map((item) => item.id)).toEqual([
      root.conversationId,
    ])
    expect(
      screen.queryByRole("button", { name: /^Other row/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("conversation-pane")).toBeVisible()
  })

  it("unarchives an archived row straight from the menu without a confirm dialog", async () => {
    const user = userEvent.setup()
    const archivedSummary = {
      id: "conversation-other",
      title: "Archived row",
      rootNodeId: "other-root",
      isArchived: true,
      updatedAt: 1,
    }
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [
          { ...tree.conversation, updatedAt: right.createdAt },
          archivedSummary,
        ],
        error: null,
      },
    })
    client.unarchiveConversation.mockResolvedValueOnce({
      id: archivedSummary.id,
      title: archivedSummary.title,
      rootNodeId: archivedSummary.rootNodeId,
      isArchived: false,
    })
    render(<ConversationWorkspace />)

    const otherRow = screen
      .getByRole("button", { name: /^Archived row/ })
      .closest("li")
    expect(within(otherRow!).getByText("已归档")).toBeVisible()

    await user.click(
      within(otherRow!).getByRole("button", { name: "对话操作：Archived row" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "取消归档" }))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(client.unarchiveConversation).toHaveBeenCalledWith(
        archivedSummary.id,
      )
    })
    await waitFor(() => {
      expect(within(otherRow!).queryByText("已归档")).not.toBeInTheDocument()
    })
    // The loaded conversation keeps its projection untouched.
    const state = useConversationStore.getState()
    expect(state.conversationId).toBe(root.conversationId)
    expect(state.isArchived).toBe(false)
    expect(state.status).toBe("ready")
    expect(
      state.history.summaries.find((item) => item.id === archivedSummary.id)
        ?.isArchived,
    ).toBe(false)
  })

  it("opens SettingsDialog via contextual '配置服务提供商以生成' and updates to '生成回复' after saving the first provider", async () => {
    const user = userEvent.setup()
    clearActiveProvider()
    providerClient.listProviders.mockResolvedValue({
      providers: [],
      activeProviderId: null,
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
      defaultSystemPrompt: null,
    })
    providerClient.saveProvider = vi.fn().mockResolvedValueOnce({
      id: "provider-1",
      name: "Fixture provider",
      protocol: "openai_compatible",
      baseEndpoint: "http://127.0.0.1:7788/v1",
      model: "fixture-model",
      models: ["fixture-model"],
      hasApiKey: false,
      createdAt: 10,
      updatedAt: 11,
    })

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const pane = await screen.findByTestId("conversation-pane")
    const configButton = await within(pane).findByRole("button", {
      name: "配置服务提供商以生成",
    })
    expect(configButton).toBeVisible()

    await user.click(configButton)
    expect(screen.getByRole("dialog")).toHaveAccessibleName("设置")
    await user.click(screen.getByRole("button", { name: "模型提供商" }))
    await user.click(screen.getByRole("button", { name: "新建" }))
    await user.click(screen.getByRole("menuitem", { name: "自定义" }))

    await user.type(screen.getByLabelText("名称"), "Fixture provider")
    await user.type(
      screen.getByLabelText("基础端点"),
      "http://127.0.0.1:7788/v1",
    )
    await user.type(screen.getByLabelText("模型列表"), "fixture-model")
    await user.click(screen.getByRole("button", { name: "添加" }))
    await user.click(screen.getByRole("button", { name: "保存模型提供商" }))

    await waitFor(() => {
      expect(providerClient.saveProvider).toHaveBeenCalledWith({
        name: "Fixture provider",
        protocol: "openai_compatible",
        baseEndpoint: "http://127.0.0.1:7788/v1",
        model: "fixture-model",
        models: ["fixture-model"],
        apiKey: { action: "remove" },
      })
    })

    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    // First provider save auto-activates; no separate "set as default" step.
    expect(providerClient.setActiveProvider).not.toHaveBeenCalled()

    // Now contextual action becomes "生成回复"
    expect(within(pane).getByRole("button", { name: "生成回复" })).toBeVisible()
    // Generation must NOT start automatically
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("keeps Composer draft editable during streaming, persistence failure, and cancellation while Send is gated by assistant leaf", async () => {
    const user = userEvent.setup()
    const run = {
      runId: 99,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId: "test-gen-id",
      model: "fixture-model",
    } as const

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    render(<ConversationWorkspace />)

    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    expect(composer).toBeEnabled()
    expect(composer).toHaveAttribute(
      "placeholder",
      "当前位置不可直接发送，可创建分支",
    )

    // 1. During streaming: textarea editable, Cancel button active, Send hidden
    act(() => {
      seedGenerationRun({
        ...run,
        phase: "streaming",
        content: "STREAM_TEXT",
        thinking: "",
      })
    })
    expect(composer).toBeEnabled()
    expect(screen.getByRole("button", { name: "停止生成" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "发送消息" }),
    ).not.toBeInTheDocument()
    await user.type(composer, "MY_PERSISTENT_DRAFT")
    expect(composer).toHaveValue("MY_PERSISTENT_DRAFT")

    // 2. After persistence failure: textarea editable, Cancel absent, Send disabled
    act(() => {
      seedGenerationRun({
        ...run,
        phase: "failed",
        failureKind: "persistence",
        content: "FULL_TEXT",
        error: {
          code: "database_unavailable",
          message: "Unable to save reply.",
          retryable: true,
        },
      })
    })
    expect(composer).toBeEnabled()
    expect(composer).toHaveValue("MY_PERSISTENT_DRAFT")
    expect(
      screen.queryByRole("button", { name: "停止生成" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()

    await user.type(composer, "_APPEND")
    expect(composer).toHaveValue("MY_PERSISTENT_DRAFT_APPEND")

    // 3. During cancelled: textarea editable, Cancel absent, Send disabled
    act(() => {
      seedGenerationRun({ ...run, phase: "cancelled", content: "PARTIAL" })
    })
    expect(composer).toBeEnabled()
    expect(composer).toHaveValue("MY_PERSISTENT_DRAFT_APPEND")
    expect(
      screen.queryByRole("button", { name: "停止生成" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
  })

  it("excludes contextual generation actions for archived, answered, and transient states", async () => {
    // 1. Answered user node (root has assistant child)
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(root.id)
    const { unmount } = render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    expect(
      within(pane).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      within(pane).queryByRole("button", { name: "配置服务提供商以生成" }),
    ).not.toBeInTheDocument()
    unmount()

    // 2. Assistant leaf (assistant node selected)
    useConversationStore.getState().selectNode(assistant.id)
    const { unmount: unmount2 } = render(<ConversationWorkspace />)
    const pane2 = screen.getByTestId("conversation-pane")
    expect(
      within(pane2).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      within(pane2).queryByRole("button", { name: "配置服务提供商以生成" }),
    ).not.toBeInTheDocument()
    unmount2()

    // 3. Archived conversation with unanswered user leaf
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, isArchived: true },
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    const { unmount: unmount3 } = render(<ConversationWorkspace />)
    const pane3 = screen.getByTestId("conversation-pane")
    expect(
      within(pane3).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      within(pane3).queryByRole("button", { name: "配置服务提供商以生成" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toHaveAttribute(
      "placeholder",
      "对话已归档（只读）",
    )
    unmount3()

    // 4. Transient generation active on unanswered user leaf
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    act(() => {
      seedGenerationRun({
        runId: 101,
        conversationId: root.conversationId,
        parentNodeId: right.id,
        priorChildIds: [],
        generationId: "transient-gen-id",
        phase: "starting",
      })
    })
    const { unmount: unmount4 } = render(<ConversationWorkspace />)
    const pane4 = screen.getByTestId("conversation-pane")
    // Contextual button on the user node must be absent while transient response is active
    expect(
      within(pane4).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      within(pane4).queryByRole("button", { name: "配置服务提供商以生成" }),
    ).not.toBeInTheDocument()

    // When cancelled, only the transient bubble has "重新生成", no duplicate user-leaf "生成回复"
    act(() => {
      seedGenerationRun({
        runId: 101,
        conversationId: root.conversationId,
        parentNodeId: right.id,
        priorChildIds: [],
        generationId: "transient-gen-id",
        phase: "cancelled",
        content: "CANCELLED_STREAM",
      })
    })
    expect(
      within(pane4).queryByRole("button", { name: "生成回复" }),
    ).not.toBeInTheDocument()
    expect(
      within(pane4).getByRole("button", { name: "重新生成" }),
    ).toBeVisible()
    unmount4()
  })

  it("renders durable '重新生成' on final assistant node, selects user parent and triggers generateFromActivePath with parent ID on click while preserving old assistant and draft", async () => {
    const user = userEvent.setup()
    configureActiveProvider()
    providerClient.generateFromActivePath.mockReturnValue(
      new Promise(() => undefined),
    )

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(assistant.id)
    render(<ConversationWorkspace />)

    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    expect(composer).toBeEnabled()
    await user.type(composer, "MY_PERSISTENT_ASSISTANT_DRAFT")

    const pane = screen.getByTestId("conversation-pane")
    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    expect(assistantArticle).not.toBeNull()

    const regenBtn = await within(assistantArticle!).findByRole("button", {
      name: "重新生成",
    })
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

    await user.click(regenBtn)

    // Selects parent user node (root.id) and invokes generateFromActivePath with root.id
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      root.conversationId,
      root.id,
      expect.any(Function),
    )
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
    expect(useConversationStore.getState().activeNodeId).toBe(root.id)

    // Old assistant is preserved in the tree
    expect(useConversationStore.getState().fullNodes[assistant.id]).toEqual(
      assistant,
    )

    // Composer draft is preserved
    expect(composer).toHaveValue("MY_PERSISTENT_ASSISTANT_DRAFT")
  })

  it("revalidates a durable assistant regeneration action at click time", async () => {
    configureActiveProvider()

    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(assistant.id)
    render(<ConversationWorkspace />)

    const pane = screen.getByTestId("conversation-pane")
    const assistantArticle = within(pane)
      .getByText(assistant.content)
      .closest("article")
    const regenerateButton = await within(assistantArticle!).findByRole(
      "button",
      { name: "重新生成" },
    )

    regenerateButton.addEventListener(
      "click",
      () => {
        clearActiveProvider()
      },
      { capture: true, once: true },
    )
    act(() => regenerateButton.click())

    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
    expect(useConversationStore.getState().activeNodeId).toBe(assistant.id)
    expect(useConversationStore.getState().fullNodes[assistant.id]).toEqual(
      assistant,
    )
  })

  it("excludes durable '重新生成' from non-final, read-only, invalid, loading, and transient states", async () => {
    configureActiveProvider()

    // 1. The earlier assistant and the final user stay ineligible even when the Provider is ready.
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    const { unmount: unmount1 } = render(<ConversationWorkspace />)

    const pane1 = screen.getByTestId("conversation-pane")
    await within(pane1).findByRole("button", { name: "生成回复" })
    const earlierAssistantArticle = within(pane1)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(earlierAssistantArticle!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()

    // 2. User leaf ('right' is active user leaf): no durable 重新生成 on user message
    const userArticle = within(pane1)
      .getByText(right.content)
      .closest("article")
    expect(
      within(userArticle!).queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
    unmount1()

    // 2. Provider not ready.
    clearActiveProvider()
    useConversationStore.getState().selectNode(assistant.id)
    const { unmount: unmount2 } = render(<ConversationWorkspace />)
    const pane2 = screen.getByTestId("conversation-pane")
    const assistantArticle2 = within(pane2)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(assistantArticle2!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()
    unmount2()

    configureActiveProvider()

    // 3. Archived conversation.
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...tree.conversation, isArchived: true },
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(assistant.id)
    const { unmount: unmount3 } = render(<ConversationWorkspace />)
    const pane3 = screen.getByTestId("conversation-pane")
    const assistantArticle3 = within(pane3)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(assistantArticle3!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()
    unmount3()

    // 4. Active transient generation.
    client.loadConversationTree.mockResolvedValueOnce(tree)
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(assistant.id)
    act(() => {
      seedGenerationRun({
        runId: 202,
        conversationId: root.conversationId,
        parentNodeId: root.id,
        priorChildIds: [],
        generationId: "gen-active",
        model: "fixture-model",
        phase: "streaming",
        thinking: "",
        content: "STREAMING_TEXT",
      })
    })
    const { unmount: unmount4 } = render(<ConversationWorkspace />)
    const pane4 = screen.getByTestId("conversation-pane")
    const assistantArticle4 = within(pane4)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(assistantArticle4!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()
    unmount4()

    // 5. Cancelled recovery keeps only the always-visible transient action.
    act(() => {
      seedGenerationRun({
        runId: 203,
        conversationId: root.conversationId,
        parentNodeId: root.id,
        priorChildIds: [],
        generationId: "gen-cancelled",
        phase: "cancelled",
        content: "CANCELLED_RECOVERY_CONTENT",
      })
    })
    const { unmount: unmount5 } = render(<ConversationWorkspace />)
    const pane5 = screen.getByTestId("conversation-pane")
    const assistantArticle5 = within(pane5)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(assistantArticle5!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()
    // The active path ends at the assistant, not at the run's parent, so the
    // cancelled bubble is hidden until the user navigates back to the parent.
    expect(
      within(pane5).queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
    expect(within(pane5).queryByText("回复已停止")).not.toBeInTheDocument()
    unmount5()

    // 6. A loading projection cannot expose the durable action.
    act(() => {
      useConversationStore.setState({
        generationRuns: {},
        status: "loading",
      })
    })
    const { unmount: unmount6 } = render(<ConversationWorkspace />)
    const pane6 = screen.getByTestId("conversation-pane")
    const assistantArticle6 = within(pane6)
      .getByText(assistant.content)
      .closest("article")
    expect(
      within(assistantArticle6!).queryByRole("button", {
        name: "重新生成",
      }),
    ).not.toBeInTheDocument()
    unmount6()

    // 7. An invalid active-path projection cannot expose the durable action.
    act(() => {
      useConversationStore.setState({
        activeNodeId: "missing-active-node",
        status: "ready",
      })
    })
    const { unmount: unmount7 } = render(<ConversationWorkspace />)
    const pane7 = screen.getByTestId("conversation-pane")
    expect(
      within(pane7).queryByRole("button", { name: "重新生成" }),
    ).not.toBeInTheDocument()
    unmount7()
  })

  it("selects the clicked Panorama node instead of its newest leaf", async () => {
    class DOMMatrixReadOnlyStub {
      readonly m22 = 1
    }
    vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub)

    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)

    render(<ConversationWorkspace />)
    await screen.findByTestId("conversation-pane")
    expect(useConversationStore.getState().activeNodeId).toBe(right.id)

    const toggleButton = screen.getByRole("button", {
      name: "查看全景",
    })
    expect(toggleButton).toHaveAttribute("aria-pressed", "false")
    expect(toggleButton).toHaveAttribute("data-variant", "ghost")

    await userEvent.click(toggleButton)
    expect(toggleButton).toHaveAttribute("aria-label", "返回对话")
    expect(toggleButton).toHaveAttribute("aria-pressed", "true")
    expect(toggleButton).toHaveAttribute("data-variant", "secondary")

    const panorama = screen.getByRole("region", { name: "对话全景" })
    fireEvent.click(within(panorama).getByText("ASSISTANT_SENTINEL"))

    expect(useConversationStore.getState().activeNodeId).toBe(assistant.id)
    expect(useConversationStore.getState().reveal).toBeNull()

    const selectedCard = within(panorama)
      .getByText("ASSISTANT_SENTINEL")
      .closest("[data-node-id]")
    const leafCard = within(panorama)
      .getByText("RIGHT_BRANCH_SENTINEL")
      .closest("[data-node-id]")
    expect(selectedCard).toHaveAttribute("aria-current", "true")
    expect(selectedCard).toHaveAttribute("data-on-active-path", "true")
    expect(leafCard).toHaveAttribute("data-on-active-path", "true")
    expect(leafCard).not.toHaveAttribute("aria-current")

    await userEvent.click(toggleButton)
    expect(toggleButton).toHaveAttribute("aria-label", "查看全景")
    expect(toggleButton).toHaveAttribute("aria-pressed", "false")
    expect(toggleButton).toHaveAttribute("data-variant", "ghost")
    expect(
      screen.queryByRole("region", { name: "对话全景" }),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("conversation-pane")).toBeInTheDocument()
  })

  it("arms the branch composer from a Panorama card and closes the canvas", async () => {
    class DOMMatrixReadOnlyStub {
      readonly m22 = 1
    }
    vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub)

    const branchUser: ConversationNodeView = {
      id: "panorama-branch-user",
      parentId: assistant.id,
      conversationId: root.conversationId,
      role: "user",
      content: "PANORAMA_BRANCH_SENTINEL",
      createdAt: 5,
      metadata: null,
    }
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    client.createBranch.mockResolvedValueOnce(branchUser)
    providerClient.generateFromActivePath.mockResolvedValue({
      type: "cancelled",
      generationId: "panorama-branch-generation",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)

    render(<ConversationWorkspace />)
    await screen.findByTestId("conversation-pane")

    await userEvent.click(screen.getByRole("button", { name: "查看全景" }))
    const panorama = screen.getByRole("region", { name: "对话全景" })
    const branchButton = within(panorama).getByRole("button", {
      name: "从此处创建分支",
    })
    expect(branchButton).toBeVisible()

    fireEvent.click(branchButton)

    expect(useConversationStore.getState().activeNodeId).toBe(assistant.id)
    expect(
      screen.queryByRole("region", { name: "对话全景" }),
    ).not.toBeInTheDocument()
    const pane = screen.getByTestId("conversation-pane")
    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    expect(composer).toHaveFocus()
    expect(composer).toHaveAttribute("placeholder", "输入分支消息…")
    expect(within(pane).getByText(assistant.content)).toBeVisible()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(
      within(pane).getByRole("separator", { name: "由此处创建分支" }),
    ).toBeInTheDocument()

    await userEvent.type(composer, branchUser.content)
    await userEvent.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => {
      expect(client.createBranch).toHaveBeenCalledWith({
        conversationId: root.conversationId,
        parentNodeId: assistant.id,
        content: branchUser.content,
      })
      expect(within(pane).getByText(branchUser.content)).toBeVisible()
    })
    expect(
      within(pane).queryByRole("separator", { name: "由此处创建分支" }),
    ).not.toBeInTheDocument()
  })

  it("opens the conversation pane on the double-clicked Panorama node", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    class DOMMatrixReadOnlyStub {
      readonly m22 = 1
    }
    vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub)

    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)

    render(<ConversationWorkspace />)
    const pane = await screen.findByTestId("conversation-pane")
    expect(within(pane).getByText(right.content)).toBeVisible()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "查看全景" }))
    expect(screen.queryByTestId("conversation-pane")).not.toBeInTheDocument()
    const panorama = screen.getByRole("region", { name: "对话全景" })
    expect(panorama).toBeVisible()

    fireEvent.doubleClick(within(panorama).getByText("LEFT_BRANCH_SENTINEL"))

    const conversationPane = await screen.findByTestId("conversation-pane")
    expect(within(conversationPane).getByText(left.content)).toBeVisible()
    expect(
      within(conversationPane).queryByText(right.content),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "对话全景" }),
    ).not.toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    )
  })

  it("confirms panorama branch deletion and removes the subtree from the store", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(left.id)
    client.deleteConversationNode.mockResolvedValueOnce({ nodeId: left.id })

    render(<ConversationWorkspace />)
    await userEvent.click(screen.getByRole("button", { name: "查看全景" }))
    const panorama = screen.getByRole("region", { name: "对话全景" })
    const leftCard = within(panorama)
      .getByText("LEFT_BRANCH_SENTINEL")
      .closest("[data-node-id]") as HTMLElement
    fireEvent.click(
      within(leftCard).getByRole("button", { name: "删除该分支" }),
    )

    expect(client.deleteConversationNode).not.toHaveBeenCalled()
    expect(
      screen.getByRole("alertdialog", { name: "删除该分支？" }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(client.deleteConversationNode).not.toHaveBeenCalled()
    expect(useConversationStore.getState().nodesById[left.id]).toBeDefined()

    fireEvent.click(
      within(leftCard).getByRole("button", { name: "删除该分支" }),
    )
    const dialog = screen.getByRole("alertdialog", { name: "删除该分支？" })
    fireEvent.click(within(dialog).getByRole("button", { name: "删除该分支" }))

    await waitFor(() => {
      expect(client.deleteConversationNode).toHaveBeenCalledWith({
        conversationId: root.conversationId,
        nodeId: left.id,
      })
    })
    expect(useConversationStore.getState().nodesById[left.id]).toBeUndefined()
    expect(
      within(panorama).queryByText("LEFT_BRANCH_SENTINEL"),
    ).not.toBeInTheDocument()
    expect(useConversationStore.getState().activeNodeId).toBe(assistant.id)
  })

  it("does not re-render the main workspace shell on generation deltas", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    seedGenerationRun({
      phase: "streaming",
      runId: 7,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId: "11111111-1111-4111-8111-111111111111",
      model: "fixture-model",
      content: "HELLO",
      thinking: "",
    })
    render(<ConversationWorkspace />)
    const pane = await screen.findByTestId("conversation-pane")
    await waitFor(() =>
      expect(within(pane).getByText("HELLO")).toBeInTheDocument(),
    )
    const rendersBeforeDelta = workspaceRenderProbe.count

    act(() => {
      expect(
        useConversationStore.getState().appendGenerationDelta(7, {
          type: "delta",
          generationId: "11111111-1111-4111-8111-111111111111",
          content: " WORLD",
        }),
      ).toBe(true)
    })

    expect(workspaceRenderProbe.count).toBe(rendersBeforeDelta)
    expect(within(pane).getByText("HELLO WORLD")).toBeInTheDocument()
  })

  it("does not re-render durable path MessageNodes on generation deltas", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, root.conversationId)
    useConversationStore.getState().selectNode(right.id)
    seedGenerationRun({
      phase: "streaming",
      runId: 7,
      conversationId: root.conversationId,
      parentNodeId: right.id,
      priorChildIds: [],
      generationId: "11111111-1111-4111-8111-111111111111",
      model: "fixture-model",
      content: "HELLO",
      thinking: "",
    })
    render(<ConversationWorkspace />)
    const pane = await screen.findByTestId("conversation-pane")
    await waitFor(() =>
      expect(within(pane).getByText("HELLO")).toBeInTheDocument(),
    )
    const rendersBeforeDelta = new Map(messageNodeRenderProbe.counts)

    act(() => {
      expect(
        useConversationStore.getState().appendGenerationDelta(7, {
          type: "delta",
          generationId: "11111111-1111-4111-8111-111111111111",
          content: " WORLD",
        }),
      ).toBe(true)
    })

    expect(messageNodeRenderProbe.counts.get(root.id)).toBe(
      rendersBeforeDelta.get(root.id),
    )
    expect(messageNodeRenderProbe.counts.get(assistant.id)).toBe(
      rendersBeforeDelta.get(assistant.id),
    )
    expect(messageNodeRenderProbe.counts.get(right.id)).toBe(
      rendersBeforeDelta.get(right.id),
    )
    expect(within(pane).getByText("HELLO WORLD")).toBeInTheDocument()
  })
})

describe("ConversationWorkspace sidebar reveal", () => {
  it("scrolls the history row into view when the conversation changes", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const client = createMockClient()
    client.listConversations.mockResolvedValueOnce([
      {
        ...tree.conversation,
        updatedAt: right.createdAt,
      },
    ])
    vi.mocked(createConversationClient).mockReturnValue(client)
    vi.mocked(createProviderClient).mockReturnValue(createMockProviderClient())
    resetStore()

    render(<ConversationWorkspace />)

    const row = await screen.findByRole("button", { name: "Branch proof" })
    expect(row).toHaveAttribute("data-conversation-id", tree.conversation.id)
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "nearest" }),
      )
    })
  })

  it("scrolls the current row again when search reveals another branch", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const user = userEvent.setup()

    const client = createMockClient()
    client.listConversations.mockResolvedValueOnce([
      { ...tree.conversation, updatedAt: right.createdAt },
    ])
    client.searchConversations.mockResolvedValueOnce([
      {
        conversationId: tree.conversation.id,
        title: tree.conversation.title,
        isArchived: false,
        titleMatched: false,
        updatedAt: right.createdAt,
        hits: [
          {
            nodeId: left.id,
            role: left.role,
            createdAt: left.createdAt,
            snippet: left.content,
          },
        ],
      },
    ])
    vi.mocked(createConversationClient).mockReturnValue(client)
    vi.mocked(createProviderClient).mockReturnValue(createMockProviderClient())
    resetStore()
    render(<ConversationWorkspace />)

    await screen.findByRole("button", { name: "Branch proof" })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    scrollIntoView.mockClear()

    await user.click(screen.getByRole("button", { name: "搜索对话" }))
    await user.type(screen.getByLabelText("搜索消息或标题…"), "LEFT")
    await user.click(
      await screen.findByRole(
        "button",
        { name: /LEFT_BRANCH_SENTINEL/ },
        {
          timeout: 2000,
        },
      ),
    )

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "nearest" }),
      )
    })
  })
})
