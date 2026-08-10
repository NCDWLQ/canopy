import { beforeEach, describe, expect, it, vi } from "vitest"

import { selectActivePath, useConversationStore } from "./index"
import type {
  ConversationNodeView,
  ConversationSummaryView,
  ConversationTreeView,
  ConversationView,
} from "../types"
import { ConversationCommandError, type ConversationClient } from "@/lib/tauri"

const conversation: ConversationView = {
  id: "conversation-1",
  title: "Branch proof",
  rootNodeId: "root",
  isArchived: false,
}

const root: ConversationNodeView = {
  id: "root",
  conversationId: conversation.id,
  role: "user",
  content: "ROOT_SENTINEL",
  createdAt: 1,
  metadata: null,
}

const assistant: ConversationNodeView = {
  id: "assistant",
  parentId: root.id,
  conversationId: conversation.id,
  role: "assistant",
  content: "ASSISTANT_SENTINEL",
  createdAt: 2,
  metadata: null,
}

const left: ConversationNodeView = {
  id: "left",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "LEFT_BRANCH_SENTINEL",
  createdAt: 3,
  metadata: null,
}

const right: ConversationNodeView = {
  id: "right",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "RIGHT_BRANCH_SENTINEL",
  createdAt: 4,
  metadata: null,
}

