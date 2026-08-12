import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceGenerationController } from "./useWorkspaceGenerationController"
import { selectActivePath, useConversationStore } from "../store"
import type {
  ConversationNodeView,
  ConversationTreeView,
  ConversationView,
} from "../types"
import { useProviderProfileStore } from "@/features/providers/store"
import type {
  GenerationEventView,
  ProviderProfileView,
} from "@/features/providers/types"
import {
  ConversationCommandError,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

const conversation: ConversationView = {
  id: "controller-conversation",
  title: "Controller proof",
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
  model: "old-model",
  createdAt: 2,
  metadata: null,
}

const left: ConversationNodeView = {
  id: "left",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "LEFT_SIBLING_SENTINEL",
  createdAt: 3,
  metadata: null,
}

const right: ConversationNodeView = {
  id: "right",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "RIGHT_ACTIVE_SENTINEL",
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

const inactiveAssistant: ConversationNodeView = {
  id: "inactive-assistant",
  parentId: root.id,
  conversationId: conversation.id,
  role: "assistant",
  content: "INACTIVE_ASSISTANT_SENTINEL",
  model: "old-model",
  createdAt: 2,
  metadata: null,
}

const appendableTree: ConversationTreeView = {
  ...tree,
  nodes: [root, inactiveAssistant, assistant],
  nodesById: {
    root: {
      ...tree.nodesById.root!,
      childIds: [inactiveAssistant.id, assistant.id],
    },
    [inactiveAssistant.id]: {
      id: inactiveAssistant.id,
      parentId: root.id,
      role: inactiveAssistant.role,
      preview: inactiveAssistant.content,
      childIds: [],
    },
    assistant: { ...tree.nodesById.assistant!, childIds: [] },
  },
}

const appendedUser: ConversationNodeView = {
  id: "appended-user",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "APPENDED_USER_SENTINEL",
  createdAt: 5,
  metadata: null,
}

const createdConversation: ConversationView = {
  id: "created-conversation",
  title: "CREATED_ROOT_SENTINEL",
  rootNodeId: "created-root",
  isArchived: false,
}

const createdRoot: ConversationNodeView = {
  id: createdConversation.rootNodeId,
  conversationId: createdConversation.id,
  role: "user",
  content: "CREATED_ROOT_SENTINEL",
  createdAt: 10,
  metadata: null,
}

const createdTree: ConversationTreeView = {
  conversation: createdConversation,
  rootNodeId: createdRoot.id,
  nodes: [createdRoot],
  nodesById: {
    [createdRoot.id]: {
      id: createdRoot.id,
      role: createdRoot.role,
      preview: createdRoot.content,
      childIds: [],
    },
  },
}

const replacementConversation: ConversationView = {
  id: "replacement-conversation",
  title: "Replacement conversation",
  rootNodeId: "replacement-root",
  isArchived: false,
}

const replacementRoot: ConversationNodeView = {
  id: replacementConversation.rootNodeId,
  conversationId: replacementConversation.id,
  role: "user",
  content: "REPLACEMENT_ROOT_SENTINEL",
  createdAt: 11,
  metadata: null,
}

const replacementTree: ConversationTreeView = {
  conversation: replacementConversation,
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

const profile: ProviderProfileView = {
  baseEndpoint: "http://127.0.0.1:7788/v1",
  model: "fixture-model",
  hasApiKey: false,
  updatedAt: 10,
}

const generationId = "11111111-1111-4111-8111-111111111111"
const commitToken = "22222222-2222-4222-8222-222222222222"
const streamedContent = "STREAMED_CONTROLLER_RESPONSE"

function createConversationClient() {
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

function createProviderClient() {
  return {
    saveProviderProfile: vi.fn<ProviderClient["saveProviderProfile"]>(),
    loadProviderProfile: vi.fn<ProviderClient["loadProviderProfile"]>(),
    deleteProviderProfile: vi.fn<ProviderClient["deleteProviderProfile"]>(),
    generateFromActivePath: vi.fn<ProviderClient["generateFromActivePath"]>(),
    cancelGeneration: vi
      .fn<ProviderClient["cancelGeneration"]>()
      .mockResolvedValue({ accepted: true }),
    commitGeneration: vi.fn<ProviderClient["commitGeneration"]>(),
  } satisfies ProviderClient
}

function resetConversationStore() {
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
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function completedNode(): ConversationNodeView {
  return {
    id: "completed-controller-assistant",
    parentId: right.id,
    conversationId: conversation.id,
    role: "assistant",
    content: streamedContent,
    model: profile.model,
    createdAt: 5,
    metadata: null,
  }
}

function emitReadyPath(onEvent: (event: GenerationEventView) => void) {
  onEvent({
    type: "started",
    generationId,
    conversationId: conversation.id,
    activeNodeId: right.id,
    model: profile.model,
  })
  onEvent({ type: "delta", generationId, content: streamedContent })
  onEvent({ type: "ready_to_commit", generationId, commitToken })
}

describe("workspace generation controller", () => {
  let conversationClient: ReturnType<typeof createConversationClient>
  let providerClient: ReturnType<typeof createProviderClient>

  beforeEach(async () => {
    conversationClient = createConversationClient()
    providerClient = createProviderClient()
    resetConversationStore()
    useProviderProfileStore.setState({ phase: "ready", profile })
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(right.id)
    conversationClient.loadConversationTree.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts generation once from an appended user only after persistence", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    const start = deferred<{ generationId: string }>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    providerClient.generateFromActivePath.mockReturnValueOnce(start.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    let appendOperation!: Promise<void>
    act(() => {
      appendOperation = result.current.appendNode(appendedUser.content)
    })
    expect(conversationClient.appendNode).toHaveBeenCalledWith({
      conversationId: conversation.id,
      parentNodeId: assistant.id,
      content: appendedUser.content,
    })
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()

    await act(async () => {
      append.resolve(appendedUser)
      await appendOperation
    })

    expect(useConversationStore.getState().activeNodeId).toBe(appendedUser.id)
    const activePath = selectActivePath(useConversationStore.getState())
    expect(activePath.kind).toBe("ready")
    expect(activePath.path.map((node) => node.id)).toEqual([
      root.id,
      assistant.id,
      appendedUser.id,
    ])
    expect(activePath.path.map((node) => node.id)).not.toContain(
      inactiveAssistant.id,
    )
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      conversation.id,
      appendedUser.id,
      expect.any(Function),
    )

    act(() => result.current.generate())
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
  })

  it("does not auto-generate when navigation changes during append persistence", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    let appendOperation!: Promise<void>
    act(() => {
      appendOperation = result.current.appendNode(appendedUser.content)
    })
    act(() => {
      useConversationStore.getState().selectNode(root.id)
    })

    await act(async () => {
      append.resolve(appendedUser)
      await appendOperation
    })

    expect(useConversationStore.getState().activeNodeId).toBe(root.id)
    expect(useConversationStore.getState().fullNodes[appendedUser.id]).toEqual(
      appendedUser,
    )
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("starts generation once from a created conversation only after persistence", async () => {
    resetConversationStore()
    const create = deferred<ConversationTreeView>()
    const start = deferred<{ generationId: string }>()
    conversationClient.createConversation.mockReturnValueOnce(create.promise)
    providerClient.generateFromActivePath.mockReturnValueOnce(start.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    let createOperation!: Promise<boolean>
    act(() => {
      createOperation = result.current.createConversation(createdRoot.content)
    })
    expect(conversationClient.createConversation).toHaveBeenCalledWith({
      title: createdConversation.title,
      content: createdRoot.content,
    })
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()

    await act(async () => {
      create.resolve(createdTree)
      await createOperation
    })

    expect(useConversationStore.getState().activeNodeId).toBe(createdRoot.id)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      createdConversation.id,
      createdRoot.id,
      expect.any(Function),
    )
  })

  it("does not generate when conversation creation fails", async () => {
    resetConversationStore()
    conversationClient.createConversation.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Conversation could not be saved.",
        retryable: true,
      }),
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.createConversation(createdRoot.content)
    })

    expect(useConversationStore.getState()).toMatchObject({
      conversationId: null,
      activeNodeId: null,
      status: "error",
    })
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("does not generate when an appended node fails authoritative validation", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    conversationClient.appendNode.mockResolvedValueOnce({
      ...appendedUser,
      parentId: root.id,
    })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.appendNode(appendedUser.content)
    })

    expect(useConversationStore.getState().status).toBe("error")
    expect(useConversationStore.getState().activeNodeId).toBe(assistant.id)
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("does not generate when appending a node fails", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    conversationClient.appendNode.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Message could not be saved.",
        retryable: true,
      }),
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.appendNode(appendedUser.content)
    })

    expect(useConversationStore.getState()).toMatchObject({
      conversationId: conversation.id,
      activeNodeId: assistant.id,
      status: "error",
    })
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("persists an appended user without generating when the provider is unavailable", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    useProviderProfileStore.setState({ phase: "idle", profile: null })
    conversationClient.appendNode.mockResolvedValueOnce(appendedUser)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.appendNode(appendedUser.content)
    })

    expect(useConversationStore.getState().activeNodeId).toBe(appendedUser.id)
    expect(useConversationStore.getState().fullNodes[appendedUser.id]).toEqual(
      appendedUser,
    )
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("rechecks provider availability after append persistence", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    let appendOperation!: Promise<void>
    act(() => {
      appendOperation = result.current.appendNode(appendedUser.content)
    })
    useProviderProfileStore.setState({ phase: "idle", profile: null })

    await act(async () => {
      append.resolve(appendedUser)
      await appendOperation
    })

    expect(useConversationStore.getState().activeNodeId).toBe(appendedUser.id)
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("does not generate from state that replaces the exact created result", async () => {
    resetConversationStore()
    conversationClient.createConversation.mockResolvedValueOnce(createdTree)
    const unsubscribe = useConversationStore.subscribe((state) => {
      if (state.conversationId === createdConversation.id) {
        useConversationStore.setState({
          isCreatingConversation: false,
          conversationId: replacementConversation.id,
          isArchived: false,
          rootNodeId: replacementRoot.id,
          activeNodeId: replacementRoot.id,
          nodesById: replacementTree.nodesById,
          fullNodes: { [replacementRoot.id]: replacementRoot },
          expandedIds: new Set([replacementRoot.id]),
          status: "ready",
          error: null,
          generation: { phase: "idle" },
        })
      }
    })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.createConversation(createdRoot.content)
    })
    unsubscribe()

    expect(useConversationStore.getState().conversationId).toBe(
      replacementConversation.id,
    )
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("does not start generation after unmount while append is pending", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    const { result, unmount } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    let appendOperation!: Promise<void>
    act(() => {
      appendOperation = result.current.appendNode(appendedUser.content)
    })
    unmount()

    await act(async () => {
      append.resolve(appendedUser)
      await appendOperation
    })

    expect(useConversationStore.getState().activeNodeId).toBe(appendedUser.id)
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("does not generate from an unsafe created tree", async () => {
    resetConversationStore()
    conversationClient.createConversation.mockResolvedValueOnce({
      ...createdTree,
      nodesById: {
        [createdRoot.id]: {
          ...createdTree.nodesById[createdRoot.id]!,
          childIds: ["missing-child"],
        },
      },
    })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.createConversation(createdRoot.content)
    })

    expect(useConversationStore.getState().activeNodeId).toBe(createdRoot.id)
    expect(providerClient.generateFromActivePath).not.toHaveBeenCalled()
  })

  it("keeps the saved user selected and allows manual retry after start failure", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    conversationClient.appendNode.mockResolvedValueOnce(appendedUser)
    providerClient.generateFromActivePath
      .mockRejectedValueOnce(
        new ConversationCommandError({
          code: "provider_unavailable",
          message: "Provider unavailable.",
          retryable: true,
        }),
      )
      .mockReturnValueOnce(deferred<{ generationId: string }>().promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.appendNode(appendedUser.content)
    })
    await waitFor(() => {
      expect(useConversationStore.getState().generation.phase).toBe("failed")
    })

    expect(useConversationStore.getState().activeNodeId).toBe(appendedUser.id)
    expect(useConversationStore.getState().fullNodes[appendedUser.id]).toEqual(
      appendedUser,
    )
    act(() => result.current.generate())
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(2)
    expect(providerClient.generateFromActivePath).toHaveBeenLastCalledWith(
      conversation.id,
      appendedUser.id,
      expect.any(Function),
    )
  })

  it("merges completed before the commit call resolves and never stores the token", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const start = deferred<{ generationId: string }>()
    const commit = deferred<{ accepted: boolean }>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return start.promise
      },
    )
    providerClient.commitGeneration.mockReturnValueOnce(commit.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 60_000,
      }),
    )

    act(() => result.current.generate())
    expect(onEvent).toBeDefined()
    act(() => {
      emitReadyPath(onEvent!)
    })
    await waitFor(() => {
      expect(providerClient.commitGeneration).toHaveBeenCalledWith(
        generationId,
        commitToken,
      )
    })
    act(() => {
      start.resolve({ generationId })
    })

    act(() => {
      onEvent!({
        type: "completed",
        generationId,
        node: completedNode(),
      })
    })
    act(() => {
      commit.resolve({ accepted: true })
    })

    await waitFor(() => {
      expect(useConversationStore.getState().generation.phase).toBe("completed")
    })
    expect(
      useConversationStore.getState().fullNodes[completedNode().id],
    ).toEqual(completedNode())
    expect(JSON.stringify(useConversationStore.getState())).not.toContain(
      commitToken,
    )
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()
  })

  it("does not cancel when completed arrives before the start promise resolves", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const start = deferred<{ generationId: string }>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return start.promise
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 60_000,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(providerClient.commitGeneration).toHaveBeenCalledWith(
        generationId,
        commitToken,
      )
    })

    act(() => {
      onEvent!({
        type: "completed",
        generationId,
        node: completedNode(),
      })
    })
    expect(useConversationStore.getState().generation.phase).toBe("completed")

    await act(async () => {
      start.resolve({ generationId })
      await start.promise
    })

    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()
  })

  it("accepts exact backend cancellation after ready and does not leave a reconciliation timer", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const commit = deferred<{ accepted: boolean }>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockReturnValueOnce(commit.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 0,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(useConversationStore.getState().generation.phase).toBe(
        "committing",
      )
    })
    const committing = useConversationStore.getState().generation
    if (committing.phase !== "committing") {
      throw new Error("Expected committing generation")
    }

    act(() => {
      onEvent!({ type: "cancelled", generationId })
    })
    expect(useConversationStore.getState().generation).toEqual({
      phase: "cancelled",
      runId: committing.runId,
      content: streamedContent,
    })

    await act(async () => {
      commit.resolve({ accepted: true })
      await commit.promise
    })
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "cancelled",
      content: streamedContent,
    })
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()
  })

  it("cancels the exact command result when cancelled before started", async () => {
    const start = deferred<{ generationId: string }>()
    providerClient.generateFromActivePath.mockReturnValueOnce(start.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    act(() => result.current.cancel())
    expect(useConversationStore.getState().generation.phase).toBe("cancelled")
    act(() => start.resolve({ generationId }))

    await waitFor(() => {
      expect(providerClient.cancelGeneration).toHaveBeenCalledTimes(1)
      expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    })
  })

  it("invalidates before navigation so a stale ready event cannot commit", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const start = deferred<{ generationId: string }>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return start.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    act(() => {
      onEvent!({
        type: "started",
        generationId,
        conversationId: conversation.id,
        activeNodeId: right.id,
        model: profile.model,
      })
      onEvent!({ type: "delta", generationId, content: streamedContent })
    })
    act(() => result.current.selectNode(left.id))
    act(() => {
      onEvent!({ type: "ready_to_commit", generationId, commitToken })
      start.resolve({ generationId })
    })

    await waitFor(() => {
      expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    })
    expect(useConversationStore.getState().activeNodeId).toBe(left.id)
    expect(providerClient.commitGeneration).not.toHaveBeenCalled()
  })

  it("reloads SQLite authority when commit delivery is ambiguous", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "network_failure",
        message: "Commit delivery was interrupted.",
        retryable: true,
      }),
    )
    const completed = completedNode()
    conversationClient.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      nodes: [...tree.nodes, completed],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [completed.id] },
        [completed.id]: {
          id: completed.id,
          parentId: right.id,
          role: completed.role,
          preview: completed.content,
          childIds: [],
        },
      },
    })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 0,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))

    await waitFor(() => {
      expect(conversationClient.loadConversationTree).toHaveBeenCalledWith(
        conversation.id,
      )
      expect(useConversationStore.getState().generation).toMatchObject({
        phase: "completed",
        nodeId: completed.id,
      })
    })
    expect(useConversationStore.getState().fullNodes[completed.id]).toEqual(
      completed,
    )
  })

  it("waits for the full grace period before starting automatic reconciliation", async () => {
    vi.useFakeTimers()
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    conversationClient.loadConversationTree.mockResolvedValueOnce(tree)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 1_500,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useConversationStore.getState().generation.phase).toBe("committing")
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_499)
    })
    expect(useConversationStore.getState().generation.phase).toBe("committing")
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(conversationClient.loadConversationTree).toHaveBeenCalledWith(
      conversation.id,
    )
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "reconciling",
      needsUserAction: true,
    })
    vi.useRealTimers()
  })

  it("keeps commit ambiguity silent and accepts exact completion during the grace period", async () => {
    vi.useFakeTimers()
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "network_failure",
        message: "Commit delivery was interrupted.",
        retryable: true,
      }),
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 1_500,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useConversationStore.getState().generation.phase).toBe("committing")
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()

    act(() => {
      onEvent!({
        type: "completed",
        generationId,
        node: completedNode(),
      })
    })

    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "completed",
      nodeId: completedNode().id,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()
  })

  it("keeps an exact persistence failure authoritative before the grace period expires", async () => {
    vi.useFakeTimers()
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 1_500,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useConversationStore.getState().generation.phase).toBe("committing")

    act(() => {
      onEvent!({
        type: "failed",
        generationId,
        error: {
          code: "database_unavailable",
          message: "The authoritative insert failed.",
          retryable: true,
        },
      })
    })
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: streamedContent,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()
  })

  it("does not let an in-flight reconciliation overwrite an exact persistence failure", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const reload = deferred<ConversationTreeView>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    conversationClient.loadConversationTree.mockReturnValueOnce(reload.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 0,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(conversationClient.loadConversationTree).toHaveBeenCalledWith(
        conversation.id,
      )
    })

    act(() => {
      onEvent!({
        type: "failed",
        generationId,
        error: {
          code: "database_unavailable",
          message: "The authoritative insert failed.",
          retryable: true,
        },
      })
    })
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: streamedContent,
    })

    await act(async () => {
      reload.resolve(tree)
      await reload.promise
    })
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: streamedContent,
    })
  })

  it("clears the grace timer and starts one reconciliation on unmount", async () => {
    vi.useFakeTimers()
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    conversationClient.loadConversationTree.mockReturnValueOnce(
      new Promise(() => undefined),
    )
    const { result, unmount } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 1_500,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useConversationStore.getState().generation.phase).toBe("committing")
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()

    unmount()
    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(1)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "reconciling",
      needsUserAction: false,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(1)
  })

  it("classifies an explicitly rejected acknowledgement as persistence failure", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: false })
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))

    await waitFor(() => {
      expect(useConversationStore.getState().generation).toMatchObject({
        phase: "failed",
        failureKind: "persistence",
        content: streamedContent,
      })
    })
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()
  })

  it("gates manual reconciliation retry until the automatic reload needs help", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    const retryLoad = deferred<ConversationTreeView>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    conversationClient.loadConversationTree
      .mockResolvedValueOnce(tree)
      .mockReturnValueOnce(retryLoad.promise)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 0,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(useConversationStore.getState().generation).toMatchObject({
        phase: "reconciling",
        needsUserAction: true,
      })
    })

    act(() => result.current.retryReconciliation())
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "reconciling",
      needsUserAction: false,
    })
    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(2)

    act(() => retryLoad.resolve(tree))
    await waitFor(() => {
      expect(useConversationStore.getState().generation).toMatchObject({
        phase: "reconciling",
        needsUserAction: true,
      })
    })
  })

  it("keeps accepting exact completion after an unresolved automatic reload", async () => {
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return Promise.resolve({ generationId })
      },
    )
    providerClient.commitGeneration.mockResolvedValueOnce({ accepted: true })
    conversationClient.loadConversationTree.mockResolvedValueOnce(tree)
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({
        conversationClient,
        providerClient,
        reconciliationDelayMs: 0,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(useConversationStore.getState().generation).toMatchObject({
        phase: "reconciling",
        needsUserAction: true,
      })
    })

    act(() => {
      onEvent!({
        type: "completed",
        generationId,
        node: completedNode(),
      })
    })
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "completed",
      nodeId: completedNode().id,
    })
  })
})
