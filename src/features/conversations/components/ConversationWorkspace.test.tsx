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

    expect(screen.getByText("Loading conversation history…")).toBeVisible()
    await waitFor(() => {
      expect(client.listConversations).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledTimes(1)
      expect(client.loadConversationTree).toHaveBeenCalledWith(
        tree.conversation.id,
      )
    })
    expect(screen.getByText("Loading conversation history…")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Start a conversation" }),
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
      screen.queryByRole("heading", { name: "Start a conversation" }),
    ).not.toBeInTheDocument()
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
    expect(screen.getByText("Archived — read only")).toBeVisible()
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

    expect(
      await screen.findByRole("button", { name: "Retry loading history" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Start a conversation" }),
    ).not.toBeInTheDocument()

    client.listConversations.mockResolvedValueOnce([])
    await user.click(
      screen.getByRole("button", { name: "Retry loading history" }),
    )
    expect(
      await screen.findByRole("heading", { name: "Start a conversation" }),
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

    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toBeVisible()
    expect(screen.getByText("Archived — read only")).toBeVisible()
    expect(
      within(screen.getByTestId("conversation-pane")).getByText(right.content),
    ).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit as new branch" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Create branch from here/ }),
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

    await user.click(screen.getByRole("button", { name: "Edit as new branch" }))
    const input = screen.getByRole("textbox", {
      name: "Edit message content",
    })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, edited.content)
    await user.click(screen.getByRole("button", { name: "Save as Branch" }))

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
      name: "Message composer",
    })
    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toBeVisible()
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("First message")).not.toBeInTheDocument()
    await user.type(composer, "ONE_USER_ROOT_SENTINEL")
    await user.click(screen.getByRole("button", { name: "Send message" }))

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
    expect(screen.queryByLabelText("assistant message")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeDisabled()
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

    await user.click(screen.getByRole("button", { name: "New conversation" }))

    expect(screen.getByTestId("blank-conversation-pane")).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeEnabled()
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
      name: "Message composer",
    })

    await user.type(composer, prompt)
    await user.click(screen.getByRole("button", { name: "Send message" }))

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
      name: "Message composer",
    })
    await user.type(composer, rootOnlyTree.nodes[0]!.content)

    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(
      await screen.findByText("Conversation could not be saved."),
    ).toBeVisible()
    expect(composer).toHaveValue(rootOnlyTree.nodes[0]!.content)
    expect(composer).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "Send message" }))
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
      await screen.findByRole("button", { name: "New conversation" }),
    ).toBeEnabled()
    expect(await screen.findByText("Archived — read only")).toBeVisible()
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
    const streamedContent = "WORKSPACE_STREAM_SENTINEL"
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
      name: "Generate",
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
      .getByText(streamedContent)
      .closest("article")
    expect(transientArticle).toHaveAccessibleName("assistant message")
    expect(
      within(pane).getAllByRole("article", { name: "assistant message" }),
    ).toHaveLength(2)
    expect(transientArticle).toHaveClass("mr-8", "bg-card")
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
      expect(within(pane).getByText(streamedContent)).toBeVisible()
    })
    const authoritativeArticle = within(pane)
      .getByText(streamedContent)
      .closest("article")
    expect(authoritativeArticle).toHaveAccessibleName("assistant message")
    expect(authoritativeArticle).toHaveClass("mr-8", "bg-card")
    expect(
      within(pane).getAllByRole("article", { name: "assistant message" }),
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
      expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled()
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

    expect(
      screen.getAllByText(
        "The conversation tree could not be displayed safely.",
      ),
    ).toHaveLength(2)
    const pane = screen.getByTestId("conversation-pane")
    expect(within(pane).queryByText(root.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
    expect(within(pane).queryByText(right.content)).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeDisabled()
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
