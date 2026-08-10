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
    title: "New conversation",
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

    await user.type(await screen.findByLabelText("Title"), "New conversation")
    await user.type(
      screen.getByLabelText("First message"),
      "ONE_USER_ROOT_SENTINEL",
    )
    await user.click(
      screen.getByRole("button", { name: "Create conversation" }),
    )

    await waitFor(() => {
      expect(
        within(screen.getByTestId("conversation-pane")).getByText(
          "ONE_USER_ROOT_SENTINEL",
        ),
      ).toBeVisible()
    })
    expect(client.createConversation).toHaveBeenCalledWith({
      title: "New conversation",
      content: "ONE_USER_ROOT_SENTINEL",
    })
    expect(screen.queryByLabelText("assistant message")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeDisabled()
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
    expect(
      within(pane).getByRole("article", {
        name: "Transient assistant response",
      }),
    ).toHaveTextContent(streamedContent)
    expect(within(pane).queryByText(left.content)).not.toBeInTheDocument()
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
        within(pane).queryByRole("article", {
          name: "Transient assistant response",
        }),
      ).not.toBeInTheDocument()
      expect(within(pane).getByText(streamedContent)).toBeVisible()
    })
    expect(useConversationStore.getState().fullNodes[completed.id]).toEqual(
      completed,
    )
    expect(document.body).not.toHaveTextContent(commitToken)
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
