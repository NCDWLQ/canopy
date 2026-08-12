import { create } from "zustand"

import type {
  ConversationNodeView,
  ConversationSummaryView,
  ConversationTreeView,
  PathMessageView,
  TreeNodeView,
  UiError,
} from "../types"
import type { GenerationEventView } from "@/features/providers/types"
import { ConversationCommandError, type ConversationClient } from "@/lib/tauri"

type StartedGenerationEvent = Extract<GenerationEventView, { type: "started" }>
type DeltaGenerationEvent = Extract<GenerationEventView, { type: "delta" }>

type ActiveGeneration = {
  runId: number
  conversationId: string
  parentNodeId: string
  generationId?: string
}

export type GenerationState =
  | { phase: "idle" }
  | (ActiveGeneration & { phase: "starting" })
  | (Required<ActiveGeneration> & {
      phase: "streaming"
      model: string
      content: string
    })
  | (Required<ActiveGeneration> & {
      phase: "committing"
      model: string
      content: string
    })
  | (Required<ActiveGeneration> & {
      phase: "reconciling"
      model: string
      content: string
      error: UiError
      needsUserAction: boolean
    })
  | {
      phase: "completed"
      runId: number
      conversationId: string
      parentNodeId: string
      nodeId: string
    }
  | {
      phase: "failed"
      runId: number
      failureKind: "generation"
      error: UiError
    }
  | {
      phase: "failed"
      runId: number
      failureKind: "persistence"
      content: string
      error: UiError
    }
  | { phase: "cancelled"; runId: number; content: string }

export type ConversationTreeState = {
  isCreatingConversation: boolean
  conversationId: string | null
  isArchived: boolean
  rootNodeId: string | null
  activeNodeId: string | null
  nodesById: Readonly<Record<string, TreeNodeView>>
  fullNodes: Readonly<Record<string, ConversationNodeView>>
  expandedIds: ReadonlySet<string>
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error: UiError | null
  generation: GenerationState
}

export type ActivePathProjection =
  | { kind: "empty"; path: readonly [] }
  | { kind: "ready"; path: readonly PathMessageView[] }
  | { kind: "error"; path: readonly []; error: UiError }

export type ConversationHistoryState =
  | {
      status: "idle" | "loading"
      summaries: readonly ConversationSummaryView[]
      error: null
    }
  | {
      status: "ready"
      summaries: readonly ConversationSummaryView[]
      error: null
    }
  | { status: "empty"; summaries: readonly []; error: null }
  | {
      status: "error"
      summaries: readonly ConversationSummaryView[]
      error: UiError
    }

export type ConversationStore = ConversationTreeState & {
  history: ConversationHistoryState
  enterConversationCreation: () => void
  initializeHistory: (client: ConversationClient) => Promise<void>
  retryHistory: (client: ConversationClient) => Promise<void>
  selectConversation: (client: ConversationClient, id: string) => Promise<void>
  loadConversation: (client: ConversationClient, id: string) => Promise<void>
  selectNode: (nodeId: string) => void
  toggleExpanded: (nodeId: string) => void
  createConversation: (
    client: ConversationClient,
    title: string,
    content: string,
  ) => Promise<void>
  appendNode: (client: ConversationClient, content: string) => Promise<void>
  createBranch: (
    client: ConversationClient,
    parentNodeId: string,
    content: string,
  ) => Promise<void>
  editNodeAsBranch: (
    client: ConversationClient,
    sourceNodeId: string,
    content: string,
  ) => Promise<void>
  archiveConversation: (client: ConversationClient) => Promise<void>
  clearError: () => void
  beginGeneration: () => number | null
  recordGenerationId: (runId: number, generationId: string) => boolean
  acceptGenerationStarted: (
    runId: number,
    event: StartedGenerationEvent,
  ) => boolean
  appendGenerationDelta: (runId: number, event: DeltaGenerationEvent) => boolean
  markGenerationCommitting: (runId: number, generationId: string) => boolean
  completeGeneration: (
    runId: number,
    generationId: string,
    node: ConversationNodeView,
  ) => boolean
  failGeneration: (
    runId: number,
    error: UiError,
    generationId?: string,
  ) => boolean
  cancelGenerationRun: (runId: number) => boolean
  acceptGenerationCancelled: (runId: number, generationId: string) => boolean
  beginGenerationReconciliation: (runId: number, error: UiError) => boolean
  retryGenerationReconciliation: (runId: number) => boolean
  reconcileGeneration: (runId: number, tree: ConversationTreeView) => boolean
  markGenerationReconciliationFailed: (runId: number, error: UiError) => boolean
}

