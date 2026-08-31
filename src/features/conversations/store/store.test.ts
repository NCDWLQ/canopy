import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  newestLeafDescendant,
  selectActivePath,
  siblingBranchInfo,
  useConversationStore,
} from "./index"
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
    renameConversation: vi.fn<ConversationClient["renameConversation"]>(),
    deleteConversation: vi.fn<ConversationClient["deleteConversation"]>(),
    deleteConversationNode: vi
      .fn<ConversationClient["deleteConversationNode"]>()
      .mockResolvedValue({ nodeId: "left" }),
    unarchiveConversation: vi
      .fn<ConversationClient["unarchiveConversation"]>()
      .mockResolvedValue(conversation),
    searchConversations: vi
      .fn<ConversationClient["searchConversations"]>()
      .mockResolvedValue([]),
    writeExportFile: vi
      .fn<ConversationClient["writeExportFile"]>()
      .mockResolvedValue({ bytesWritten: 0 }),
    setConversationSystemPrompt:
      vi.fn<ConversationClient["setConversationSystemPrompt"]>(),
  } satisfies ConversationClient
}

function resetStore() {
  useConversationStore.setState({
    isCreatingConversation: false,
    conversationId: null,
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
    reveal: null,
    generationRuns: {},
    history: { status: "idle", summaries: [], error: null },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

describe("conversation store", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    resetStore()
  })

  it("applies title events to history and the loaded conversation only", () => {
    useConversationStore.setState({
      conversationId: "conversation-1",
      title: "占位标题",
      history: {
        status: "ready",
        summaries: [
          {
            id: "conversation-1",
            title: "占位标题",
            rootNodeId: "root-1",
            isArchived: false,
            updatedAt: 10,
          },
          {
            id: "conversation-2",
            title: "其他标题",
            rootNodeId: "root-2",
            isArchived: false,
            updatedAt: 20,
          },
        ],
        error: null,
      },
    })

    useConversationStore.getState().applyTitleUpdate({
      conversationId: "conversation-1",
      title: "生成的标题",
    })

    const state = useConversationStore.getState()
    expect(state.title).toBe("生成的标题")
    expect(
      state.history.summaries.find((summary) => summary.id === "conversation-1")
        ?.title,
    ).toBe("生成的标题")
    expect(
      state.history.summaries.find((summary) => summary.id === "conversation-2")
        ?.title,
    ).toBe("其他标题")
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

  it("breaks latest-leaf timestamp ties by ascending node ID", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      nodes: [root, assistant, { ...left, createdAt: right.createdAt }, right],
    })

    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    expect(useConversationStore.getState().activeNodeId).toBe(left.id)
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

  it("archives the current conversation when the target ID names it", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)
    client.archiveConversation.mockResolvedValueOnce({
      ...conversation,
      isArchived: true,
    })

    await useConversationStore
      .getState()
      .archiveConversation(client, conversation.id)

    const state = useConversationStore.getState()
    expect(client.archiveConversation).toHaveBeenCalledTimes(1)
    expect(client.archiveConversation).toHaveBeenCalledWith(conversation.id)
    expect(state.isArchived).toBe(true)
    expect(state.status).toBe("ready")
    expect(state.history.summaries).toMatchObject([{ isArchived: true }])
  })

  it("archives a non-current conversation by ID as a history-only mutation", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)

    client.archiveConversation.mockResolvedValueOnce({
      id: otherSummary.id,
      title: otherSummary.title,
      rootNodeId: otherSummary.rootNodeId,
      isArchived: true,
    })
    await useConversationStore
      .getState()
      .archiveConversation(client, otherSummary.id)

    expect(client.archiveConversation).toHaveBeenCalledTimes(1)
    expect(client.archiveConversation).toHaveBeenCalledWith(otherSummary.id)
    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({ status: "ready", error: null })
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id)
        ?.isArchived,
    ).toBe(true)
    // The loaded conversation keeps its full projection and status.
    expect(state.conversationId).toBe(conversation.id)
    expect(state.isArchived).toBe(false)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
  })

  it("skips a by-ID archive when the target is already archived or missing from history", async () => {
    client.listConversations.mockResolvedValueOnce([archivedSummary, summary])
    await useConversationStore.getState().initializeHistory(client)

    await useConversationStore
      .getState()
      .archiveConversation(client, archivedSummary.id)
    await useConversationStore
      .getState()
      .archiveConversation(client, "conversation-missing")

    expect(client.archiveConversation).not.toHaveBeenCalled()
    expect(useConversationStore.getState().history.status).toBe("ready")
  })

  it("routes a failed non-current archive to the history error channel without touching the global status", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)

    client.archiveConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Archive failed.",
        retryable: true,
      }),
    )
    await useConversationStore
      .getState()
      .archiveConversation(client, otherSummary.id)

    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({
      status: "error",
      error: { code: "database_unavailable", retryable: true },
    })
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id)
        ?.isArchived,
    ).toBe(false)
    expect(state.conversationId).toBe(conversation.id)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
  })

  it("flags a drifted non-current archive response on the history error channel", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)

    client.archiveConversation.mockResolvedValueOnce({
      id: "conversation-imposter",
      title: otherSummary.title,
      rootNodeId: otherSummary.rootNodeId,
      isArchived: true,
    })
    await useConversationStore
      .getState()
      .archiveConversation(client, otherSummary.id)

    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({
      status: "error",
      error: { code: "tree_integrity" },
    })
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id)
        ?.isArchived,
    ).toBe(false)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
  })

  it("archives the current conversation even while a generation is active", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)
    useConversationStore.setState({
      generationRuns: {
        [conversation.id]: {
          runId: 9,
          conversationId: conversation.id,
          parentNodeId: right.id,
          generationId: "active-gen-id",
          model: "fixture-model",
          phase: "streaming",
          thinking: "",
          content: "PARTIAL_REPLY",
          priorChildIds: [],
        },
      },
    })
    client.archiveConversation.mockResolvedValueOnce({
      ...conversation,
      isArchived: true,
    })

    await useConversationStore.getState().archiveConversation(client)

    expect(client.archiveConversation).toHaveBeenCalledTimes(1)
    expect(useConversationStore.getState().isArchived).toBe(true)
    // The archived conversation is read-only; its run record cannot linger.
    expect(
      useConversationStore.getState().generationRuns[conversation.id],
    ).toBeUndefined()
  })

  it("renames the current conversation through both the title and the summary", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)
    client.renameConversation.mockResolvedValueOnce({
      ...conversation,
      title: "手动重命名",
    })

    const failure = await useConversationStore
      .getState()
      .renameConversation(client, conversation.id, "  手动重命名  ")

    expect(failure).toBeNull()
    expect(client.renameConversation).toHaveBeenCalledWith({
      conversationId: conversation.id,
      title: "  手动重命名  ",
    })
    const state = useConversationStore.getState()
    expect(state.title).toBe("手动重命名")
    expect(
      state.history.summaries.find((item) => item.id === conversation.id)
        ?.title,
    ).toBe("手动重命名")
  })

  it("renames a non-current conversation as a summary-only mutation and reports failures to the caller", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)
    client.renameConversation.mockResolvedValueOnce({
      id: otherSummary.id,
      title: "Renamed elsewhere",
      rootNodeId: otherSummary.rootNodeId,
      isArchived: false,
    })

    const renamed = await useConversationStore
      .getState()
      .renameConversation(client, otherSummary.id, "Renamed elsewhere")

    expect(renamed).toBeNull()
    const state = useConversationStore.getState()
    expect(state.title).toBe(conversation.title)
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id)
        ?.title,
    ).toBe("Renamed elsewhere")
    // Renaming must not reorder the sidebar: the summary keeps its
    // updated_at, so the newest-first order stays put.
    expect(state.history.summaries.map((item) => item.id)).toEqual([
      conversation.id,
      otherSummary.id,
    ])

    client.renameConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "not_found",
        message: "Conversation is gone.",
        retryable: false,
      }),
    )
    const failure = await useConversationStore
      .getState()
      .renameConversation(client, otherSummary.id, "missing")
    expect(failure).toMatchObject({ code: "not_found", retryable: false })
    expect(useConversationStore.getState().status).toBe("ready")
    expect(useConversationStore.getState().error).toBeNull()

    client.renameConversation.mockResolvedValueOnce({
      ...conversation,
      id: "conversation-imposter",
      title: "Drifted",
    })
    const drifted = await useConversationStore
      .getState()
      .renameConversation(client, otherSummary.id, "drift")
    expect(drifted).toMatchObject({ code: "tree_integrity" })
  })

  it("deletes a non-current conversation as a history-only mutation and clears its run record", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)
    useConversationStore.setState({
      generationRuns: {
        "conversation-other": {
          runId: 12,
          conversationId: "conversation-other",
          parentNodeId: "other-root",
          priorChildIds: [],
          phase: "cancelled",
          content: "",
        },
      },
    })
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: otherSummary.id,
    })

    await useConversationStore
      .getState()
      .deleteConversation(client, otherSummary.id)

    const state = useConversationStore.getState()
    expect(client.deleteConversation).toHaveBeenCalledWith(otherSummary.id)
    expect(state.history).toMatchObject({
      status: "ready",
      summaries: [summary],
      error: null,
    })
    expect(state.generationRuns["conversation-other"]).toBeUndefined()
    // The loaded conversation keeps its full projection and status.
    expect(state.conversationId).toBe(conversation.id)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
  })

  it("routes a failed non-current delete to the history error channel", async () => {
    const otherSummary: ConversationSummaryView = {
      id: "conversation-other",
      title: "Other row",
      rootNodeId: "other-root",
      isArchived: false,
      updatedAt: 1,
    }
    client.listConversations.mockResolvedValueOnce([summary, otherSummary])
    await useConversationStore.getState().initializeHistory(client)
    client.deleteConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Delete failed.",
        retryable: true,
      }),
    )

    await useConversationStore
      .getState()
      .deleteConversation(client, otherSummary.id)

    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({
      status: "error",
      error: { code: "database_unavailable", retryable: true },
    })
    expect(
      state.history.summaries.find((item) => item.id === otherSummary.id),
    ).toBeDefined()
    expect(state.conversationId).toBe(conversation.id)
    expect(state.status).toBe("ready")
  })

  it("deletes the current conversation back to the blank state without loading another conversation", async () => {
    client.listConversations.mockResolvedValueOnce([summary, archivedSummary])
    await useConversationStore.getState().initializeHistory(client)
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: conversation.id,
    })

    await useConversationStore
      .getState()
      .deleteConversation(client, conversation.id)

    const state = useConversationStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.title).toBeNull()
    expect(state.rootNodeId).toBeNull()
    expect(state.activeNodeId).toBeNull()
    expect(state.nodesById).toEqual({})
    expect(state.fullNodes).toEqual({})
    expect(state.status).toBe("idle")
    expect(state.isCreatingConversation).toBe(true)
    expect(state.history).toMatchObject({
      status: "ready",
      summaries: [archivedSummary],
      error: null,
    })
    // No landing conversation is auto-loaded after the deletion.
    expect(client.loadConversationTree).toHaveBeenCalledTimes(1)
  })

  it("deleting the last current conversation lands on the empty history state and clears its run record", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)
    useConversationStore.setState({
      generationRuns: {
        [conversation.id]: {
          runId: 13,
          conversationId: conversation.id,
          parentNodeId: right.id,
          generationId: "delete-gen-id",
          model: "fixture-model",
          phase: "streaming",
          thinking: "",
          content: "PARTIAL_REPLY",
          priorChildIds: [],
        },
      },
    })
    client.deleteConversation.mockResolvedValueOnce({
      conversationId: conversation.id,
    })

    await useConversationStore
      .getState()
      .deleteConversation(client, conversation.id)

    const state = useConversationStore.getState()
    expect(state.conversationId).toBeNull()
    expect(state.status).toBe("idle")
    expect(state.generationRuns[conversation.id]).toBeUndefined()
    expect(state.history).toEqual({
      status: "empty",
      summaries: [],
      error: null,
    })
  })

  it("keeps the loaded projection when a current delete drifts or fails", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)

    client.deleteConversation.mockResolvedValueOnce({
      conversationId: "conversation-imposter",
    })
    await useConversationStore
      .getState()
      .deleteConversation(client, conversation.id)
    let state = useConversationStore.getState()
    expect(state.status).toBe("error")
    expect(state.error).toMatchObject({ code: "tree_integrity" })
    expect(state.conversationId).toBe(conversation.id)

    client.deleteConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Delete failed.",
        retryable: true,
      }),
    )
    await useConversationStore
      .getState()
      .deleteConversation(client, conversation.id)
    state = useConversationStore.getState()
    expect(state.status).toBe("error")
    expect(state.error).toMatchObject({
      code: "database_unavailable",
      retryable: true,
    })
    expect(state.conversationId).toBe(conversation.id)
    expect(state.history.status).toBe("ready")
  })

  it("unarchives the current conversation, clearing its read-only state", async () => {
    const archivedTree = {
      ...tree,
      conversation: { ...conversation, isArchived: true },
    }
    client.loadConversationTree.mockResolvedValueOnce(archivedTree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...summary, isArchived: true }],
        error: null,
      },
    })
    client.unarchiveConversation.mockResolvedValueOnce(conversation)

    await useConversationStore
      .getState()
      .unarchiveConversation(client, conversation.id)

    const state = useConversationStore.getState()
    expect(client.unarchiveConversation).toHaveBeenCalledWith(conversation.id)
    expect(state.isArchived).toBe(false)
    expect(state.status).toBe("ready")
    expect(
      state.history.summaries.find((item) => item.id === conversation.id)
        ?.isArchived,
    ).toBe(false)
  })

  it("unarchives a non-current conversation as a summary-only mutation", async () => {
    client.listConversations.mockResolvedValueOnce([summary, archivedSummary])
    await useConversationStore.getState().initializeHistory(client)
    client.unarchiveConversation.mockResolvedValueOnce({
      id: archivedSummary.id,
      title: archivedSummary.title,
      rootNodeId: archivedSummary.rootNodeId,
      isArchived: false,
    })

    await useConversationStore
      .getState()
      .unarchiveConversation(client, archivedSummary.id)

    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({ status: "ready", error: null })
    expect(
      state.history.summaries.find((item) => item.id === archivedSummary.id)
        ?.isArchived,
    ).toBe(false)
    expect(state.conversationId).toBe(conversation.id)
    expect(state.isArchived).toBe(false)
    expect(state.status).toBe("ready")
  })

  it("skips unarchive guards and routes drift or failures to the owning channel", async () => {
    client.listConversations.mockResolvedValueOnce([summary, archivedSummary])
    await useConversationStore.getState().initializeHistory(client)

    // Already-active targets are no-ops on both channels.
    await useConversationStore
      .getState()
      .unarchiveConversation(client, conversation.id)
    expect(client.unarchiveConversation).not.toHaveBeenCalled()

    client.unarchiveConversation.mockResolvedValueOnce({
      id: archivedSummary.id,
      title: archivedSummary.title,
      rootNodeId: archivedSummary.rootNodeId,
      isArchived: true,
    })
    await useConversationStore
      .getState()
      .unarchiveConversation(client, archivedSummary.id)
    expect(useConversationStore.getState().history).toMatchObject({
      status: "error",
      error: { code: "tree_integrity" },
    })

    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [summary, archivedSummary],
        error: null,
      },
    })
    client.unarchiveConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Unarchive failed.",
        retryable: true,
      }),
    )
    await useConversationStore
      .getState()
      .unarchiveConversation(client, archivedSummary.id)
    const state = useConversationStore.getState()
    expect(state.history).toMatchObject({
      status: "error",
      error: { code: "database_unavailable", retryable: true },
    })
    expect(state.conversationId).toBe(conversation.id)
    expect(state.status).toBe("ready")
    expect(state.error).toBeNull()
  })

  it("enters blank creation without replacing the loaded tree or history", async () => {
    client.listConversations.mockResolvedValueOnce([summary])
    await useConversationStore.getState().initializeHistory(client)
    const before = useConversationStore.getState()

    before.enterConversationCreation()

    const creating = useConversationStore.getState()
    expect(creating.isCreatingConversation).toBe(true)
    expect(creating.conversationId).toBe(before.conversationId)
    expect(creating.activeNodeId).toBe(before.activeNodeId)
    expect(creating.nodesById).toBe(before.nodesById)
    expect(creating.fullNodes).toBe(before.fullNodes)
    expect(creating.history).toBe(before.history)

    await creating.selectConversation(client, conversation.id)
    expect(useConversationStore.getState().isCreatingConversation).toBe(false)
  })

  it("retains creation mode and its safe tree projection after create failure", async () => {
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const nodesBefore = useConversationStore.getState().nodesById
    useConversationStore.getState().enterConversationCreation()
    client.createConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Conversation could not be saved.",
        retryable: true,
      }),
    )

    await useConversationStore
      .getState()
      .createConversation(client, "Retry title", "Retry content")

    expect(useConversationStore.getState()).toMatchObject({
      isCreatingConversation: true,
      conversationId: conversation.id,
      activeNodeId: right.id,
      status: "error",
      error: { code: "database_unavailable", retryable: true },
    })
    expect(useConversationStore.getState().nodesById).toBe(nodesBefore)
  })

  it("merges deferred append, branch, and edit results without stealing newer selection", async () => {
    const appendableTree: ConversationTreeView = {
      ...tree,
      nodes: [root, assistant],
      nodesById: {
        root: tree.nodesById.root!,
        assistant: { ...tree.nodesById.assistant!, childIds: [] },
      },
    }
    client.loadConversationTree.mockResolvedValueOnce(appendableTree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const appended: ConversationNodeView = {
      ...right,
      id: "deferred-append",
      parentId: assistant.id,
      content: "DEFERRED_APPEND_SENTINEL",
      createdAt: 5,
    }
    const append = deferred<ConversationNodeView>()
    client.appendNode.mockReturnValueOnce(append.promise)
    const appendOperation = useConversationStore
      .getState()
      .appendNode(client, appended.content)
    useConversationStore.getState().selectNode(root.id)
    append.resolve(appended)
    await appendOperation
    expect(useConversationStore.getState().activeNodeId).toBe(root.id)
    expect(useConversationStore.getState().fullNodes[appended.id]).toEqual(
      appended,
    )

    client.loadConversationTree.mockResolvedValueOnce(tree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const branched: ConversationNodeView = {
      ...right,
      id: "deferred-branch",
      content: "DEFERRED_BRANCH_SENTINEL",
      createdAt: 6,
    }
    const branch = deferred<ConversationNodeView>()
    client.createBranch.mockReturnValueOnce(branch.promise)
    const branchOperation = useConversationStore
      .getState()
      .createBranch(client, assistant.id, branched.content)
    useConversationStore.getState().selectNode(left.id)
    branch.resolve(branched)
    await branchOperation
    expect(useConversationStore.getState().activeNodeId).toBe(left.id)
    expect(useConversationStore.getState().fullNodes[branched.id]).toEqual(
      branched,
    )

    client.loadConversationTree.mockResolvedValueOnce(tree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const edited: ConversationNodeView = {
      ...right,
      id: "deferred-edit",
      content: "DEFERRED_EDIT_SENTINEL",
      createdAt: 7,
    }
    const edit = deferred<ConversationNodeView>()
    client.editNodeAsBranch.mockReturnValueOnce(edit.promise)
    const editOperation = useConversationStore
      .getState()
      .editNodeAsBranch(client, right.id, edited.content)
    useConversationStore.getState().selectNode(left.id)
    edit.resolve(edited)
    await editOperation
    expect(useConversationStore.getState().activeNodeId).toBe(left.id)
    expect(useConversationStore.getState().fullNodes[edited.id]).toEqual(edited)
  })

  it("rejects deferred mutation results and errors invalidated by blank mode", async () => {
    const appendableTree: ConversationTreeView = {
      ...tree,
      nodes: [root, assistant],
      nodesById: {
        root: tree.nodesById.root!,
        assistant: { ...tree.nodesById.assistant!, childIds: [] },
      },
    }
    client.loadConversationTree.mockResolvedValue(appendableTree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const append = deferred<ConversationNodeView>()
    client.appendNode.mockReturnValueOnce(append.promise)
    const appendOperation = useConversationStore
      .getState()
      .appendNode(client, "STALE_APPEND_SENTINEL")
    useConversationStore.getState().enterConversationCreation()
    append.resolve({
      ...right,
      id: "stale-append",
      parentId: assistant.id,
      content: "STALE_APPEND_SENTINEL",
    })
    await appendOperation
    expect(useConversationStore.getState()).toMatchObject({
      isCreatingConversation: true,
      status: "ready",
      error: null,
    })
    expect(
      useConversationStore.getState().fullNodes["stale-append"],
    ).toBeUndefined()

    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const failedAppend = deferred<ConversationNodeView>()
    client.appendNode.mockReturnValueOnce(failedAppend.promise)
    const failedOperation = useConversationStore
      .getState()
      .appendNode(client, "STALE_FAILURE_SENTINEL")
    useConversationStore.getState().enterConversationCreation()
    failedAppend.reject(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Stale failure.",
        retryable: true,
      }),
    )
    await failedOperation
    expect(useConversationStore.getState()).toMatchObject({
      isCreatingConversation: true,
      status: "ready",
      error: null,
    })
  })

  it("rejects a deferred mutation result after a newer conversation load", async () => {
    const appendableTree: ConversationTreeView = {
      ...tree,
      nodes: [root, assistant],
      nodesById: {
        root: tree.nodesById.root!,
        assistant: { ...tree.nodesById.assistant!, childIds: [] },
      },
    }
    const replacementRoot: ConversationNodeView = {
      id: "replacement-root",
      conversationId: "conversation-2",
      role: "user",
      content: "REPLACEMENT_ROOT_SENTINEL",
      createdAt: 10,
      metadata: null,
    }
    const replacementTree: ConversationTreeView = {
      conversation: {
        id: replacementRoot.conversationId,
        title: "Replacement",
        rootNodeId: replacementRoot.id,
        isArchived: false,
      },
      rootNodeId: replacementRoot.id,
      nodes: [replacementRoot],
      nodesById: {
        [replacementRoot.id]: {
          id: replacementRoot.id,
          role: replacementRoot.role,
          preview: replacementRoot.content,
          childIds: [],
        },
      },
    }
    client.loadConversationTree
      .mockResolvedValueOnce(appendableTree)
      .mockResolvedValueOnce(replacementTree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const append = deferred<ConversationNodeView>()
    client.appendNode.mockReturnValueOnce(append.promise)
    const appendOperation = useConversationStore
      .getState()
      .appendNode(client, "STALE_AFTER_LOAD_SENTINEL")

    await useConversationStore
      .getState()
      .loadConversation(client, replacementRoot.conversationId)
    append.resolve({
      ...right,
      id: "stale-after-load",
      parentId: assistant.id,
      content: "STALE_AFTER_LOAD_SENTINEL",
    })
    await appendOperation

    expect(useConversationStore.getState()).toMatchObject({
      conversationId: replacementRoot.conversationId,
      rootNodeId: replacementRoot.id,
      activeNodeId: replacementRoot.id,
      status: "ready",
      error: null,
    })
    expect(
      useConversationStore.getState().fullNodes["stale-after-load"],
    ).toBeUndefined()
  })

  it("gives overlapping same-conversation mutations unique completion ownership", async () => {
    const appendableTree: ConversationTreeView = {
      ...tree,
      nodes: [root, assistant],
      nodesById: {
        root: tree.nodesById.root!,
        assistant: { ...tree.nodesById.assistant!, childIds: [] },
      },
    }
    client.loadConversationTree.mockResolvedValueOnce(appendableTree)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    const first = deferred<ConversationNodeView>()
    const second = deferred<ConversationNodeView>()
    client.appendNode
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const firstOperation = useConversationStore
      .getState()
      .appendNode(client, "FIRST_OVERLAP_SENTINEL")

    // A normal UI cannot start a second mutation while loading. Force the
    // overlap to prove request ownership remains safe if another caller does.
    useConversationStore.setState({ status: "ready" })
    const secondOperation = useConversationStore
      .getState()
      .appendNode(client, "SECOND_OVERLAP_SENTINEL")
    const secondNode: ConversationNodeView = {
      ...right,
      id: "second-overlap",
      parentId: assistant.id,
      content: "SECOND_OVERLAP_SENTINEL",
      createdAt: 6,
    }
    second.resolve(secondNode)
    await secondOperation

    first.resolve({
      ...right,
      id: "first-overlap",
      parentId: assistant.id,
      content: "FIRST_OVERLAP_SENTINEL",
      createdAt: 5,
    })
    await firstOperation

    expect(useConversationStore.getState().activeNodeId).toBe(secondNode.id)
    expect(useConversationStore.getState().fullNodes[secondNode.id]).toEqual(
      secondNode,
    )
    expect(
      useConversationStore.getState().fullNodes["first-overlap"],
    ).toBeUndefined()
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

  it("projects persisted assistant thinking onto the active path", async () => {
    const thinkingAssistant: ConversationNodeView = {
      ...assistant,
      thinking: "REASONING_SENTINEL",
    }
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      nodes: [root, thinkingAssistant, left, right],
    })
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    const projection = selectActivePath(useConversationStore.getState())
    expect(projection.kind).toBe("ready")
    if (projection.kind !== "ready") return
    expect(
      projection.path.find((node) => node.id === assistant.id)?.thinking,
    ).toBe("REASONING_SENTINEL")
    expect(
      projection.path.find((node) => node.id === root.id)?.thinking,
    ).toBeUndefined()
  })

  it("applies the authoritative conversation binding and effort together", async () => {
    const setConversationProvider = vi
      .fn<NonNullable<ConversationClient["setConversationProvider"]>>()
      .mockResolvedValue({
        id: conversation.id,
        providerId: "provider-a",
        model: "provider-a-model",
        reasoningEffort: "high",
      })
    const boundClient = {
      ...client,
      setConversationProvider,
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(boundClient, conversation.id)
    useConversationStore.setState({
      history: { status: "ready", summaries: [summary], error: null },
    })

    await useConversationStore.getState().setConversationProvider(boundClient, {
      binding: { providerId: "provider-a", model: "provider-a-model" },
      reasoningEffort: "high",
    })

    const state = useConversationStore.getState()
    expect(state.providerId).toBe("provider-a")
    expect(state.model).toBe("provider-a-model")
    expect(state.reasoningEffort).toBe("high")
    expect(
      state.history.summaries.find((item) => item.id === conversation.id),
    ).toMatchObject({
      providerId: "provider-a",
      model: "provider-a-model",
      reasoningEffort: "high",
    })
  })

  it("clears the binding while keeping effort, and surfaces binding errors", async () => {
    const setConversationProvider = vi
      .fn<NonNullable<ConversationClient["setConversationProvider"]>>()
      .mockResolvedValueOnce({
        id: conversation.id,
        providerId: null,
        model: null,
        reasoningEffort: "low",
      })
    const boundClient = {
      ...client,
      setConversationProvider,
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(boundClient, conversation.id)

    await useConversationStore.getState().setConversationProvider(boundClient, {
      binding: null,
      reasoningEffort: "low",
    })

    const cleared = useConversationStore.getState()
    expect(cleared.providerId).toBeNull()
    expect(cleared.model).toBeNull()
    expect(cleared.reasoningEffort).toBe("low")

    setConversationProvider.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "not_found",
        message: "Provider is gone.",
        retryable: false,
      }),
    )
    await useConversationStore.getState().setConversationProvider(boundClient, {
      binding: { providerId: "missing", model: "model" },
      reasoningEffort: null,
    })
    const failed = useConversationStore.getState()
    expect(failed.error?.code).toBe("not_found")
    expect(failed.providerId).toBeNull()
  })

  it("applies an authoritative system prompt without rewriting history", async () => {
    client.setConversationSystemPrompt.mockResolvedValue({
      id: conversation.id,
      systemPrompt: "Be concise",
    })
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    useConversationStore.setState({
      history: { status: "ready", summaries: [summary], error: null },
    })

    await useConversationStore
      .getState()
      .setConversationSystemPrompt(client, "Be concise")

    const state = useConversationStore.getState()
    expect(state.systemPrompt).toBe("Be concise")
    expect(state.history.summaries).toEqual([summary])
    expect(client.setConversationSystemPrompt).toHaveBeenCalledWith({
      conversationId: conversation.id,
      systemPrompt: "Be concise",
    })
  })

  it("ignores a stale system-prompt write after a newer request", async () => {
    const first = deferred<{ id: string; systemPrompt: string | null }>()
    const second = deferred<{ id: string; systemPrompt: string | null }>()
    client.setConversationSystemPrompt
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    const firstWrite = useConversationStore
      .getState()
      .setConversationSystemPrompt(client, "first")
    const secondWrite = useConversationStore
      .getState()
      .setConversationSystemPrompt(client, "second")
    first.resolve({ id: conversation.id, systemPrompt: "first" })
    await firstWrite
    expect(useConversationStore.getState().systemPrompt).toBeNull()

    second.resolve({ id: conversation.id, systemPrompt: "second" })
    await secondWrite
    expect(useConversationStore.getState().systemPrompt).toBe("second")
  })

  it("does not write a system prompt when unloaded or archived", async () => {
    await useConversationStore
      .getState()
      .setConversationSystemPrompt(client, "ignored")
    expect(client.setConversationSystemPrompt).not.toHaveBeenCalled()

    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    useConversationStore.setState({ isArchived: true })
    await useConversationStore
      .getState()
      .setConversationSystemPrompt(client, "ignored")
    expect(client.setConversationSystemPrompt).not.toHaveBeenCalled()
  })

  it("loads a stored system prompt and clears draft prompt on create entry", async () => {
    client.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      conversation: { ...conversation, systemPrompt: "Loaded prompt" },
    })
    useConversationStore.getState().setDraftSystemPrompt("Draft prompt")
    expect(useConversationStore.getState().draftSystemPrompt).toBe(
      "Draft prompt",
    )

    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)
    expect(useConversationStore.getState().systemPrompt).toBe("Loaded prompt")
    expect(useConversationStore.getState().draftSystemPrompt).toBeNull()

    useConversationStore.getState().setDraftSystemPrompt("Next draft")
    useConversationStore.getState().enterConversationCreation()
    expect(useConversationStore.getState().draftSystemPrompt).toBeNull()
    expect(useConversationStore.getState().systemPrompt).toBe("Loaded prompt")
  })

  it("deleteNodeSubtree removes the branch locally and redirects active selection to the parent", async () => {
    client.deleteConversationNode.mockResolvedValueOnce({ nodeId: left.id })
    useConversationStore.setState({
      conversationId: conversation.id,
      rootNodeId: root.id,
      activeNodeId: left.id,
      nodesById: tree.nodesById,
      fullNodes: Object.fromEntries(tree.nodes.map((node) => [node.id, node])),
      expandedIds: new Set([root.id, assistant.id, left.id]),
      status: "ready",
      error: null,
    })

    await useConversationStore.getState().deleteNodeSubtree(client, left.id)

    const state = useConversationStore.getState()
    expect(client.deleteConversationNode).toHaveBeenCalledWith({
      conversationId: conversation.id,
      nodeId: left.id,
    })
    expect(state.nodesById[left.id]).toBeUndefined()
    expect(state.nodesById[assistant.id]?.childIds).toEqual([right.id])
    expect(state.activeNodeId).toBe(assistant.id)
    expect(selectActivePath(state).kind).toBe("ready")
  })

  it("deleteNodeSubtree clears an active generation run rooted in the deleted subtree", async () => {
    client.deleteConversationNode.mockResolvedValueOnce({ nodeId: left.id })
    useConversationStore.setState({
      conversationId: conversation.id,
      rootNodeId: root.id,
      activeNodeId: right.id,
      nodesById: tree.nodesById,
      fullNodes: Object.fromEntries(tree.nodes.map((node) => [node.id, node])),
      expandedIds: new Set([root.id, assistant.id, right.id]),
      status: "ready",
      error: null,
      generationRuns: {
        [conversation.id]: {
          runId: 7,
          conversationId: conversation.id,
          parentNodeId: left.id,
          generationId: "gen-left",
          model: "fixture-model",
          phase: "streaming",
          thinking: "",
          content: "PARTIAL",
          priorChildIds: [],
        },
      },
    })

    await useConversationStore.getState().deleteNodeSubtree(client, left.id)

    expect(
      useConversationStore.getState().generationRuns[conversation.id],
    ).toBe(undefined)
  })
})

