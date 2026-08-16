import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceGenerationController } from "./useWorkspaceGenerationController"
import { selectActivePath, useConversationStore } from "../store"
import type {
  ConversationNodeView,
  ConversationSummaryView,
  ConversationTreeView,
  ConversationView,
} from "../types"
import { useProviderProfileStore } from "@/features/providers/store"
import type {
  GenerationEventView,
  ProviderProfileView,
} from "@/features/providers/types"
import { showClickableToast } from "@/components/ui/toaster"
import {
  ConversationCommandError,
  GenerationBridgeError,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

vi.mock("@/components/ui/toaster", () => ({
  showClickableToast: vi.fn(),
}))

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
    generationRuns: {},
    history: { status: "idle", summaries: [], error: null },
  })
}

function runOf(conversationId: string) {
  return useConversationStore.getState().generationRuns[conversationId]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("workspace generation controller", () => {
  let conversationClient: ReturnType<typeof createConversationClient>
  let providerClient: ReturnType<typeof createProviderClient>

  beforeEach(async () => {
    conversationClient = createConversationClient()
    providerClient = createProviderClient()
    resetConversationStore()
    vi.mocked(showClickableToast).mockClear()
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
    const start =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
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

  it("auto-generates from the appended node even when the user browses elsewhere meanwhile", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    providerClient.generateFromActivePath.mockReturnValueOnce(
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
        .promise,
    )
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
    // The run targets the appended node, not the user's current view.
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      conversation.id,
      appendedUser.id,
      expect.any(Function),
    )
    expect(runOf(conversation.id)).toMatchObject({
      phase: "starting",
      parentNodeId: appendedUser.id,
    })
  })

  it("starts generation once from a created conversation only after persistence", async () => {
    resetConversationStore()
    const create = deferred<ConversationTreeView>()
    const start =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
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
          generationRuns: {},
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

  it("starts a background run even if the workspace unmounts while append is pending", async () => {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      appendableTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, conversation.id)
    useConversationStore.getState().selectNode(assistant.id)
    const append = deferred<ConversationNodeView>()
    conversationClient.appendNode.mockReturnValueOnce(append.promise)
    providerClient.generateFromActivePath.mockReturnValueOnce(
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
        .promise,
    )
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

    // Runs outlive the component lifecycle: the reply belongs to the
    // conversation, not to the mounted hook instance.
    expect(providerClient.generateFromActivePath).toHaveBeenCalledTimes(1)
    expect(providerClient.generateFromActivePath).toHaveBeenCalledWith(
      conversation.id,
      appendedUser.id,
      expect.any(Function),
    )
    expect(runOf(conversation.id)?.phase).toBe("starting")
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
      .mockReturnValueOnce(
        deferred<
          Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>
        >().promise,
      )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    await act(async () => {
      await result.current.appendNode(appendedUser.content)
    })
    await waitFor(() => {
      expect(runOf(conversation.id)?.phase).toBe("failed")
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

  it("awaits the terminal result and merges one authoritative node", async () => {
    const generated: ConversationNodeView = {
      id: "generated",
      parentId: right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "AUTHORITATIVE",
      model: profile.model,
      createdAt: 5,
      metadata: null,
    }
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        onEvent({ type: "delta", generationId, content: generated.content })
        return Promise.resolve({
          type: "completed",
          generationId,
          node: generated,
        })
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await waitFor(() => {
      expect(useConversationStore.getState().fullNodes.generated).toEqual(
        generated,
      )
    })
    expect(runOf(conversation.id)).toBeUndefined()
    expect(showClickableToast).not.toHaveBeenCalled()
  })

  it("cancels the exact generation and keeps its partial presentation", async () => {
    const result =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        onEvent({ type: "delta", generationId, content: "PARTIAL" })
        return result.promise
      },
    )
    const { result: hook } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => hook.current.generate())
    await waitFor(() => expect(runOf(conversation.id)?.phase).toBe("streaming"))
    act(() => hook.current.cancel())
    expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    expect(runOf(conversation.id)).toMatchObject({
      phase: "cancelled",
      content: "PARTIAL",
    })
    result.resolve({ type: "cancelled", generationId })
    await waitFor(() => expect(runOf(conversation.id)?.phase).toBe("cancelled"))
  })

  it("cancels the exact generation when started arrives after the user stops", async () => {
    const terminal =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    let onEvent: ((event: GenerationEventView) => void) | undefined
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, callback) => {
        onEvent = callback
        return terminal.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    expect(runOf(conversation.id)?.phase).toBe("starting")
    act(() => result.current.cancel())
    expect(providerClient.cancelGeneration).not.toHaveBeenCalled()

    act(() => {
      onEvent?.({
        type: "started",
        generationId,
        conversationId: conversation.id,
        activeNodeId: right.id,
        model: profile.model,
      })
    })
    expect(providerClient.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    terminal.resolve({ type: "cancelled", generationId })
    await waitFor(() => expect(runOf(conversation.id)?.phase).toBe("cancelled"))
  })

  it("reloads SQLite once when terminal delivery is ambiguous", async () => {
    const recovered: ConversationNodeView = {
      id: "recovered",
      parentId: right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "RECOVERED",
      model: profile.model,
      createdAt: 5,
      metadata: null,
    }
    const recoveredTree: ConversationTreeView = {
      ...tree,
      nodes: [...tree.nodes, recovered],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [recovered.id] },
        recovered: {
          id: recovered.id,
          parentId: right.id,
          role: "assistant",
          preview: recovered.content,
          childIds: [],
        },
      },
    }
    conversationClient.loadConversationTree.mockResolvedValue(recoveredTree)
    providerClient.generateFromActivePath.mockImplementation(() =>
      Promise.reject(new GenerationBridgeError(generationId)),
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await waitFor(() =>
      expect(useConversationStore.getState().fullNodes.recovered).toEqual(
        recovered,
      ),
    )
    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(1)
    expect(runOf(conversation.id)).toBeUndefined()
  })

  it("reloads SQLite when transport rejects before started is observed", async () => {
    const recovered: ConversationNodeView = {
      id: "recovered-before-started",
      parentId: right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "RECOVERED_BEFORE_STARTED",
      model: profile.model,
      createdAt: 5,
      metadata: null,
    }
    conversationClient.loadConversationTree.mockResolvedValue({
      ...tree,
      nodes: [...tree.nodes, recovered],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [recovered.id] },
        [recovered.id]: {
          id: recovered.id,
          parentId: right.id,
          role: "assistant",
          preview: recovered.content,
          childIds: [],
        },
      },
    })
    providerClient.generateFromActivePath.mockRejectedValue(
      new Error("invoke response delivery lost"),
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await waitFor(() =>
      expect(useConversationStore.getState().fullNodes[recovered.id]).toEqual(
        recovered,
      ),
    )

    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(1)
    expect(runOf(conversation.id)).toBeUndefined()
  })

  it("blocks mutations after one failed authoritative reload without retrying it", async () => {
    conversationClient.loadConversationTree.mockRejectedValueOnce(
      new Error("authority unavailable"),
    )
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        return Promise.reject(new Error("terminal delivery lost"))
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await waitFor(() =>
      expect(useConversationStore.getState().status).toBe("error"),
    )
    expect(conversationClient.loadConversationTree).toHaveBeenCalledTimes(1)
    expect(runOf(conversation.id)).toMatchObject({
      phase: "failed",
      failureKind: "generation",
    })
    expect(result.current.canGenerate).toBe(false)
  })

  async function switchToReplacementConversation() {
    conversationClient.loadConversationTree.mockResolvedValueOnce(
      replacementTree,
    )
    await useConversationStore
      .getState()
      .loadConversation(conversationClient, replacementConversation.id)
  }

  function seedSummaries(summaries: readonly ConversationSummaryView[]) {
    useConversationStore.setState({
      history: { status: "ready", summaries, error: null },
    })
  }

  it("notifies a background completion with a toast that jumps back", async () => {
    seedSummaries([
      { ...conversation, updatedAt: right.createdAt },
      { ...replacementConversation, updatedAt: replacementRoot.createdAt },
    ])
    const generated: ConversationNodeView = {
      id: "background-generated",
      parentId: right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "BACKGROUND",
      model: profile.model,
      createdAt: 9,
      metadata: null,
    }
    const terminal =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        return terminal.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await switchToReplacementConversation()
    terminal.resolve({ type: "completed", generationId, node: generated })
    await waitFor(() => expect(runOf(conversation.id)).toBeUndefined())

    expect(showClickableToast).toHaveBeenCalledTimes(1)
    const notification = vi.mocked(showClickableToast).mock.calls[0]![0]
    // The title previews the run's prompt; the body previews the reply.
    expect(notification.kind).toBe("success")
    expect(notification.title).toBe("RIGHT_ACTIVE_SENTINEL")
    expect(notification.description).toBe(generated.content)
    expect(
      useConversationStore
        .getState()
        .history.summaries.find((summary) => summary.id === conversation.id)
        ?.updatedAt,
    ).toBe(generated.createdAt)
    // The loaded replacement conversation is untouched.
    expect(useConversationStore.getState().conversationId).toBe(
      replacementConversation.id,
    )
    // The jump action selects the finished conversation.
    conversationClient.loadConversationTree.mockResolvedValueOnce({
      ...tree,
      nodes: [...tree.nodes, generated],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [generated.id] },
        [generated.id]: {
          id: generated.id,
          parentId: right.id,
          role: "assistant",
          preview: generated.content,
          childIds: [],
        },
      },
    })
    await act(async () => {
      // Selecting the toast jumps back to the conversation.
      notification.onSelect()
      await waitFor(() =>
        expect(useConversationStore.getState().conversationId).toBe(
          conversation.id,
        ),
      )
    })
  })

  it("truncates the reply preview of a background completion toast", async () => {
    seedSummaries([
      { ...conversation, updatedAt: right.createdAt },
      { ...replacementConversation, updatedAt: replacementRoot.createdAt },
    ])
    const longReply = "回".repeat(300)
    const generated: ConversationNodeView = {
      id: "background-generated-long",
      parentId: right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: longReply,
      model: profile.model,
      createdAt: 9,
      metadata: null,
    }
    const terminal =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        return terminal.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await switchToReplacementConversation()
    terminal.resolve({ type: "completed", generationId, node: generated })
    await waitFor(() => expect(runOf(conversation.id)).toBeUndefined())

    const { description } = vi.mocked(showClickableToast).mock.calls[0]![0]
    expect(description).toHaveLength(121)
    expect(description?.endsWith("…")).toBe(true)
  })

  it("notifies a background failure and keeps the record for re-entry", async () => {
    seedSummaries([
      { ...conversation, updatedAt: right.createdAt },
      { ...replacementConversation, updatedAt: replacementRoot.createdAt },
    ])
    const terminal =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        return terminal.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await switchToReplacementConversation()
    terminal.resolve({
      type: "failed",
      generationId,
      stage: "generation",
      error: new ConversationCommandError({
        code: "provider_unavailable",
        message: "Provider unavailable.",
        retryable: true,
      }),
    })
    await waitFor(() => expect(runOf(conversation.id)?.phase).toBe("failed"))

    expect(showClickableToast).toHaveBeenCalledTimes(1)
    const notification = vi.mocked(showClickableToast).mock.calls[0]![0]
    expect(notification.kind).toBe("error")
    expect(notification.title).toBe("RIGHT_ACTIVE_SENTINEL")
    expect(notification.description).toBe("Provider unavailable.")
  })

  it("cancels a background run when its conversation is archived", async () => {
    seedSummaries([
      { ...conversation, updatedAt: right.createdAt },
      { ...replacementConversation, updatedAt: replacementRoot.createdAt },
    ])
    const terminal =
      deferred<Awaited<ReturnType<ProviderClient["generateFromActivePath"]>>>()
    providerClient.generateFromActivePath.mockImplementation(
      (_conversationId, _activeNodeId, onEvent) => {
        onEvent({
          type: "started",
          generationId,
          conversationId: conversation.id,
          activeNodeId: right.id,
          model: profile.model,
        })
        return terminal.promise
      },
    )
    const { result } = renderHook(() =>
      useWorkspaceGenerationController({ conversationClient, providerClient }),
    )

    act(() => result.current.generate())
    await waitFor(() => expect(runOf(conversation.id)?.phase).toBe("streaming"))
    await switchToReplacementConversation()
    conversationClient.archiveConversation.mockResolvedValueOnce({
      ...conversation,
      isArchived: true,
    })

    await act(async () => {
      await result.current.archiveConversation(conversation.id)
    })

    expect(providerClient.cancelGeneration).toHaveBeenCalledWith(generationId)
    expect(conversationClient.archiveConversation).toHaveBeenCalledWith(
      conversation.id,
    )
    expect(runOf(conversation.id)).toBeUndefined()
    expect(
      useConversationStore
        .getState()
        .history.summaries.find((summary) => summary.id === conversation.id)
        ?.isArchived,
    ).toBe(true)
  })
})
