import * as React from "react"

import { deriveConversationTitle } from "../deriveConversationTitle"
import {
  isGenerationActive,
  normalizeUiError,
  selectActivePath,
  useConversationStore,
} from "../store"
import type {
  ConversationNodeView,
  ConversationTreeView,
  UiError,
} from "../types"
import { useProviderProfileStore } from "@/features/providers/store"
import type { GenerationEventView } from "@/features/providers/types"
import type { ConversationClient, ProviderClient } from "@/lib/tauri"

const COMMIT_REJECTED_ERROR: UiError = {
  code: "internal",
  message: "回复未能保存，请重新生成。",
  retryable: true,
}

const RECONCILING_ERROR: UiError = {
  code: "internal",
  message: "暂时无法确认回复是否已保存。",
  retryable: true,
}

export type WorkspaceGenerationControllerOptions = {
  conversationClient: ConversationClient
  providerClient: ProviderClient
  reconciliationDelayMs?: number
}

export type WorkspaceGenerationController = {
  canGenerate: boolean
  canCancel: boolean
  mutationLocked: boolean
  unavailableReason: string | null
  generate: () => void
  cancel: () => void
  selectNode: (nodeId: string) => void
  archiveConversation: () => Promise<void>
  createConversation: (content: string) => Promise<boolean>
  loadConversation: (conversationId: string) => Promise<void>
  appendNode: (content: string) => Promise<void>
  createBranch: (parentNodeId: string, content: string) => Promise<void>
  editNodeAsBranch: (sourceNodeId: string, content: string) => Promise<void>
  retryReconciliation: () => void
}

type GenerationTarget = {
  conversationId: string
  parentNodeId: string
}