describe("selectBranchAtNode", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    client.loadConversationTree.mockResolvedValue(tree)
    resetStore()
  })

  async function loadConversationFirst() {
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [summary],
        error: null,
      },
    })
    await useConversationStore
      .getState()
      .selectConversation(client, conversation.id)
  }

  it("activates the branch through the clicked node to its newest leaf", async () => {
    await loadConversationFirst()

    useConversationStore.getState().selectBranchAtNode(assistant.id)

    const state = useConversationStore.getState()
    expect(state.activeNodeId).toBe(right.id)
    // Queryless reveal scrolls the pane to the clicked message only.
    expect(state.reveal).toEqual({
      conversationId: conversation.id,
      nodeId: assistant.id,
      query: "",
    })
    for (const id of [root.id, assistant.id, right.id]) {
      expect(state.expandedIds.has(id)).toBe(true)
    }
    const projection = selectActivePath(state)
    expect(projection.kind).toBe("ready")
    if (projection.kind === "ready") {
      expect(projection.path.map((message) => message.id)).toEqual([
        root.id,
        assistant.id,
        right.id,
      ])
    }
  })

  it("keeps a leaf click on itself and reveals it", async () => {
    await loadConversationFirst()

    useConversationStore.getState().selectBranchAtNode(left.id)

    const state = useConversationStore.getState()
    expect(state.activeNodeId).toBe(left.id)
    expect(state.reveal).toEqual({
      conversationId: conversation.id,
      nodeId: left.id,
      query: "",
    })
  })

  it("ignores unknown node ids without touching state", async () => {
    await loadConversationFirst()
    const before = useConversationStore.getState()

    useConversationStore.getState().selectBranchAtNode("ghost-node")

    const state = useConversationStore.getState()
    expect(state.activeNodeId).toBe(before.activeNodeId)
    expect(state.reveal).toBe(before.reveal)
    expect(state.expandedIds).toBe(before.expandedIds)
  })
})

