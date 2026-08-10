import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceGenerationController } from "./useWorkspaceGenerationController"
import { useConversationStore } from "../store"
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
    })
    useProviderProfileStore.setState({ phase: "ready", profile })
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(right.id)
    conversationClient.loadConversationTree.mockClear()
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

  it("keeps the terminal channel authoritative during commit ambiguity", async () => {
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
        reconciliationDelayMs: 60_000,
      }),
    )

    act(() => result.current.generate())
    act(() => emitReadyPath(onEvent!))
    await waitFor(() => {
      expect(useConversationStore.getState().generation.phase).toBe(
        "reconciling",
      )
    })
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
    expect(conversationClient.loadConversationTree).not.toHaveBeenCalled()
  })
})
