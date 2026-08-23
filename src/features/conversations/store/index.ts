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
import { t } from "@/lib/i18n"
import { ConversationCommandError, type ConversationClient } from "@/lib/tauri"
import type { SetConversationProviderInput } from "@/lib/tauri"

type StartedGenerationEvent = Extract<GenerationEventView, { type: "started" }>
type StreamingGenerationEvent = Extract<
  GenerationEventView,
  { type: "delta" | "thinking_delta" }
>

type RunIdentity = {
  runId: number
  conversationId: string
  parentNodeId: string
  generationId?: string
  model?: string
  // Children of parentNodeId at run start. Recovery must never mistake a
  // pre-existing assistant sibling for this run's result.
  priorChildIds: readonly string[]
  // Truncated prompt preview of parentNodeId, captured at run start for
  // background notifications (the parent tree may be unloaded by then).
  parentPreview?: string
}

// CJK text has no word boundaries; character slicing is the natural fit.
export function truncatePreview(text: string, maxLength: number): string {
  const flattened = text.replaceAll(/\s+/g, " ").trim()
  if (flattened.length <= maxLength) return flattened
  return flattened.slice(0, maxLength) + "…"
}

const PARENT_PREVIEW_MAX_LENGTH = 60

export type GenerationRun =
  | (RunIdentity & { phase: "starting" })
  | (RunIdentity & {
      phase: "streaming"
      generationId: string
      model: string
      content: string
      thinking: string
    })
  | (RunIdentity & { phase: "cancelled"; content: string })
  | (RunIdentity & {
      phase: "failed"
      failureKind: "generation"
      error: UiError
    })
  | (RunIdentity & {
      phase: "failed"
      failureKind: "persistence"
      content: string
      error: UiError
    })

export type ActiveGenerationRun = Extract<
  GenerationRun,
  { phase: "starting" | "streaming" }
>

export type ConversationProviderBinding = {
  providerId: string
  model: string
}

export type ConversationTreeState = {
  isCreatingConversation: boolean
  conversationId: string | null
  title: string | null
  isArchived: boolean
  providerId: string | null
  model: string | null
  reasoningEffort: "low" | "medium" | "high" | null
  // Blank/new-conversation picker draft. Null binding means "snapshot the
  // active provider at create time"; UI never clears a chosen draft back to
  // follow-global.
  draftBinding: ConversationProviderBinding | null
  draftReasoningEffort: "low" | "medium" | "high" | null
  rootNodeId: string | null
  activeNodeId: string | null
  nodesById: Readonly<Record<string, TreeNodeView>>
  fullNodes: Readonly<Record<string, ConversationNodeView>>
  expandedIds: ReadonlySet<string>
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error: UiError | null
  // At most one run record per conversation, keyed by conversation ID. Active
  // runs stream in the background when their conversation is not loaded;
  // terminal records survive switches so failures can surface on re-entry.
  generationRuns: Readonly<Record<string, GenerationRun>>
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
  archiveConversation: (
    client: ConversationClient,
    targetId?: string,
  ) => Promise<void>
  renameConversation: (
    client: ConversationClient,
    targetId: string,
    title: string,
  ) => Promise<UiError | null>
  deleteConversation: (
    client: ConversationClient,
    targetId: string,
  ) => Promise<void>
  unarchiveConversation: (
    client: ConversationClient,
    targetId: string,
  ) => Promise<void>
  setConversationProvider: (
    client: ConversationClient,
    input: Omit<SetConversationProviderInput, "conversationId">,
  ) => Promise<void>
  setDraftConversationProvider: (input: {
    binding: ConversationProviderBinding | null
    reasoningEffort: "low" | "medium" | "high" | null
  }) => void
  clearError: () => void
  applyTitleUpdate: (update: { conversationId: string; title: string }) => void
  beginGeneration: (explicitParentNodeId?: string) => number | null
  acceptGenerationStarted: (
    runId: number,
    event: StartedGenerationEvent,
  ) => boolean
  appendGenerationDelta: (
    runId: number,
    event: StreamingGenerationEvent,
  ) => boolean
  completeGeneration: (
    runId: number,
    generationId: string,
    node: ConversationNodeView,
  ) => boolean
  failGeneration: (
    runId: number,
    error: UiError,
    generationId?: string,
    failureKind?: "generation" | "persistence",
  ) => boolean
  failGenerationRecovery: (runId: number, error: UiError) => boolean
  cancelGenerationRun: (runId: number) => boolean
  acceptGenerationCancelled: (runId: number, generationId: string) => boolean
  recoverGeneration: (runId: number, tree: ConversationTreeView) => boolean
}