const TREE_INTEGRITY_ERROR: UiError = {
  code: "tree_integrity",
  message: "The conversation tree could not be displayed safely.",
  retryable: true,
}

const INTERNAL_ERROR: UiError = {
  code: "internal",
  message: "An unexpected error occurred.",
  retryable: false,
}

const RECONCILIATION_PENDING_ERROR: UiError = {
  code: "internal",
  message:
    "The conversation was reloaded, but the saved response has not been observed yet.",
  retryable: true,
}

function emptyRecord<T>(): Record<string, T> {
  const record: Record<string, T> = {}
  Object.setPrototypeOf(record, null)
  return record
}

function copyRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const record = Object.fromEntries(Object.entries(source))
  Object.setPrototypeOf(record, null)
  return record
}

function indexFullNodes(
  tree: ConversationTreeView,
): Record<string, ConversationNodeView> {
  const nodes = Object.fromEntries(tree.nodes.map((node) => [node.id, node]))
  Object.setPrototypeOf(nodes, null)
  return nodes
}

export function normalizeUiError(error: unknown): UiError {
  if (error instanceof ConversationCommandError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  return INTERNAL_ERROR
}

const initialState: ConversationTreeState = {
  isCreatingConversation: false,
  conversationId: null,
  isArchived: false,
  rootNodeId: null,
  activeNodeId: null,
  nodesById: emptyRecord(),
  fullNodes: emptyRecord(),
  expandedIds: new Set(),
  status: "idle",
  error: null,
  generation: { phase: "idle" },
}

const initialHistoryState: ConversationHistoryState = {
  status: "idle",
  summaries: [],
  error: null,
}

function sortedSummaries(
  summaries: readonly ConversationSummaryView[],
): readonly ConversationSummaryView[] {
  return [...summaries].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  )
}

function upsertSummary(
  summaries: readonly ConversationSummaryView[],
  summary: ConversationSummaryView,
): readonly ConversationSummaryView[] {
  return sortedSummaries([
    ...summaries.filter((item) => item.id !== summary.id),
    summary,
  ])
}

function summaryFromTree(tree: ConversationTreeView): ConversationSummaryView {
  return {
    ...tree.conversation,
    updatedAt: Math.max(...tree.nodes.map((node) => node.createdAt)),
  }
}

function updateSummaryActivity(
  history: ConversationHistoryState,
  conversationId: string,
  updatedAt: number,
): ConversationHistoryState {
  const current = history.summaries.find(
    (summary) => summary.id === conversationId,
  )
  if (current === undefined) return history
  return {
    status: "ready",
    summaries: upsertSummary(history.summaries, {
      ...current,
      updatedAt: Math.max(current.updatedAt, updatedAt),
    }),
    error: null,
  }
}

function newestLeafId(tree: ConversationTreeView): string {
  const leaves = tree.nodes.filter(
    (node) => tree.nodesById[node.id]?.childIds.length === 0,
  )
  const newest = leaves.reduce<ConversationNodeView | undefined>(
    (candidate, node) =>
      candidate === undefined ||
      node.createdAt > candidate.createdAt ||
      (node.createdAt === candidate.createdAt && node.id > candidate.id)
        ? node
        : candidate,
    undefined,
  )
  return newest?.id ?? tree.rootNodeId
}

function expandedPathIds(
  tree: ConversationTreeView,
  activeNodeId: string,
): ReadonlySet<string> {
  const fullNodes = indexFullNodes(tree)
  const expandedIds = new Set<string>()
  let currentId: string | undefined = activeNodeId
  while (currentId !== undefined) {
    expandedIds.add(currentId)
    currentId = fullNodes[currentId]?.parentId
  }
  return expandedIds
}