const tree: ConversationTreeView = {
  conversation,
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

const summary: ConversationSummaryView = {
  ...conversation,
  updatedAt: right.createdAt,
}

const archivedSummary: ConversationSummaryView = {
  id: "conversation-archived",
  title: "Archived recent",
  rootNodeId: "archived-root",
  isArchived: true,
  updatedAt: 100,
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
}

describe("conversation store", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    resetStore()
  })

  it("loads the authoritative tree with the newest deterministic leaf selected", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    const state = useConversationStore.getState()
    expect(state.status).toBe("ready")
    expect(state.activeNodeId).toBe(right.id)
    expect(state.expandedIds).toEqual(
      new Set([root.id, assistant.id, right.id]),
    )
    expect(selectActivePath(state)).toMatchObject({
      kind: "ready",
      path: [{ id: root.id }, { id: assistant.id }, { id: right.id }],
    })
  })

  it("breaks latest-leaf timestamp ties by the greater node ID", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      nodes: [root, assistant, { ...left, createdAt: right.createdAt }, right],
    })

    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    expect(useConversationStore.getState().activeNodeId).toBe(right.id)
  })

  it("discovers history, prefers the newest unarchived conversation, and restores its latest path", async () => {
    client.listConversations.mockResolvedValueOnce([archivedSummary, summary])

    await useConversationStore.getState().initializeHistory(client)

    const state = useConversationStore.getState()
    expect(client.listConversations).toHaveBeenCalledTimes(1)
    expect(client.loadConversationTree).toHaveBeenCalledWith(conversation.id)
    expect(state.history).toEqual({
      status: "ready",
      summaries: [archivedSummary, summary],
      error: null,
    })
    expect(state.conversationId).toBe(conversation.id)
    expect(state.activeNodeId).toBe(right.id)
    const projection = selectActivePath(state)
    expect(projection.kind).toBe("ready")
    expect(projection.path.map((node) => node.id)).toEqual([
      root.id,
      assistant.id,
      right.id,
    ])
    expect(projection.path.map((node) => node.content)).not.toContain(
      left.content,
    )
  })

  it("keeps discovery loading until the selected persisted tree is installed", async () => {
    let resolveTree: ((value: ConversationTreeView) => void) | undefined
    client.listConversations.mockResolvedValueOnce([summary])
    client.loadConversationTree.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTree = resolve
      }),
    )

    const initialization = useConversationStore
      .getState()
      .initializeHistory(client)
    await vi.waitFor(() => {
      expect(client.loadConversationTree).toHaveBeenCalledWith(conversation.id)
    })

    expect(useConversationStore.getState()).toMatchObject({
      conversationId: null,
      status: "loading",
      history: { status: "loading", summaries: [summary], error: null },
    })

    resolveTree?.(tree)
    await initialization
    expect(useConversationStore.getState()).toMatchObject({
      conversationId: conversation.id,
      status: "ready",
      history: { status: "ready", summaries: [summary], error: null },
    })
  })

  it("distinguishes empty and retryable discovery failures", async () => {
    await useConversationStore.getState().initializeHistory(client)
    expect(useConversationStore.getState().history.status).toBe("empty")
    expect(useConversationStore.getState().conversationId).toBeNull()

    resetStore()
    client.listConversations.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Database unavailable.",
        retryable: true,
      }),
    )
    await useConversationStore.getState().initializeHistory(client)
    expect(useConversationStore.getState().history).toMatchObject({
      status: "error",
      summaries: [],
      error: { code: "database_unavailable", retryable: true },
    })

    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().retryHistory(client)
    expect(useConversationStore.getState().history.status).toBe("ready")
    expect(useConversationStore.getState().conversationId).toBe(conversation.id)
  })

  it("makes duplicate startup initialization idempotent and ignores its stale response after create", async () => {
    let resolveList: ((value: ConversationSummaryView[]) => void) | undefined
    client.listConversations.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )
    const firstInitialization = useConversationStore
      .getState()
      .initializeHistory(client)
    const duplicateInitialization = useConversationStore
      .getState()
      .initializeHistory(client)
    expect(client.listConversations).toHaveBeenCalledTimes(1)

    const createdTree: ConversationTreeView = {
      conversation: {
        id: "conversation-created",
        title: "Created while restoring",
        rootNodeId: "created-root",
        isArchived: false,
      },
      rootNodeId: "created-root",
      nodes: [
        {
          id: "created-root",
          conversationId: "conversation-created",
          role: "user",
          content: "CREATED_SENTINEL",
          createdAt: 200,
          metadata: null,
        },
      ],
      nodesById: {
        "created-root": {
          id: "created-root",
          role: "user",
          preview: "CREATED_SENTINEL",
          childIds: [],
        },
      },
    }
    client.createConversation.mockResolvedValueOnce(createdTree)
    await useConversationStore
      .getState()
      .createConversation(client, "Created while restoring", "CREATED_SENTINEL")
    resolveList?.([summary])
    await Promise.all([firstInitialization, duplicateInitialization])

    const state = useConversationStore.getState()
    expect(state.conversationId).toBe("conversation-created")
    expect(state.history.summaries.map((item) => item.id)).toEqual([
      "conversation-created",
    ])
    expect(client.loadConversationTree).not.toHaveBeenCalled()
  })

  it("projects exactly root-to-active order and excludes the sibling sentinel", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    useConversationStore.getState().selectNode(right.id)

    const projection = selectActivePath(useConversationStore.getState())
    expect(projection.kind).toBe("ready")
    expect(projection.path.map((node) => node.id)).toEqual([
      root.id,
      assistant.id,
      right.id,
    ])
    expect(projection.path.map((node) => node.content)).not.toContain(
      left.content,
    )
  })

  it("fails closed when the normalized tree is disconnected", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    useConversationStore.getState().selectNode(right.id)
    const disconnectedNodes = {
      ...useConversationStore.getState().fullNodes,
    }
    delete disconnectedNodes[assistant.id]
    useConversationStore.setState({ fullNodes: disconnectedNodes })

    const projection = selectActivePath(useConversationStore.getState())
    expect(projection).toMatchObject({
      kind: "error",
      path: [],
      error: { code: "tree_integrity" },
    })
    expect(projection.path).not.toContainEqual(
      expect.objectContaining({ content: left.content }),
    )
  })

  it("preserves the last valid projection and normalizes command failures", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const stateBefore = useConversationStore.getState()
    client.loadConversationTree.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Database unavailable.",
        retryable: true,
      }),
    )

    await useConversationStore.getState().loadConversation(client, "other")

    const stateAfter = useConversationStore.getState()
    expect(stateAfter.status).toBe("error")
    expect(stateAfter.error).toMatchObject({
      code: "database_unavailable",
      retryable: true,
    })
    expect(stateAfter.conversationId).toBe(stateBefore.conversationId)
    expect(stateAfter.nodesById).toBe(stateBefore.nodesById)
    expect(stateAfter.fullNodes).toBe(stateBefore.fullNodes)
  })

  it("rejects every conversation mutation after archive", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...conversation, isArchived: true },
    })
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    const state = useConversationStore.getState()
    await state.appendNode(client, "append")
    await state.createBranch(client, assistant.id, "branch")
    await state.editNodeAsBranch(client, right.id, "edit")
    await state.archiveConversation(client)

    expect(client.appendNode).not.toHaveBeenCalled()
    expect(client.createBranch).not.toHaveBeenCalled()
    expect(client.editNodeAsBranch).not.toHaveBeenCalled()
    expect(client.archiveConversation).not.toHaveBeenCalled()
  })

  it("keeps an archived conversation in the discovered history", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    client.archiveConversation.mockResolvedValueOnce({
      ...conversation,
      isArchived: true,
    })
    await useConversationStore.getState().initializeHistory(client)

    await useConversationStore.getState().archiveConversation(client)

    const state = useConversationStore.getState()
    expect(state.isArchived).toBe(true)
    expect(state.history).toMatchObject({
      status: "ready",
      summaries: [{ id: conversation.id, isArchived: true }],
    })
  })

  it("merges an authoritative edit as a sibling without changing history", async () => {
    const edited: ConversationNodeView = {
      ...right,
      id: "right-edited",
      content: "RIGHT_EDITED_SENTINEL",
      createdAt: 5,
    }
    client.editNodeAsBranch.mockResolvedValueOnce(edited)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    await useConversationStore
      .getState()
      .editNodeAsBranch(client, right.id, edited.content)

    const state = useConversationStore.getState()
    expect(state.fullNodes[right.id]).toEqual(right)
    expect(state.fullNodes[edited.id]).toEqual(edited)
    expect(state.nodesById[assistant.id]?.childIds).toEqual([
      left.id,
      right.id,
      edited.id,
    ])
    expect(state.activeNodeId).toBe(edited.id)
  })

  it("rejects a semantically mismatched mutation response without changing nodes", async () => {
    client.editNodeAsBranch.mockResolvedValueOnce({
      ...right,
      id: "foreign-node",
      conversationId: "foreign-conversation",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const nodesBefore = useConversationStore.getState().nodesById

    await useConversationStore
      .getState()
      .editNodeAsBranch(client, right.id, "unsafe")

    const state = useConversationStore.getState()
    expect(state.status).toBe("error")
    expect(state.error?.code).toBe("tree_integrity")
    expect(state.nodesById).toBe(nodesBefore)
    expect(state.nodesById["foreign-node"]).toBeUndefined()
  })
})