// Display sites render these through commandErrorMessage(code); the message
// field carries localized text only for wire/debug inspection.
const TREE_INTEGRITY_ERROR: UiError = {
  code: "tree_integrity",
  message: t("errors.unsafeTreeProjection"),
  retryable: true,
}

const INTERNAL_ERROR: UiError = {
  code: "internal",
  message: t("errors.internal"),
  retryable: false,
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
  title: null,
  isArchived: false,
  providerId: null,
  model: null,
  reasoningEffort: null,
  draftBinding: null,
  draftReasoningEffort: null,
  rootNodeId: null,
  activeNodeId: null,
  nodesById: emptyRecord(),
  fullNodes: emptyRecord(),
  expandedIds: new Set(),
  status: "idle",
  error: null,
  generationRuns: emptyRecord(),
}

const initialHistoryState: ConversationHistoryState = {
  status: "idle",
  summaries: [],
  error: null,
}

// Deleting the loaded conversation clears its whole projection. The workspace
// lands back on the blank new-conversation state; run records for the deleted
// target cannot survive it.
function blankTreeState(
  generationRuns: Readonly<Record<string, GenerationRun>>,
): ConversationTreeState {
  return {
    ...initialState,
    isCreatingConversation: true,
    nodesById: emptyRecord(),
    fullNodes: emptyRecord(),
    expandedIds: new Set(),
    generationRuns,
  }
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

// Removing a deleted conversation keeps the list ready while other rows
// remain and flips to the explicit empty state for the last one.
function withoutSummary(
  history: ConversationHistoryState,
  conversationId: string,
): ConversationHistoryState {
  const summaries = history.summaries.filter(
    (item) => item.id !== conversationId,
  )
  return summaries.length > 0
    ? { status: "ready", summaries, error: null }
    : { status: "empty", summaries: [], error: null }
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
  generationRuns: Readonly<Record<string, GenerationRun>>,
): ConversationTreeState {
  const activeNodeId = newestLeafId(tree)
  return {
    isCreatingConversation: false,
    conversationId: tree.conversation.id,
    title: tree.conversation.title,
    isArchived: tree.conversation.isArchived,
    providerId: tree.conversation.providerId ?? null,
    model: tree.conversation.model ?? null,
    reasoningEffort: tree.conversation.reasoningEffort ?? null,
    draftBinding: null,
    draftReasoningEffort: null,
    rootNodeId: tree.rootNodeId,
    activeNodeId,
    nodesById: copyRecord(tree.nodesById),
    fullNodes: indexFullNodes(tree),
    expandedIds: expandedPathIds(tree, activeNodeId),
    status: "ready",
    error: null,
    generationRuns,
  }
}

// Re-attaching to a conversation with a run record focuses the run's parent so
// the transient bubble is visible, even when the newest leaf drifted elsewhere
// (for example a background regeneration over an older branch).
function withRunFocus(
  base: ConversationTreeState,
  tree: ConversationTreeView,
): ConversationTreeState {
  const run = base.generationRuns[tree.conversation.id]
  if (run === undefined) return base
  if (!Object.hasOwn(base.nodesById, run.parentNodeId)) return base
  return {
    ...base,
    activeNodeId: run.parentNodeId,
    expandedIds: expandedPathIds(tree, run.parentNodeId),
  }
}

function setRunRecord(
  state: ConversationTreeState,
  conversationId: string,
  run: GenerationRun,
): Record<string, GenerationRun> {
  const generationRuns = copyRecord(state.generationRuns)
  generationRuns[conversationId] = run
  return generationRuns
}

function removeRunRecord(
  state: ConversationTreeState,
  conversationId: string,
): Record<string, GenerationRun> {
  if (!Object.hasOwn(state.generationRuns, conversationId)) {
    return copyRecord(state.generationRuns)
  }
  const generationRuns = copyRecord(state.generationRuns)
  delete generationRuns[conversationId]
  return generationRuns
}

export function findRunEntry(
  state: ConversationTreeState,
  runId: number,
): readonly [conversationId: string, run: GenerationRun] | undefined {
  for (const [conversationId, run] of Object.entries(state.generationRuns)) {
    if (run.runId === runId) return [conversationId, run]
  }
  return undefined
}

export function isRunActive(
  run: GenerationRun | undefined,
): run is ActiveGenerationRun {
  return (
    run !== undefined && (run.phase === "starting" || run.phase === "streaming")
  )
}

export function selectCurrentRun(
  state: ConversationTreeState,
): GenerationRun | undefined {
  return state.conversationId === null
    ? undefined
    : state.generationRuns[state.conversationId]
}

const activeRunIdsCache = new WeakMap<
  Readonly<Record<string, GenerationRun>>,
  ReadonlySet<string>
>()

export function selectActiveRunIds(
  state: Pick<ConversationTreeState, "generationRuns">,
): ReadonlySet<string> {
  const cached = activeRunIdsCache.get(state.generationRuns)
  if (cached !== undefined) return cached
  const ids = new Set<string>()
  for (const [conversationId, run] of Object.entries(state.generationRuns)) {
    if (isRunActive(run)) ids.add(conversationId)
  }
  activeRunIdsCache.set(state.generationRuns, ids)
  return ids
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
  generation: Extract<
    GenerationRun,
    { phase: "starting" | "streaming" | "cancelled" }
  >,
  node: ConversationNodeView,
): Partial<ConversationTreeState> | null {
  const parent = state.fullNodes[generation.parentNodeId]
  if (
    state.isArchived ||
    state.status !== "ready" ||
    node.role !== "assistant" ||
    (generation.model !== undefined && node.model !== generation.model) ||
    node.model === undefined ||
    parent?.role !== "user" ||
    !hasValidTreeShape(state)
  ) {
    return null
  }
  return addAuthoritativeNode(
    state,
    node,
    generation.parentNodeId,
    // Keep the user's current view when they browsed to another node while
    // this run was active; select the reply only on the generating path.
    state.activeNodeId === generation.parentNodeId,
  )
}

function findRecoveredAssistant(
  tree: ConversationTreeView,
  run: Extract<
    GenerationRun,
    { phase: "starting" | "streaming" | "cancelled" }
  >,
  priorNodeIds: ReadonlySet<string>,
): ConversationNodeView | undefined {
  const priorChildIds = new Set(run.priorChildIds)
  const matches = tree.nodes.filter(
    (node) =>
      !priorNodeIds.has(node.id) &&
      !priorChildIds.has(node.id) &&
      node.conversationId === run.conversationId &&
      node.parentId === run.parentNodeId &&
      node.role === "assistant" &&
      node.model !== undefined &&
      (run.model === undefined || node.model === run.model),
  )
  return matches.length === 1 ? matches[0] : undefined
}

export const useConversationStore = create<ConversationStore>((set, get) => {
  let nextRunId = 0
  let requestEpoch = 0
  let bindingEpoch = 0

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
      set(withRunFocus(loadedTreeState(tree, get().generationRuns), tree))
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
      requestEpoch += 1
      set({
        isCreatingConversation: true,
        draftBinding: null,
        draftReasoningEffort: null,
        status: state.conversationId === null ? "idle" : "ready",
        error: null,
      })
    },

    applyTitleUpdate: ({ conversationId, title }) => {
      const state = get()
      const current = state.history.summaries.find(
        (summary) => summary.id === conversationId,
      )
      set({
        ...(state.conversationId === conversationId ? { title } : {}),
        ...(current === undefined
          ? {}
          : {
              history: {
                status: "ready" as const,
                summaries: upsertSummary(state.history.summaries, {
                  ...current,
                  title,
                }),
                error: null,
              },
            }),
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
      if (!get().history.summaries.some((summary) => summary.id === id)) {
        return
      }
      await loadSelectedConversation(client, id, ++requestEpoch)
    },

    beginGeneration: (explicitParentNodeId?: string) => {
      const state = get()
      const parentNodeId = explicitParentNodeId ?? state.activeNodeId
      const parentNode =
        parentNodeId === null ? undefined : state.fullNodes[parentNodeId]
      const projection = selectActivePath(state)
      if (
        state.conversationId === null ||
        parentNodeId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        parentNode?.role !== "user" ||
        parentNode.conversationId !== state.conversationId ||
        projection.kind !== "ready" ||
        // An implicit target (the manual generate button) must sit at the end
        // of the visible path; an explicit target (auto-generate after append)
        // only needs to be a user node of this conversation, because the run
        // belongs to the node, not to the current view.
        (explicitParentNodeId === undefined &&
          projection.path.at(-1)?.id !== parentNodeId) ||
        isRunActive(state.generationRuns[state.conversationId])
      ) {
        return null
      }

      const runId = ++nextRunId
      set({
        generationRuns: setRunRecord(state, state.conversationId, {
          phase: "starting",
          runId,
          conversationId: state.conversationId,
          parentNodeId,
          priorChildIds: [...(state.nodesById[parentNodeId]?.childIds ?? [])],
          parentPreview: truncatePreview(
            parentNode.content,
            PARENT_PREVIEW_MAX_LENGTH,
          ),
        }),
      })
      return runId
    },

    acceptGenerationStarted: (runId, event) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        run.phase !== "starting" ||
        run.conversationId !== event.conversationId ||
        run.parentNodeId !== event.activeNodeId ||
        (run.generationId !== undefined &&
          run.generationId !== event.generationId)
      ) {
        return false
      }
      set({
        generationRuns: setRunRecord(state, conversationId, {
          phase: "streaming",
          runId,
          conversationId: run.conversationId,
          parentNodeId: run.parentNodeId,
          priorChildIds: run.priorChildIds,
          parentPreview: run.parentPreview,
          generationId: event.generationId,
          model: event.model,
          content: "",
          thinking: "",
        }),
      })
      return true
    },

    appendGenerationDelta: (runId, event) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        run.phase !== "streaming" ||
        run.generationId !== event.generationId
      ) {
        return false
      }
      set({
        generationRuns: setRunRecord(state, conversationId, {
          ...run,
          ...(event.type === "thinking_delta"
            ? { thinking: run.thinking + event.content }
            : { content: run.content + event.content }),
        }),
      })
      return true
    },

    completeGeneration: (runId, generationId, node) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        (run.phase !== "starting" &&
          run.phase !== "streaming" &&
          run.phase !== "cancelled") ||
        (run.generationId !== undefined && run.generationId !== generationId)
      ) {
        return false
      }

      const history = updateSummaryActivity(
        state.history,
        conversationId,
        node.createdAt,
      )
      if (state.conversationId !== conversationId) {
        // Background completion: the node is durable on the Rust side; the
        // tree itself is refreshed by the next conversation load.
        set({
          history,
          generationRuns: removeRunRecord(state, conversationId),
        })
        return true
      }
      const update = addAuthoritativeAssistantNode(state, run, node)
      if (update === null) return false
      set({
        ...update,
        history,
        generationRuns: removeRunRecord(state, conversationId),
      })
      return true
    },

    failGeneration: (
      runId,
      error,
      generationId,
      failureKind = "generation",
    ) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        (run.phase !== "starting" &&
          run.phase !== "streaming" &&
          run.phase !== "cancelled") ||
        (generationId !== undefined &&
          run.generationId !== undefined &&
          run.generationId !== generationId)
      ) {
        return false
      }
      const terminalContent =
        run.phase === "starting"
          ? ""
          : run.phase === "streaming" || run.phase === "cancelled"
            ? run.content
            : ""
      const failed: GenerationRun =
        failureKind === "persistence"
          ? {
              phase: "failed",
              runId,
              conversationId: run.conversationId,
              parentNodeId: run.parentNodeId,
              priorChildIds: run.priorChildIds,
              parentPreview: run.parentPreview,
              generationId: run.generationId,
              failureKind: "persistence",
              content: terminalContent,
              error,
            }
          : {
              phase: "failed",
              runId,
              conversationId: run.conversationId,
              parentNodeId: run.parentNodeId,
              priorChildIds: run.priorChildIds,
              parentPreview: run.parentPreview,
              generationId: run.generationId,
              failureKind: "generation",
              error,
            }
      set({
        generationRuns: setRunRecord(state, conversationId, failed),
      })
      return true
    },

    failGenerationRecovery: (runId, error) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        run.phase !== "starting" &&
        run.phase !== "streaming" &&
        run.phase !== "cancelled"
      ) {
        return false
      }
      if (run.phase === "cancelled") return true
      const failed: GenerationRun = {
        phase: "failed",
        runId,
        conversationId: run.conversationId,
        parentNodeId: run.parentNodeId,
        priorChildIds: run.priorChildIds,
        parentPreview: run.parentPreview,
        generationId: run.generationId,
        failureKind: "generation",
        error,
      }
      if (state.conversationId !== conversationId) {
        set({
          generationRuns: setRunRecord(state, conversationId, failed),
        })
        return true
      }
      set({
        status: "error",
        error,
        generationRuns: setRunRecord(state, conversationId, failed),
      })
      return true
    },

    cancelGenerationRun: (runId) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (!isRunActive(run)) return false
      set({
        generationRuns: setRunRecord(state, conversationId, {
          phase: "cancelled",
          runId,
          conversationId: run.conversationId,
          parentNodeId: run.parentNodeId,
          priorChildIds: run.priorChildIds,
          parentPreview: run.parentPreview,
          generationId: run.generationId,
          model: run.model,
          content: run.phase === "streaming" ? run.content : "",
        }),
      })
      return true
    },

    acceptGenerationCancelled: (runId, generationId) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        (run.phase !== "starting" &&
          run.phase !== "streaming" &&
          run.phase !== "cancelled") ||
        (run.generationId !== undefined && run.generationId !== generationId)
      ) {
        return false
      }
      set({
        generationRuns: setRunRecord(state, conversationId, {
          phase: "cancelled",
          runId,
          conversationId: run.conversationId,
          parentNodeId: run.parentNodeId,
          priorChildIds: run.priorChildIds,
          parentPreview: run.parentPreview,
          generationId: run.generationId,
          model: run.model,
          content: run.phase === "starting" ? "" : run.content,
        }),
      })
      return true
    },

    recoverGeneration: (runId, tree) => {
      const state = get()
      const entry = findRunEntry(state, runId)
      if (entry === undefined) return false
      const [conversationId, run] = entry
      if (
        (run.phase !== "starting" &&
          run.phase !== "streaming" &&
          run.phase !== "cancelled") ||
        tree.conversation.id !== conversationId
      ) {
        return false
      }

      const priorNodeIds = new Set(Object.keys(state.fullNodes))
      const match = findRecoveredAssistant(tree, run, priorNodeIds)

      if (state.conversationId !== conversationId) {
        if (match === undefined) return false
        set({
          history: updateSummaryActivity(
            state.history,
            conversationId,
            summaryFromTree(tree).updatedAt,
          ),
          generationRuns: removeRunRecord(state, conversationId),
        })
        return true
      }

      const candidate = loadedTreeState(tree, state.generationRuns)
      if (!hasValidTreeShape(candidate)) return false

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
      if (match !== undefined) expandedIds.add(run.parentNodeId)

      set({
        ...candidate,
        activeNodeId: match?.id ?? preservedActiveId,
        expandedIds,
        history: updateSummaryActivity(
          state.history,
          conversationId,
          summaryFromTree(tree).updatedAt,
        ),
        generationRuns:
          match === undefined
            ? state.generationRuns
            : removeRunRecord(state, conversationId),
      })
      return match !== undefined
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
      if (!Object.hasOwn(state.nodesById, nodeId)) return
      const projection = selectActivePath({ ...state, activeNodeId: nodeId })
      if (projection.kind !== "ready") return
      set({ activeNodeId: nodeId })
    },

    loadConversation: async (client, id) => {
      await loadSelectedConversation(client, id, ++requestEpoch)
    },

    createConversation: async (client, title, content) => {
      if (get().status === "loading") return
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
        set({ ...loadedTreeState(tree, get().generationRuns), history })
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
        isRunActive(state.generationRuns[state.conversationId]) ||
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
          generationRuns: removeRunRecord(liveState, conversationId),
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
        isRunActive(state.generationRuns[state.conversationId]) ||
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
          generationRuns: removeRunRecord(liveState, conversationId),
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
        isRunActive(state.generationRuns[state.conversationId]) ||
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
          generationRuns: removeRunRecord(liveState, conversationId),
        })
      } catch (error: unknown) {
        if (epoch !== requestEpoch || get().conversationId !== conversationId) {
          return
        }
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    setConversationProvider: async (client, input) => {
      const state = get()
      const conversationId = state.conversationId
      if (
        conversationId === null ||
        state.isArchived ||
        client.setConversationProvider === undefined
      ) {
        return
      }
      const epoch = ++bindingEpoch
      try {
        const result = await client.setConversationProvider({
          conversationId,
          ...input,
        })
        const live = get()
        if (epoch !== bindingEpoch || live.conversationId !== conversationId) {
          return
        }
        if (result.id !== conversationId) {
          set({ error: TREE_INTEGRITY_ERROR })
          return
        }
        const summary = live.history.summaries.find(
          (item) => item.id === conversationId,
        )
        set({
          providerId: result.providerId ?? null,
          model: result.model ?? null,
          reasoningEffort: result.reasoningEffort ?? null,
          ...(summary === undefined
            ? {}
            : {
                history: {
                  status: "ready" as const,
                  summaries: upsertSummary(live.history.summaries, {
                    ...summary,
                    providerId: result.providerId ?? null,
                    model: result.model ?? null,
                    reasoningEffort: result.reasoningEffort ?? null,
                  }),
                  error: null,
                },
              }),
        })
      } catch (error: unknown) {
        if (epoch === bindingEpoch && get().conversationId === conversationId) {
          set({ error: normalizeUiError(error) })
        }
      }
    },

    setDraftConversationProvider: (input) => {
      set({
        draftBinding: input.binding,
        draftReasoningEffort: input.reasoningEffort,
      })
    },

    archiveConversation: async (client, targetId) => {
      const state = get()
      const target = targetId ?? state.conversationId
      if (target === null) return

      const isCurrent = target === state.conversationId
      const summary = state.history.summaries.find((item) => item.id === target)
      if (summary?.isArchived) return
      if (isCurrent && state.isArchived) return

      if (!isCurrent) {
        if (summary === undefined) return // row vanished from history
        // Non-current target: history-only mutation. A failure here must not
        // disable the whole sidebar via the global conversation status, so
        // errors surface on the history error channel only.
        try {
          const conversation = await client.archiveConversation(target)
          if (conversation.id !== target || !conversation.isArchived) {
            set({
              history: {
                status: "error" as const,
                summaries: get().history.summaries,
                error: TREE_INTEGRITY_ERROR,
              },
            })
            return
          }
          set({
            history: {
              status: "ready" as const,
              summaries: upsertSummary(get().history.summaries, {
                ...summary,
                isArchived: true,
              }),
              error: null,
            },
            generationRuns: removeRunRecord(get(), target),
          })
        } catch (error: unknown) {
          set({
            history: {
              status: "error" as const,
              summaries: get().history.summaries,
              error: normalizeUiError(error),
            },
          })
        }
        return
      }

      // Current conversation: the generation-run guards are owned by the
      // workspace controller (confirm-time cancel decision), not the store.
      set({ status: "loading", error: null })
      try {
        const conversation = await client.archiveConversation(target)
        if (
          conversation.id !== target ||
          conversation.rootNodeId !== state.rootNodeId ||
          !conversation.isArchived
        ) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        const liveSummary = get().history.summaries.find(
          (item) => item.id === conversation.id,
        )
        set({
          isArchived: true,
          status: "ready",
          error: null,
          ...(liveSummary === undefined
            ? {}
            : {
                history: {
                  status: "ready" as const,
                  summaries: upsertSummary(get().history.summaries, {
                    ...liveSummary,
                    isArchived: true,
                  }),
                  error: null,
                },
              }),
          // Archived conversations are read-only; any lingering terminal run
          // record for it can no longer be acted on.
          generationRuns: removeRunRecord(get(), target),
        })
      } catch (error: unknown) {
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    renameConversation: async (client, targetId, title) => {
      const state = get()
      const summary = state.history.summaries.find(
        (item) => item.id === targetId,
      )
      try {
        const conversation = await client.renameConversation({
          conversationId: targetId,
          title,
        })
        if (conversation.id !== targetId) {
          return TREE_INTEGRITY_ERROR
        }
        // Dual-channel update mirroring applyTitleUpdate: the loaded title
        // when current, the history summary otherwise.
        const live = get()
        set({
          ...(live.conversationId === targetId
            ? { title: conversation.title }
            : {}),
          ...(summary === undefined
            ? {}
            : {
                history: {
                  status: "ready" as const,
                  summaries: upsertSummary(live.history.summaries, {
                    ...summary,
                    title: conversation.title,
                  }),
                  error: null,
                },
              }),
        })
        return null
      } catch (error: unknown) {
        // Rename failures stay in the dialog that requested them; they must
        // not disable the workspace via the global status.
        return normalizeUiError(error)
      }
    },

    deleteConversation: async (client, targetId) => {
      const state = get()
      const isCurrent = targetId === state.conversationId

      if (!isCurrent) {
        const summary = state.history.summaries.find(
          (item) => item.id === targetId,
        )
        if (summary === undefined) return // row vanished from history
        // Non-current target: history-only mutation, like archive-by-ID.
        try {
          const result = await client.deleteConversation(targetId)
          if (result.conversationId !== targetId) {
            set({
              history: {
                status: "error" as const,
                summaries: get().history.summaries,
                error: TREE_INTEGRITY_ERROR,
              },
            })
            return
          }
          set({
            history: withoutSummary(get().history, targetId),
            generationRuns: removeRunRecord(get(), targetId),
          })
        } catch (error: unknown) {
          set({
            history: {
              status: "error" as const,
              summaries: get().history.summaries,
              error: normalizeUiError(error),
            },
          })
        }
        return
      }

      // Current conversation: reset to the blank new-conversation state
      // without loading another conversation. The controller owns the
      // confirm-time run cancellation, mirroring archive.
      set({ status: "loading", error: null })
      try {
        const result = await client.deleteConversation(targetId)
        if (result.conversationId !== targetId) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        set({
          ...blankTreeState(removeRunRecord(get(), targetId)),
          history: withoutSummary(get().history, targetId),
        })
      } catch (error: unknown) {
        set({ status: "error", error: normalizeUiError(error) })
      }
    },

    unarchiveConversation: async (client, targetId) => {
      const state = get()
      const isCurrent = targetId === state.conversationId

      if (!isCurrent) {
        const summary = state.history.summaries.find(
          (item) => item.id === targetId,
        )
        if (summary === undefined || !summary.isArchived) return
        try {
          const conversation = await client.unarchiveConversation(targetId)
          if (conversation.id !== targetId || conversation.isArchived) {
            set({
              history: {
                status: "error" as const,
                summaries: get().history.summaries,
                error: TREE_INTEGRITY_ERROR,
              },
            })
            return
          }
          set({
            history: {
              status: "ready" as const,
              summaries: upsertSummary(get().history.summaries, {
                ...summary,
                isArchived: false,
              }),
              error: null,
            },
          })
        } catch (error: unknown) {
          set({
            history: {
              status: "error" as const,
              summaries: get().history.summaries,
              error: normalizeUiError(error),
            },
          })
        }
        return
      }

      if (!state.isArchived) return
      set({ status: "loading", error: null })
      try {
        const conversation = await client.unarchiveConversation(targetId)
        if (
          conversation.id !== targetId ||
          conversation.rootNodeId !== state.rootNodeId ||
          conversation.isArchived
        ) {
          set({ status: "error", error: TREE_INTEGRITY_ERROR })
          return
        }
        const liveSummary = get().history.summaries.find(
          (item) => item.id === targetId,
        )
        set({
          isArchived: false,
          status: "ready",
          error: null,
          ...(liveSummary === undefined
            ? {}
            : {
                history: {
                  status: "ready" as const,
                  summaries: upsertSummary(get().history.summaries, {
                    ...liveSummary,
                    isArchived: false,
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
      ...(node.thinking === undefined ? {} : { thinking: node.thinking }),
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
