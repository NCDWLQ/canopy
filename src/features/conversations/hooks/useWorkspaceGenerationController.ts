import * as React from "react"

import { deriveConversationTitle } from "../deriveConversationTitle"
import {
  findRunEntry,
  isRunActive,
  normalizeUiError,
  selectActivePath,
  selectCurrentRun,
  truncatePreview,
  useConversationStore,
} from "../store"
import type { ConversationNodeView, ConversationTreeView } from "../types"
import { useProviderStore } from "@/features/providers/store"
import type {
  GenerationEventView,
  GenerationTerminalView,
} from "@/features/providers/types"
import { showClickableToast } from "@/components/ui/toaster"
import {
  generationIdFromBridgeError,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

export type WorkspaceGenerationControllerOptions = {
  conversationClient: ConversationClient
  providerClient: ProviderClient
}

export type WorkspaceGenerationController = {
  canGenerate: boolean
  canCancel: boolean
  mutationLocked: boolean
  unavailableReason: string | null
  generate: () => void
  cancel: () => void
  selectNode: (nodeId: string) => void
  archiveConversation: (targetId?: string) => Promise<void>
  createConversation: (content: string) => Promise<boolean>
  loadConversation: (conversationId: string) => Promise<void>
  appendNode: (content: string) => Promise<void>
  createBranch: (parentNodeId: string, content: string) => Promise<void>
  editNodeAsBranch: (sourceNodeId: string, content: string) => Promise<void>
}

type GenerationTarget = {
  conversationId: string
  parentNodeId: string
}

const REPLY_PREVIEW_MAX_LENGTH = 120

export function useWorkspaceGenerationController({
  conversationClient,
  providerClient,
}: WorkspaceGenerationControllerOptions): WorkspaceGenerationController {
  const providerPhase = useProviderStore((state) => state.phase)
  const conversationId = useConversationStore((state) => state.conversationId)
  const activeNodeRole = useConversationStore((state) =>
    state.activeNodeId === null
      ? undefined
      : state.fullNodes[state.activeNodeId]?.role,
  )
  const isArchived = useConversationStore((state) => state.isArchived)
  const status = useConversationStore((state) => state.status)
  const currentRun = useConversationStore(selectCurrentRun)
  const pathProjection = useConversationStore(selectActivePath)
  const cancelRequestedRuns = React.useRef(new Set<number>())
  const cancelSentIds = React.useRef(new Set<string>())
  const generationIds = React.useRef(new Map<number, string>())
  const recoveryRuns = React.useRef(new Set<number>())

  const requestExactCancellation = React.useCallback(
    (generationId: string) => {
      if (cancelSentIds.current.has(generationId)) return
      cancelSentIds.current.add(generationId)
      void providerClient.cancelGeneration(generationId).catch(() => undefined)
    },
    [providerClient],
  )

  // Terminal results for a background run have no inline surface, so they
  // surface as content-preview toasts: the run's prompt as the title and the
  // reply (or error) as the body. Clicking anywhere on the toast jumps back
  // to the conversation.
  const notifyBackgroundTerminal = React.useCallback(
    (
      target: GenerationTarget,
      kind: "completed" | "failed",
      payload: {
        parentPreview?: string
        replyPreview?: string
        detail?: string
      } = {},
    ) => {
      const store = useConversationStore.getState()
      if (store.conversationId === target.conversationId) return
      const title =
        payload.parentPreview ??
        (kind === "completed" ? "已生成回复" : "生成失败")
      const body = kind === "completed" ? payload.replyPreview : payload.detail
      showClickableToast({
        kind: kind === "completed" ? "success" : "error",
        title,
        ...(body === undefined ? {} : { description: body }),
        onSelect: () => {
          void useConversationStore
            .getState()
            .selectConversation(conversationClient, target.conversationId)
        },
      })
    },
    [conversationClient],
  )

  // The run record (and its prompt preview) is deleted by a successful
  // completion, so read the preview before dispatching terminal state.
  const parentPreviewOf = React.useCallback(
    (runId: number): string | undefined => {
      return findRunEntry(useConversationStore.getState(), runId)?.[1]
        .parentPreview
    },
    [],
  )

  const recoverAmbiguousRun = React.useCallback(
    async (runId: number, target: GenerationTarget, fallback: unknown) => {
      if (recoveryRuns.current.has(runId)) return
      recoveryRuns.current.add(runId)
      const beforeReload = findRunEntry(useConversationStore.getState(), runId)
      if (beforeReload === undefined || beforeReload[1].phase === "failed") {
        return
      }
      const parentPreview = beforeReload[1].parentPreview
      try {
        const tree = await conversationClient.loadConversationTree(
          target.conversationId,
        )
        if (useConversationStore.getState().recoverGeneration(runId, tree)) {
          // The recovery path cannot cheaply prove which node content the
          // run produced, so the completion toast ships without a preview.
          notifyBackgroundTerminal(target, "completed", { parentPreview })
          return
        }
        const after = findRunEntry(useConversationStore.getState(), runId)
        if (after !== undefined && isRunActive(after[1])) {
          const error = normalizeUiError(fallback)
          if (useConversationStore.getState().failGeneration(runId, error)) {
            notifyBackgroundTerminal(target, "failed", {
              parentPreview,
              detail: error.message,
            })
          }
        }
      } catch (error: unknown) {
        const normalized = normalizeUiError(error)
        if (
          useConversationStore
            .getState()
            .failGenerationRecovery(runId, normalized)
        ) {
          notifyBackgroundTerminal(target, "failed", {
            parentPreview,
            detail: normalized.message,
          })
        }
      }
    },
    [conversationClient, notifyBackgroundTerminal],
  )

  const handleTerminal = React.useCallback(
    (
      runId: number,
      target: GenerationTarget,
      terminal: GenerationTerminalView,
    ) => {
      generationIds.current.set(runId, terminal.generationId)
      if (terminal.type === "completed") {
        const parentPreview = parentPreviewOf(runId)
        if (
          !useConversationStore
            .getState()
            .completeGeneration(runId, terminal.generationId, terminal.node)
        ) {
          void recoverAmbiguousRun(runId, target, terminal)
          return
        }
        notifyBackgroundTerminal(target, "completed", {
          parentPreview,
          replyPreview: truncatePreview(
            terminal.node.content,
            REPLY_PREVIEW_MAX_LENGTH,
          ),
        })
      } else if (terminal.type === "cancelled") {
        useConversationStore
          .getState()
          .acceptGenerationCancelled(runId, terminal.generationId)
      } else {
        const parentPreview = parentPreviewOf(runId)
        if (
          useConversationStore
            .getState()
            .failGeneration(
              runId,
              terminal.error,
              terminal.generationId,
              terminal.stage,
            )
        ) {
          notifyBackgroundTerminal(target, "failed", {
            parentPreview,
            detail: terminal.error.message,
          })
        }
      }
    },
    [recoverAmbiguousRun, notifyBackgroundTerminal, parentPreviewOf],
  )

  const handleEvent = React.useCallback(
    (runId: number, event: GenerationEventView) => {
      if (event.type === "started") {
        generationIds.current.set(runId, event.generationId)
        if (cancelRequestedRuns.current.has(runId)) {
          requestExactCancellation(event.generationId)
          return
        }
        if (
          !useConversationStore.getState().acceptGenerationStarted(runId, event)
        ) {
          requestExactCancellation(event.generationId)
        }
        return
      }
      if (
        !useConversationStore.getState().appendGenerationDelta(runId, event)
      ) {
        requestExactCancellation(event.generationId)
      }
    },
    [requestExactCancellation],
  )

  const cancelRunFor = React.useCallback(
    (targetConversationId: string) => {
      const state = useConversationStore.getState()
      const run = state.generationRuns[targetConversationId]
      if (!isRunActive(run)) return
      cancelRequestedRuns.current.add(run.runId)
      const generationId =
        run.generationId ?? generationIds.current.get(run.runId)
      useConversationStore.getState().cancelGenerationRun(run.runId)
      if (generationId !== undefined) requestExactCancellation(generationId)
    },
    [requestExactCancellation],
  )

  const cancel = React.useCallback(() => {
    const conversationId = useConversationStore.getState().conversationId
    if (conversationId === null) return
    cancelRunFor(conversationId)
  }, [cancelRunFor])

  const startGeneration = React.useCallback(
    (expectedTarget?: GenerationTarget) => {
      if (useProviderStore.getState().phase !== "ready") return
      const store = useConversationStore.getState()
      if (
        expectedTarget !== undefined &&
        store.conversationId !== expectedTarget.conversationId
      ) {
        return
      }
      const runId = store.beginGeneration(expectedTarget?.parentNodeId)
      if (runId === null) return
      const entry = findRunEntry(useConversationStore.getState(), runId)
      if (entry === undefined || entry[1].phase !== "starting") return
      const target = {
        conversationId: entry[1].conversationId,
        parentNodeId: entry[1].parentNodeId,
      }

      void providerClient
        .generateFromActivePath(
          target.conversationId,
          target.parentNodeId,
          (event) => handleEvent(runId, event),
        )
        .then((terminal) => handleTerminal(runId, target, terminal))
        .catch((error: unknown) => {
          const currentEntry = findRunEntry(
            useConversationStore.getState(),
            runId,
          )
          const normalizedError = normalizeUiError(error)
          const knownGenerationId =
            currentEntry?.[1].generationId ??
            generationIds.current.get(runId) ??
            generationIdFromBridgeError(error)
          if (
            knownGenerationId !== undefined ||
            normalizedError.code === "internal"
          ) {
            void recoverAmbiguousRun(runId, target, error)
          } else {
            const parentPreview = parentPreviewOf(runId)
            if (
              useConversationStore
                .getState()
                .failGeneration(runId, normalizedError)
            ) {
              notifyBackgroundTerminal(target, "failed", {
                parentPreview,
                detail: normalizedError.message,
              })
            }
          }
        })
    },
    [
      handleEvent,
      handleTerminal,
      parentPreviewOf,
      providerClient,
      recoverAmbiguousRun,
      notifyBackgroundTerminal,
    ],
  )

  const generate = React.useCallback(() => {
    startGeneration()
  }, [startGeneration])

  const mutationLocked = isRunActive(currentRun)
  const canCancel = isRunActive(currentRun)
  const canGenerate =
    providerPhase === "ready" &&
    conversationId !== null &&
    !isArchived &&
    status === "ready" &&
    pathProjection.kind === "ready" &&
    activeNodeRole === "user" &&
    !isRunActive(currentRun)

  let unavailableReason: string | null = null
  if (!canGenerate && !canCancel) {
    if (providerPhase !== "ready") {
      unavailableReason = "请先配置服务提供商。"
    } else if (conversationId === null) {
      unavailableReason = "请先新建或加载会话。"
    } else if (isArchived) {
      unavailableReason = "已归档的会话为只读。"
    } else if (pathProjection.kind === "error") {
      unavailableReason = "当前会话路径异常，无法生成回复。"
    } else if (activeNodeRole !== "user") {
      unavailableReason = "请选择一条用户消息以生成回复。"
    } else if (mutationLocked) {
      unavailableReason = "请等待当前回复完成。"
    }
  }

  return {
    canGenerate,
    canCancel,
    mutationLocked,
    unavailableReason,
    generate,
    cancel,
    selectNode: (nodeId) => {
      useConversationStore.getState().selectNode(nodeId)
    },
    archiveConversation: async (targetId) => {
      const store = useConversationStore.getState()
      const target = targetId ?? store.conversationId
      if (target === null) return
      // Confirm-time interruption: archiving a conversation with an active
      // run (current or background) cancels it first, because persisting
      // into an archived conversation would fail.
      cancelRunFor(target)
      await useConversationStore
        .getState()
        .archiveConversation(conversationClient, target)
    },
    createConversation: async (content) => {
      const prior = useConversationStore.getState()
      let binding = prior.draftBinding
      const reasoningEffort = prior.draftReasoningEffort
      if (binding === null) {
        const providers = useProviderStore.getState()
        if (providers.activeProviderId !== null) {
          const active = providers.providers.find(
            (item) => item.id === providers.activeProviderId,
          )
          if (active !== undefined) {
            binding = { providerId: active.id, model: active.model }
          }
        }
      }

      let authoritativeTree: ConversationTreeView | undefined
      const trackingClient: ConversationClient = {
        ...conversationClient,
        createConversation: async (input) => {
          const tree = await conversationClient.createConversation(input)
          authoritativeTree = tree
          return tree
        },
      }
      await useConversationStore
        .getState()
        .createConversation(
          trackingClient,
          deriveConversationTitle(content),
          content,
        )
      if (authoritativeTree === undefined) return false
      const current = useConversationStore.getState()
      if (
        current.conversationId !== authoritativeTree.conversation.id ||
        current.activeNodeId !== authoritativeTree.rootNodeId
      ) {
        return false
      }

      if (
        (binding !== null || reasoningEffort !== null) &&
        conversationClient.setConversationProvider !== undefined
      ) {
        await useConversationStore.getState().setConversationProvider(
          conversationClient,
          {
            binding,
            reasoningEffort,
          },
        )
        if (useConversationStore.getState().error !== null) {
          return false
        }
      }

      startGeneration({
        conversationId: authoritativeTree.conversation.id,
        parentNodeId: authoritativeTree.rootNodeId,
      })
      return true
    },
    loadConversation: async (id) => {
      await useConversationStore
        .getState()
        .loadConversation(conversationClient, id)
    },
    appendNode: async (content) => {
      let authoritativeNode: ConversationNodeView | undefined
      const trackingClient: ConversationClient = {
        ...conversationClient,
        appendNode: async (input) => {
          const node = await conversationClient.appendNode(input)
          authoritativeNode = node
          return node
        },
      }
      await useConversationStore.getState().appendNode(trackingClient, content)
      if (authoritativeNode === undefined) return
      startGeneration({
        conversationId: authoritativeNode.conversationId,
        parentNodeId: authoritativeNode.id,
      })
    },
    createBranch: async (parentNodeId, content) => {
      await useConversationStore
        .getState()
        .createBranch(conversationClient, parentNodeId, content)
    },
    editNodeAsBranch: async (sourceNodeId, content) => {
      await useConversationStore
        .getState()
        .editNodeAsBranch(conversationClient, sourceNodeId, content)
    },
  }
}