export function useWorkspaceGenerationController({
  conversationClient,
  providerClient,
  reconciliationDelayMs = 1_500,
}: WorkspaceGenerationControllerOptions): WorkspaceGenerationController {
  const providerPhase = useProviderProfileStore((state) => state.phase)
  const conversationId = useConversationStore((state) => state.conversationId)
  const activeNodeRole = useConversationStore((state) =>
    state.activeNodeId === null
      ? undefined
      : state.fullNodes[state.activeNodeId]?.role,
  )
  const isArchived = useConversationStore((state) => state.isArchived)
  const status = useConversationStore((state) => state.status)
  const generation = useConversationStore((state) => state.generation)
  const pathProjection = useConversationStore(selectActivePath)
  const cancelRequestedRuns = React.useRef(new Set<number>())
  const cancelSentIds = React.useRef(new Set<string>())
  const generationIds = React.useRef(new Map<number, string>())
  const isMounted = React.useRef(false)
  const reconciliationTimers = React.useRef(
    new Map<number, ReturnType<typeof setTimeout>>(),
  )

  const clearReconciliationTimer = React.useCallback((runId: number) => {
    const timer = reconciliationTimers.current.get(runId)
    if (timer !== undefined) clearTimeout(timer)
    reconciliationTimers.current.delete(runId)
  }, [])

  const requestExactCancellation = React.useCallback(
    (generationId: string) => {
      if (cancelSentIds.current.has(generationId)) return
      cancelSentIds.current.add(generationId)
      void providerClient.cancelGeneration(generationId).catch(() => undefined)
    },
    [providerClient],
  )

  const reconcile = React.useCallback(
    async (runId: number) => {
      clearReconciliationTimer(runId)
      const current = useConversationStore.getState().generation
      if (current.phase !== "reconciling" || current.runId !== runId) return
      try {
        const tree = await conversationClient.loadConversationTree(
          current.conversationId,
        )
        if (!useConversationStore.getState().reconcileGeneration(runId, tree)) {
          useConversationStore
            .getState()
            .markGenerationReconciliationFailed(runId, RECONCILING_ERROR)
        }
      } catch (error: unknown) {
        useConversationStore
          .getState()
          .markGenerationReconciliationFailed(runId, normalizeUiError(error))
      }
    },
    [clearReconciliationTimer, conversationClient],
  )

  const scheduleReconciliation = React.useCallback(
    (runId: number, error: UiError = RECONCILING_ERROR) => {
      const generation = useConversationStore.getState().generation
      if (generation.phase !== "committing" || generation.runId !== runId) {
        return
      }
      clearReconciliationTimer(runId)
      const timer = setTimeout(() => {
        let current = useConversationStore.getState().generation
        if (
          current.phase === "committing" &&
          current.runId === runId &&
          useConversationStore
            .getState()
            .beginGenerationReconciliation(runId, error)
        ) {
          current = useConversationStore.getState().generation
        }
        if (current.phase === "reconciling" && current.runId === runId) {
          void reconcile(runId)
        }
      }, reconciliationDelayMs)
      reconciliationTimers.current.set(runId, timer)
    },
    [clearReconciliationTimer, reconcile, reconciliationDelayMs],
  )

  const handleReady = React.useCallback(
    async (
      runId: number,
      event: Extract<GenerationEventView, { type: "ready_to_commit" }>,
    ) => {
      if (
        !useConversationStore
          .getState()
          .markGenerationCommitting(runId, event.generationId)
      ) {
        return
      }
      try {
        const result = await providerClient.commitGeneration(
          event.generationId,
          event.commitToken,
        )
        if (!result.accepted) {
          useConversationStore
            .getState()
            .failGeneration(runId, COMMIT_REJECTED_ERROR, event.generationId)
          return
        }
        scheduleReconciliation(runId)
      } catch (error: unknown) {
        scheduleReconciliation(runId, normalizeUiError(error))
      }
    },
    [providerClient, scheduleReconciliation],
  )

  const handleEvent = React.useCallback(
    (runId: number, event: GenerationEventView) => {
      if (event.type === "started") {
        generationIds.current.set(runId, event.generationId)
        if (cancelRequestedRuns.current.has(runId)) {
          requestExactCancellation(event.generationId)
          return
        }
        useConversationStore.getState().acceptGenerationStarted(runId, event)
        return
      }
      if (event.type === "delta") {
        useConversationStore.getState().appendGenerationDelta(runId, event)
        return
      }
      if (event.type === "ready_to_commit") {
        void handleReady(runId, event)
        return
      }

      clearReconciliationTimer(runId)
      if (event.type === "completed") {
        useConversationStore
          .getState()
          .completeGeneration(runId, event.generationId, event.node)
      } else if (event.type === "failed") {
        useConversationStore
          .getState()
          .failGeneration(runId, event.error, event.generationId)
      } else {
        useConversationStore
          .getState()
          .acceptGenerationCancelled(runId, event.generationId)
      }
    },
    [clearReconciliationTimer, handleReady, requestExactCancellation],
  )

  const cancel = React.useCallback(() => {
    const current = useConversationStore.getState().generation
    if (current.phase !== "starting" && current.phase !== "streaming") return
    cancelRequestedRuns.current.add(current.runId)
    const generationId =
      current.generationId ?? generationIds.current.get(current.runId)
    useConversationStore.getState().cancelGenerationRun(current.runId)
    if (generationId !== undefined) requestExactCancellation(generationId)
  }, [requestExactCancellation])

  const startGeneration = React.useCallback(
    (expectedTarget?: GenerationTarget) => {
      if (!isMounted.current) return
      if (useProviderProfileStore.getState().phase !== "ready") return
      const store = useConversationStore.getState()
      if (
        expectedTarget !== undefined &&
        (store.conversationId !== expectedTarget.conversationId ||
          store.activeNodeId !== expectedTarget.parentNodeId)
      ) {
        return
      }
      const runId = store.beginGeneration()
      if (runId === null) return
      const current = useConversationStore.getState().generation
      if (current.phase !== "starting" || current.runId !== runId) return

      void providerClient
        .generateFromActivePath(
          current.conversationId,
          current.parentNodeId,
          (event) => handleEvent(runId, event),
        )
        .then(({ generationId }) => {
          generationIds.current.set(runId, generationId)
          const store = useConversationStore.getState()
          const current = store.generation
          if (
            cancelRequestedRuns.current.has(runId) ||
            current.phase === "idle" ||
            current.runId !== runId ||
            current.phase === "cancelled"
          ) {
            requestExactCancellation(generationId)
            return
          }
          if (
            current.phase === "starting" &&
            !store.recordGenerationId(runId, generationId)
          ) {
            requestExactCancellation(generationId)
            return
          }
          if (
            isGenerationActive(current) &&
            current.generationId !== undefined &&
            current.generationId !== generationId
          ) {
            requestExactCancellation(generationId)
          }
        })
        .catch((error: unknown) => {
          useConversationStore
            .getState()
            .failGeneration(runId, normalizeUiError(error))
        })
    },
    [handleEvent, providerClient, requestExactCancellation],
  )

  const generate = React.useCallback(() => {
    startGeneration()
  }, [startGeneration])

  const prepareMutation = React.useCallback(() => {
    const current = useConversationStore.getState().generation
    if (current.phase === "committing" || current.phase === "reconciling") {
      return false
    }
    if (current.phase === "starting" || current.phase === "streaming") cancel()
    return true
  }, [cancel])

  React.useEffect(() => {
    isMounted.current = true
    const timers = reconciliationTimers.current
    return () => {
      isMounted.current = false
      const current = useConversationStore.getState().generation
      if (current.phase === "starting" || current.phase === "streaming") {
        cancel()
      } else if (current.phase === "committing") {
        if (
          useConversationStore
            .getState()
            .beginGenerationReconciliation(current.runId, RECONCILING_ERROR)
        ) {
          void reconcile(current.runId)
        }
      } else if (current.phase === "reconciling") {
        void reconcile(current.runId)
      }
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [cancel, reconcile])

  const mutationLocked =
    generation.phase === "committing" || generation.phase === "reconciling"
  const canCancel =
    generation.phase === "starting" || generation.phase === "streaming"
  const canGenerate =
    providerPhase === "ready" &&
    conversationId !== null &&
    !isArchived &&
    status === "ready" &&
    pathProjection.kind === "ready" &&
    activeNodeRole === "user" &&
    !isGenerationActive(generation)

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
      if (prepareMutation()) useConversationStore.getState().selectNode(nodeId)
    },
    archiveConversation: async () => {
      if (!prepareMutation()) return
      await useConversationStore
        .getState()
        .archiveConversation(conversationClient)
    },
    createConversation: async (content) => {
      if (!prepareMutation()) return false
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
      startGeneration({
        conversationId: authoritativeTree.conversation.id,
        parentNodeId: authoritativeTree.rootNodeId,
      })
      return true
    },
    loadConversation: async (id) => {
      if (!prepareMutation()) return
      await useConversationStore
        .getState()
        .loadConversation(conversationClient, id)
    },
    appendNode: async (content) => {
      if (!prepareMutation()) return
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
      if (!prepareMutation()) return
      await useConversationStore
        .getState()
        .createBranch(conversationClient, parentNodeId, content)
    },
    editNodeAsBranch: async (sourceNodeId, content) => {
      if (!prepareMutation()) return
      await useConversationStore
        .getState()
        .editNodeAsBranch(conversationClient, sourceNodeId, content)
    },
    retryReconciliation: () => {
      const current = useConversationStore.getState().generation
      if (
        current.phase === "reconciling" &&
        useConversationStore
          .getState()
          .retryGenerationReconciliation(current.runId)
      ) {
        void reconcile(current.runId)
      }
    },
  }
}