function loadedTreeState(
  tree: ConversationTreeView,
  generation: GenerationState = { phase: "idle" },
): ConversationTreeState {
  const activeNodeId = newestLeafId(tree)
  return {
    isCreatingConversation: false,
    conversationId: tree.conversation.id,
    isArchived: tree.conversation.isArchived,
    rootNodeId: tree.rootNodeId,
    activeNodeId,
    nodesById: copyRecord(tree.nodesById),
    fullNodes: indexFullNodes(tree),
    expandedIds: expandedPathIds(tree, activeNodeId),
    status: "ready",
    error: null,
    generation,
  }
}

function addAuthoritativeNode(
  state: ConversationTreeState,
  node: ConversationNodeView,
  expectedParentId: string,
  selectNode = true,
): Partial<ConversationTreeState> | null {
  if (
    state.conversationId === null ||
    node.conversationId !== state.conversationId ||
    node.parentId !== expectedParentId ||
    !Object.hasOwn(state.nodesById, expectedParentId) ||
    Object.hasOwn(state.nodesById, node.id) ||
    Object.hasOwn(state.fullNodes, node.id)
  ) {
    return null
  }

  const parentNode = state.nodesById[expectedParentId]
  if (parentNode === undefined) return null

  const nodesById = copyRecord(state.nodesById)
  const fullNodes = copyRecord(state.fullNodes)
  nodesById[node.id] = {
    id: node.id,
    parentId: expectedParentId,
    role: node.role,
    preview: node.content,
    childIds: [],
  }
  nodesById[expectedParentId] = {
    ...parentNode,
    childIds: [...parentNode.childIds, node.id],
  }
  fullNodes[node.id] = node

  const expandedIds = new Set(state.expandedIds)
  expandedIds.add(expectedParentId)
  expandedIds.add(node.id)

  return {
    nodesById,
    fullNodes,
    activeNodeId: selectNode ? node.id : state.activeNodeId,
    expandedIds,
    status: "ready",
    error: null,
  }
}

function addAuthoritativeAssistantNode(
  state: ConversationTreeState,
  generation: Extract<GenerationState, { phase: "committing" | "reconciling" }>,
  node: ConversationNodeView,
): Partial<ConversationTreeState> | null {
  const parent = state.fullNodes[generation.parentNodeId]
  if (
    state.isArchived ||
    state.status !== "ready" ||
    state.activeNodeId !== generation.parentNodeId ||
    parent?.role !== "user" ||
    node.role !== "assistant" ||
    node.model !== generation.model ||
    node.content !== generation.content ||
    !hasValidTreeShape(state)
  ) {
    return null
  }
  return addAuthoritativeNode(state, node, generation.parentNodeId)
}