describe("revealSearchHit", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    client.loadConversationTree.mockResolvedValue(tree)
    resetStore()
  })

  async function loadConversationFirst() {
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [summary],
        error: null,
      },
    })
    await useConversationStore
      .getState()
      .selectConversation(client, conversation.id)
  }

  it("loads a foreign conversation and reveals the hit branch with its newest leaf", async () => {
    await useConversationStore
      .getState()
      .revealSearchHit(client, conversation.id, assistant.id, "SENTINEL")

    const state = useConversationStore.getState()
    expect(state.conversationId).toBe(conversation.id)
    // The hit is mid-path; the view extends to the newest leaf of its subtree.
    expect(state.activeNodeId).toBe(right.id)
    expect(state.reveal).toEqual({
      conversationId: conversation.id,
      nodeId: assistant.id,
      query: "SENTINEL",
    })
    const projection = selectActivePath(state)
    expect(projection.kind).toBe("ready")
    if (projection.kind === "ready") {
      expect(projection.path.map((message) => message.id)).toEqual([
        root.id,
        assistant.id,
        right.id,
      ])
    }
  })

  it("switches the visible branch without reloading when the conversation is already loaded", async () => {
    await loadConversationFirst()
    client.loadConversationTree.mockClear()

    await useConversationStore
      .getState()
      .revealSearchHit(client, conversation.id, left.id, "LEFT")

    const state = useConversationStore.getState()
    expect(client.loadConversationTree).not.toHaveBeenCalled()
    expect(state.activeNodeId).toBe(left.id)
    const projection = selectActivePath(state)
    if (projection.kind === "ready") {
      expect(projection.path.map((message) => message.id)).toEqual([
        root.id,
        assistant.id,
        left.id,
      ])
      // The inactive sibling branch stays out of the revealed path.
      expect(projection.path.some((message) => message.id === right.id)).toBe(
        false,
      )
    }
  })

  it("opens a title-only hit on the default view without a pane reveal", async () => {
    await useConversationStore
      .getState()
      .revealSearchHit(client, conversation.id, null, "Branch")

    const state = useConversationStore.getState()
    expect(state.conversationId).toBe(conversation.id)
    expect(state.activeNodeId).toBe(right.id)
    expect(state.reveal).toBeNull()
  })

  it("ignores unknown node ids instead of switching the path", async () => {
    await loadConversationFirst()
    useConversationStore.setState({
      reveal: {
        conversationId: conversation.id,
        nodeId: right.id,
        query: "RIGHT",
      },
    })

    await useConversationStore
      .getState()
      .revealSearchHit(client, conversation.id, "ghost-node", "ghost")

    const state = useConversationStore.getState()
    expect(state.activeNodeId).toBe(right.id)
    expect(state.reveal).toBeNull()
  })

  it("clears the previous reveal as soon as a new navigation starts", async () => {
    await loadConversationFirst()
    useConversationStore.setState({
      reveal: {
        conversationId: conversation.id,
        nodeId: right.id,
        query: "RIGHT",
      },
    })
    client.loadConversationTree.mockRejectedValueOnce(new Error("offline"))

    const pending = useConversationStore
      .getState()
      .revealSearchHit(client, "another-conversation", "node", "query")
    expect(useConversationStore.getState().reveal).toBeNull()
    await pending
    expect(useConversationStore.getState().reveal).toBeNull()
  })

  it("clears the reveal on the next node selection", async () => {
    await useConversationStore
      .getState()
      .revealSearchHit(client, conversation.id, assistant.id, "SENTINEL")
    expect(useConversationStore.getState().reveal).not.toBeNull()

    useConversationStore.getState().selectNode(left.id)

    const state = useConversationStore.getState()
    expect(state.activeNodeId).toBe(left.id)
    expect(state.reveal).toBeNull()
  })

  it("uses ascending id as the deterministic tie-break for equally new leaves", () => {
    const tiedFullNodes = {
      ...tree.nodes.reduce<Record<string, ConversationNodeView>>(
        (nodes, node) => ({ ...nodes, [node.id]: node }),
        {},
      ),
      left: { ...left, createdAt: 4 },
    }
    expect(
      newestLeafDescendant(tree.nodesById, tiedFullNodes, assistant.id),
    ).toBe("left")
  })
})

describe("siblingBranchInfo", () => {
  it("returns null for the root and for nodes without siblings", () => {
    expect(siblingBranchInfo(tree.nodesById, root.id)).toBeNull()
    expect(siblingBranchInfo(tree.nodesById, assistant.id)).toBeNull()
  })

  it("returns index, count, and adjacent sibling ids for branch leaves", () => {
    expect(siblingBranchInfo(tree.nodesById, left.id)).toEqual({
      index: 0,
      count: 2,
      nextId: right.id,
    })
    expect(siblingBranchInfo(tree.nodesById, right.id)).toEqual({
      index: 1,
      count: 2,
      prevId: left.id,
    })
  })

  it("returns null when the node id is missing from the parent child list", () => {
    const brokenNodesById = {
      ...tree.nodesById,
      assistant: {
        ...tree.nodesById.assistant,
        childIds: ["ghost"],
      },
    } as typeof tree.nodesById
    expect(siblingBranchInfo(brokenNodesById, left.id)).toBeNull()
  })

  it("keeps selectActivePath path reference stable across generation-only updates", () => {
    useConversationStore.setState({
      isCreatingConversation: false,
      conversationId: conversation.id,
      isArchived: false,
      rootNodeId: root.id,
      activeNodeId: right.id,
      nodesById: tree.nodesById,
      fullNodes: {
        [root.id]: root,
        [assistant.id]: assistant,
        [left.id]: left,
        [right.id]: right,
      },
      expandedIds: new Set([root.id, assistant.id, right.id]),
      status: "ready",
      error: null,
      generationRuns: {},
      history: { status: "ready", summaries: [summary], error: null },
    })

    const stateBefore = useConversationStore.getState()
    const projectionBefore = selectActivePath(stateBefore)
    expect(projectionBefore.kind).toBe("ready")

    useConversationStore.setState({
      generationRuns: {
        [conversation.id]: {
          phase: "streaming",
          runId: 1,
          conversationId: conversation.id,
          parentNodeId: right.id,
          priorChildIds: [],
          generationId: "11111111-1111-4111-8111-111111111111",
          model: "fixture-model",
          content: "STREAM_DELTA",
          thinking: "",
        },
      },
    })

    const projectionAfter = selectActivePath(useConversationStore.getState())
    expect(projectionAfter.kind).toBe("ready")
    if (projectionBefore.kind === "ready" && projectionAfter.kind === "ready") {
      expect(projectionAfter.path).toBe(projectionBefore.path)
    }
  })

  it("rebuilds selectActivePath when the active node changes", () => {
    useConversationStore.setState({
      isCreatingConversation: false,
      conversationId: conversation.id,
      isArchived: false,
      rootNodeId: root.id,
      activeNodeId: right.id,
      nodesById: tree.nodesById,
      fullNodes: {
        [root.id]: root,
        [assistant.id]: assistant,
        [left.id]: left,
        [right.id]: right,
      },
      expandedIds: new Set([root.id, assistant.id, right.id]),
      status: "ready",
      error: null,
      generationRuns: {},
      history: { status: "ready", summaries: [summary], error: null },
    })

    const projectionBefore = selectActivePath(useConversationStore.getState())
    useConversationStore.setState({ activeNodeId: left.id })
    const projectionAfter = selectActivePath(useConversationStore.getState())

    expect(projectionBefore.kind).toBe("ready")
    expect(projectionAfter.kind).toBe("ready")
    if (projectionBefore.kind === "ready" && projectionAfter.kind === "ready") {
      expect(projectionAfter.path).not.toBe(projectionBefore.path)
      expect(projectionAfter.path.map((message) => message.id)).toEqual([
        root.id,
        assistant.id,
        left.id,
      ])
    }
  })
})