export const useConversationStore = create<ConversationStore>((set, get) => {
  let nextRunId = 0
  let requestEpoch = 0

  const loadSelectedConversation = async (
    client: ConversationClient,
    id: string,
    epoch: number,
  ): Promise<boolean> => {
    set({
      isCreatingConversation: false,
      status: "loading",
      error: null,
    })
    try {
      const tree = await client.loadConversationTree(id)
      if (epoch !== requestEpoch) return false
      if (tree.conversation.id !== id) {
        set({ status: "error", error: TREE_INTEGRITY_ERROR })
        return false
      }
      const summary = get().history.summaries.find((item) => item.id === id)
      if (
        summary !== undefined &&
        (summary.rootNodeId !== tree.conversation.rootNodeId ||
          summary.isArchived !== tree.conversation.isArchived)
      ) {
        set({ status: "error", error: TREE_INTEGRITY_ERROR })
        return false
      }
      set(loadedTreeState(tree))
      return true
    } catch (error: unknown) {
      if (epoch !== requestEpoch) return false
      set({ status: "error", error: normalizeUiError(error) })
      return false
    }
  }

  return {
    ...initialState,
    history: initialHistoryState,

    enterConversationCreation: () => {
      const state = get()
      if (isGenerationActive(state.generation)) return
      requestEpoch += 1
      set({
        isCreatingConversation: true,
        status: state.conversationId === null ? "idle" : "ready",
        error: null,
      })
    },

    initializeHistory: async (client) => {
      const current = get().history
      if (
        current.status === "loading" ||
        current.status === "ready" ||
        current.status === "empty"
      ) {
        return
      }

      const epoch = ++requestEpoch
      set({
        history: {
          status: "loading",
          summaries: current.summaries,
          error: null,
        },
      })
      try {
        const summaries = await client.listConversations()
        if (epoch !== requestEpoch) return
        if (summaries.length === 0) {
          set({ history: { status: "empty", summaries: [], error: null } })
          return
        }

        const ordered = sortedSummaries(summaries)
        const selected =
          ordered.find((summary) => !summary.isArchived) ?? ordered[0]
        if (selected === undefined) return
        set({
          history: { status: "loading", summaries: ordered, error: null },
        })
        const loaded = await loadSelectedConversation(
          client,
          selected.id,
          epoch,
        )
        if (epoch === requestEpoch) {
          if (loaded) {
            set({
              history: { status: "ready", summaries: ordered, error: null },
            })
          } else {
            const error = get().error ?? INTERNAL_ERROR
            set({ history: { status: "error", summaries: ordered, error } })
          }
        }
      } catch (error: unknown) {
        if (epoch !== requestEpoch) return
        const normalized = normalizeUiError(error)
        set({
          history: {
            status: "error",
            summaries: current.summaries,
            error: normalized,
          },
        })
      }
    },

    retryHistory: async (client) => {
      if (get().history.status !== "error") return
      set({
        history: {
          status: "idle",
          summaries: get().history.summaries,
          error: null,
        },
      })
      await get().initializeHistory(client)
    },

    selectConversation: async (client, id) => {
      const state = get()
      if (
        isGenerationActive(state.generation) ||
        !state.history.summaries.some((summary) => summary.id === id)
      ) {
        return
      }
      await loadSelectedConversation(client, id, ++requestEpoch)
    },

    beginGeneration: () => {
      const state = get()
      const activeNode =
        state.activeNodeId === null
          ? undefined
          : state.fullNodes[state.activeNodeId]
      const projection = selectActivePath(state)
      if (
        state.conversationId === null ||
        state.activeNodeId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        activeNode?.role !== "user" ||
        projection.kind !== "ready" ||
        projection.path.at(-1)?.id !== state.activeNodeId ||
        isGenerationActive(state.generation)
      ) {
        return null
      }

      const runId = ++nextRunId
      set({
        generation: {
          phase: "starting",
          runId,
          conversationId: state.conversationId,
          parentNodeId: state.activeNodeId,
        },
      })
      return runId
    },

    recordGenerationId: (runId, generationId) => {
      const generation = get().generation
      if (
        generation.phase !== "starting" ||
        generation.runId !== runId ||
        (generation.generationId !== undefined &&
          generation.generationId !== generationId)
      ) {
        return false
      }
      set({ generation: { ...generation, generationId } })
      return true
    },

    acceptGenerationStarted: (runId, event) => {
      const state = get()
      const generation = state.generation
      if (generation.phase !== "starting" || generation.runId !== runId) {
        return false
      }
      const parent = state.fullNodes[generation.parentNodeId]
      if (
        generation.conversationId !== event.conversationId ||
        generation.parentNodeId !== event.activeNodeId ||
        (generation.generationId !== undefined &&
          generation.generationId !== event.generationId) ||
        state.conversationId !== generation.conversationId ||
        state.activeNodeId !== generation.parentNodeId ||
        state.isArchived ||
        state.status !== "ready" ||
        parent?.role !== "user"
      ) {
        return false
      }
      set({
        generation: {
          phase: "streaming",
          runId,
          conversationId: generation.conversationId,
          parentNodeId: generation.parentNodeId,
          generationId: event.generationId,
          model: event.model,
          content: "",
        },
      })
      return true
    },

    appendGenerationDelta: (runId, event) => {
      const generation = get().generation
      if (
        generation.phase !== "streaming" ||
        generation.runId !== runId ||
        generation.generationId !== event.generationId
      ) {
        return false
      }
      set({
        generation: {
          ...generation,
          content: generation.content + event.content,
        },
      })
      return true
    },

    markGenerationCommitting: (runId, generationId) => {
      const state = get()
      const generation = state.generation
      const projection = selectActivePath(state)
      if (
        generation.phase !== "streaming" ||
        generation.runId !== runId ||
        generation.generationId !== generationId ||
        state.conversationId !== generation.conversationId ||
        state.activeNodeId !== generation.parentNodeId ||
        state.isArchived ||
        state.status !== "ready" ||
        state.fullNodes[generation.parentNodeId]?.role !== "user" ||
        projection.kind !== "ready" ||
        projection.path.at(-1)?.id !== generation.parentNodeId
      ) {
        return false
      }
      set({ generation: { ...generation, phase: "committing" } })
      return true
    },

    completeGeneration: (runId, generationId, node) => {
      const state = get()
      const generation = state.generation
      if (
        (generation.phase !== "committing" &&
          generation.phase !== "reconciling") ||
        generation.runId !== runId ||
        generation.generationId !== generationId
      ) {
        return false
      }
      const update = addAuthoritativeAssistantNode(state, generation, node)
      if (update === null) {
        set({
          generation: {
            phase: "failed",
            runId,
            failureKind: "persistence",
            content: generation.content,
            error: TREE_INTEGRITY_ERROR,
          },
        })
        return false
      }
      set({
        ...update,
        history: updateSummaryActivity(
          state.history,
          generation.conversationId,
          node.createdAt,
        ),
        generation: {
          phase: "completed",
          runId,
          conversationId: generation.conversationId,
          parentNodeId: generation.parentNodeId,
          nodeId: node.id,
        },
      })
      return true
    },

    failGeneration: (runId, error, generationId) => {
      const generation = get().generation
      if (
        !isGenerationActive(generation) ||
        generation.runId !== runId ||
        (generationId !== undefined &&
          generation.generationId !== undefined &&
          generation.generationId !== generationId)
      ) {
        return false
      }
      if (
        generation.phase === "committing" ||
        generation.phase === "reconciling"
      ) {
        set({
          generation: {
            phase: "failed",
            runId,
            failureKind: "persistence",
            content: generation.content,
            error,
          },
        })
      } else {
        set({
          generation: {
            phase: "failed",
            runId,
            failureKind: "generation",
            error,
          },
        })
      }
      return true
    },

    cancelGenerationRun: (runId) => {
      const generation = get().generation
      if (
        !isGenerationActive(generation) ||
        generation.runId !== runId ||
        generation.phase === "committing" ||
        generation.phase === "reconciling"
      ) {
        return false
      }
      set({
        generation: {
          phase: "cancelled",
          runId,
          content: generation.phase === "streaming" ? generation.content : "",
        },
      })
      return true
    },

    acceptGenerationCancelled: (runId, generationId) => {
      const generation = get().generation
      if (
        !isGenerationActive(generation) ||
        generation.runId !== runId ||
        generation.generationId !== generationId
      ) {
        return false
      }
      set({
        generation: {
          phase: "cancelled",
          runId,
          content: generation.phase === "starting" ? "" : generation.content,
        },
      })
      return true
    },

    beginGenerationReconciliation: (runId, error) => {
      const generation = get().generation
      if (generation.phase !== "committing" || generation.runId !== runId) {
        return false
      }
      set({
        generation: {
          ...generation,
          phase: "reconciling",
          error,
          needsUserAction: false,
        },
      })
      return true
    },

    retryGenerationReconciliation: (runId) => {
      const generation = get().generation
      if (
        generation.phase !== "reconciling" ||
        generation.runId !== runId ||
        !generation.needsUserAction
      ) {
        return false
      }
      set({ generation: { ...generation, needsUserAction: false } })
      return true
    },

    reconcileGeneration: (runId, tree) => {
      const state = get()
      const generation = state.generation
      if (
        generation.phase !== "reconciling" ||
        generation.runId !== runId ||
        tree.conversation.id !== generation.conversationId
      ) {
        return false
      }

      const candidate = loadedTreeState(tree, generation)
      if (!hasValidTreeShape(candidate)) return false

      const oldNodeIds = new Set(Object.keys(state.fullNodes))
      const matches = tree.nodes.filter(
        (node) =>
          !oldNodeIds.has(node.id) &&
          node.conversationId === generation.conversationId &&
          node.parentId === generation.parentNodeId &&
          node.role === "assistant" &&
          node.model === generation.model &&
          node.content === generation.content,
      )
      const match = matches.length === 1 ? matches[0] : undefined
      const preservedActiveId =
        state.activeNodeId !== null &&
        Object.hasOwn(candidate.nodesById, state.activeNodeId)
          ? state.activeNodeId
          : candidate.rootNodeId
      const expandedIds = new Set(
        [...state.expandedIds].filter((id) =>
          Object.hasOwn(candidate.nodesById, id),
        ),
      )
      expandedIds.add(candidate.rootNodeId ?? tree.rootNodeId)
      if (match !== undefined) expandedIds.add(generation.parentNodeId)

      set({
        ...candidate,
        activeNodeId: match?.id ?? preservedActiveId,
        expandedIds,
        history: updateSummaryActivity(
          state.history,
          generation.conversationId,
          summaryFromTree(tree).updatedAt,
        ),
        generation:
          match === undefined
            ? {
                ...generation,
                error: RECONCILIATION_PENDING_ERROR,
                needsUserAction: true,
              }
            : {
                phase: "completed",
                runId,
                conversationId: generation.conversationId,
                parentNodeId: generation.parentNodeId,
                nodeId: match.id,
              },
      })
      return true
    },

    markGenerationReconciliationFailed: (runId, error) => {
      const generation = get().generation
      if (generation.phase !== "reconciling" || generation.runId !== runId) {
        return false
      }
      set({
        generation: { ...generation, error, needsUserAction: true },
      })
      return true
    },

    clearError: () => {
      const state = get()
      set({
        error: null,
        status:
          state.status === "error"
            ? state.conversationId === null
              ? "idle"
              : "ready"
            : state.status,
      })
    },

    toggleExpanded: (nodeId) => {
      const state = get()
      const node = state.nodesById[nodeId]
      if (node === undefined || node.childIds.length === 0) return

      set((currentState) => {
        const expandedIds = new Set(currentState.expandedIds)
        if (expandedIds.has(nodeId)) expandedIds.delete(nodeId)
        else expandedIds.add(nodeId)
        return { expandedIds }
      })
    },

    selectNode: (nodeId) => {
      const state = get()
      if (isGenerationActive(state.generation)) return
      if (!Object.hasOwn(state.nodesById, nodeId)) return
      const projection = selectActivePath({ ...state, activeNodeId: nodeId })
      if (projection.kind !== "ready") return
      set({ activeNodeId: nodeId })
    },

    loadConversation: async (client, id) => {
      if (isGenerationActive(get().generation)) return
      await loadSelectedConversation(client, id, ++requestEpoch)
    },

    createConversation: async (client, title, content) => {
      if (get().status === "loading" || isGenerationActive(get().generation))
        return
      const epoch = ++requestEpoch
      set({ isCreatingConversation: true, status: "loading", error: null })
      try {
        const tree = await client.createConversation({ title, content })
        if (epoch !== requestEpoch) return
        const history: ConversationHistoryState = {
          status: "ready",
          summaries: upsertSummary(
            get().history.summaries,
            summaryFromTree(tree),
          ),
          error: null,
        }
        set({ ...loadedTreeState(tree), history })
      } catch (error: unknown) {
        if (epoch !== requestEpoch) return
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    appendNode: async (client, content) => {
      const state = get()
      const activeNode = state.activeNodeId
        ? state.nodesById[state.activeNodeId]
        : undefined
      if (
        state.conversationId === null ||
        state.activeNodeId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        isGenerationActive(state.generation) ||
        activeNode?.role !== "assistant" ||
        activeNode.childIds.length !== 0
      ) {
        return
      }

      const epoch = ++requestEpoch
      const conversationId = state.conversationId
      const targetNodeId = state.activeNodeId
      const activeNodeId = state.activeNodeId
      set({ status: "loading", error: null })
      try {
        const node = await client.appendNode({
          conversationId,
          parentNodeId: targetNodeId,
          content,
        })
        const liveState = get()
        if (
          epoch !== requestEpoch ||
          liveState.conversationId !== conversationId
        ) {
          return
        }
        const update = addAuthoritativeNode(
          liveState,
          node,
          targetNodeId,
          liveState.activeNodeId === activeNodeId,
        )
        if (update === null) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        set({
          ...update,
          history: updateSummaryActivity(
            liveState.history,
            conversationId,
            node.createdAt,
          ),
        })
      } catch (error: unknown) {
        if (epoch !== requestEpoch || get().conversationId !== conversationId) {
          return
        }
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    createBranch: async (client, parentNodeId, content) => {
      const state = get()
      const parentNode = state.nodesById[parentNodeId]
      if (
        state.conversationId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        isGenerationActive(state.generation) ||
        parentNode?.role !== "assistant" ||
        parentNode.childIds.length === 0
      ) {
        return
      }

      const epoch = ++requestEpoch
      const conversationId = state.conversationId
      const activeNodeId = state.activeNodeId
      set({ status: "loading", error: null })
      try {
        const node = await client.createBranch({
          conversationId,
          parentNodeId,
          content,
        })
        const liveState = get()
        if (
          epoch !== requestEpoch ||
          liveState.conversationId !== conversationId
        ) {
          return
        }
        const update = addAuthoritativeNode(
          liveState,
          node,
          parentNodeId,
          liveState.activeNodeId === activeNodeId,
        )
        if (update === null) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        set({
          ...update,
          history: updateSummaryActivity(
            liveState.history,
            conversationId,
            node.createdAt,
          ),
        })
      } catch (error: unknown) {
        if (epoch !== requestEpoch || get().conversationId !== conversationId) {
          return
        }
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    editNodeAsBranch: async (client, sourceNodeId, content) => {
      const state = get()
      const sourceNode = state.fullNodes[sourceNodeId]
      const sourceParent = sourceNode?.parentId
        ? state.fullNodes[sourceNode.parentId]
        : undefined
      if (
        state.conversationId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        isGenerationActive(state.generation) ||
        sourceNode?.role !== "user" ||
        sourceNode.parentId === undefined ||
        sourceParent?.role !== "assistant"
      ) {
        return
      }

      const epoch = ++requestEpoch
      const conversationId = state.conversationId
      const activeNodeId = state.activeNodeId
      const targetParentId = sourceNode.parentId
      set({ status: "loading", error: null })
      try {
        const node = await client.editNodeAsBranch({
          conversationId,
          sourceNodeId,
          content,
        })
        const liveState = get()
        if (
          epoch !== requestEpoch ||
          liveState.conversationId !== conversationId
        ) {
          return
        }
        const update = addAuthoritativeNode(
          liveState,
          node,
          targetParentId,
          liveState.activeNodeId === activeNodeId,
        )
        if (update === null) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        set({
          ...update,
          history: updateSummaryActivity(
            liveState.history,
            conversationId,
            node.createdAt,
          ),
        })
      } catch (error: unknown) {
        if (epoch !== requestEpoch || get().conversationId !== conversationId) {
          return
        }
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    archiveConversation: async (client) => {
      const state = get()
      if (
        state.conversationId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        isGenerationActive(state.generation)
      ) {
        return
      }

      set({ status: "loading", error: null })
      try {
        const conversation = await client.archiveConversation(
          state.conversationId,
        )
        if (
          conversation.id !== state.conversationId ||
          conversation.rootNodeId !== state.rootNodeId ||
          !conversation.isArchived
        ) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        const summary = get().history.summaries.find(
          (item) => item.id === conversation.id,
        )
        set({
          isArchived: true,
          status: "ready",
          error: null,
          ...(summary === undefined
            ? {}
            : {
                history: {
                  status: "ready" as const,
                  summaries: upsertSummary(get().history.summaries, {
                    ...summary,
                    isArchived: true,
                  }),
                  error: null,
                },
              }),
        })
      } catch (error: unknown) {
        set({ status: "error", error: normalizeUiError(error) })
      }
    },
  }
})

export function isGenerationActive(
  generation: GenerationState,
): generation is Extract<
  GenerationState,
  { phase: "starting" | "streaming" | "committing" | "reconciling" }
> {
  return (
    generation.phase === "starting" ||
    generation.phase === "streaming" ||
    generation.phase === "committing" ||
    generation.phase === "reconciling"
  )
}

function hasValidTreeShape(state: ConversationTreeState): boolean {
  if (
    state.conversationId === null ||
    state.rootNodeId === null ||
    state.activeNodeId === null
  ) {
    return false
  }

  const nodeIds = Object.keys(state.nodesById)
  const fullNodeIds = Object.keys(state.fullNodes)
  if (
    nodeIds.length === 0 ||
    nodeIds.length !== fullNodeIds.length ||
    !Object.hasOwn(state.nodesById, state.rootNodeId) ||
    !Object.hasOwn(state.fullNodes, state.rootNodeId) ||
    !Object.hasOwn(state.nodesById, state.activeNodeId)
  ) {
    return false
  }

  const visited = new Set<string>()
  const pending: Array<{ id: string; parentId: string | undefined }> = [
    { id: state.rootNodeId, parentId: undefined },
  ]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current.id)) return false

    const node = state.nodesById[current.id]
    const fullNode = state.fullNodes[current.id]
    if (
      node === undefined ||
      fullNode === undefined ||
      node.id !== current.id ||
      fullNode.id !== current.id ||
      node.parentId !== current.parentId ||
      fullNode.parentId !== current.parentId ||
      node.role !== fullNode.role ||
      fullNode.conversationId !== state.conversationId
    ) {
      return false
    }

    visited.add(current.id)
    for (const childId of node.childIds) {
      pending.push({ id: childId, parentId: current.id })
    }
  }

  return (
    visited.size === nodeIds.length &&
    fullNodeIds.every((nodeId) => visited.has(nodeId))
  )
}

const activePathProjectionCache = new WeakMap<
  ConversationTreeState,
  ActivePathProjection
>()

function cacheActivePathProjection(
  state: ConversationTreeState,
  projection: ActivePathProjection,
): ActivePathProjection {
  activePathProjectionCache.set(state, projection)
  return projection
}

export const selectActivePath = (
  state: ConversationTreeState,
): ActivePathProjection => {
  const cached = activePathProjectionCache.get(state)
  if (cached !== undefined) return cached

  const isEmpty =
    state.conversationId === null &&
    state.rootNodeId === null &&
    state.activeNodeId === null &&
    Object.keys(state.nodesById).length === 0 &&
    Object.keys(state.fullNodes).length === 0
  if (isEmpty) {
    return cacheActivePathProjection(state, { kind: "empty", path: [] })
  }
  if (!hasValidTreeShape(state)) {
    return cacheActivePathProjection(state, {
      kind: "error",
      path: [],
      error: TREE_INTEGRITY_ERROR,
    })
  }

  const path: PathMessageView[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = state.activeNodeId ?? undefined

  while (currentId !== undefined) {
    if (visited.has(currentId)) {
      return cacheActivePathProjection(state, {
        kind: "error",
        path: [],
        error: TREE_INTEGRITY_ERROR,
      })
    }
    visited.add(currentId)

    const node = state.fullNodes[currentId]
    if (node === undefined) {
      return cacheActivePathProjection(state, {
        kind: "error",
        path: [],
        error: TREE_INTEGRITY_ERROR,
      })
    }
    path.unshift({
      id: node.id,
      role: node.role,
      content: node.content,
      ...(node.model === undefined ? {} : { model: node.model }),
      createdAt: node.createdAt,
      metadata: node.metadata,
    })
    if (currentId === state.rootNodeId) break
    currentId = node.parentId
  }

  if (
    path[0]?.id !== state.rootNodeId ||
    path.at(-1)?.id !== state.activeNodeId
  ) {
    return cacheActivePathProjection(state, {
      kind: "error",
      path: [],
      error: TREE_INTEGRITY_ERROR,
    })
  }
  return cacheActivePathProjection(state, { kind: "ready", path })
}
