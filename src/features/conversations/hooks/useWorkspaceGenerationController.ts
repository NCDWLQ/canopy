import * as React from "react"

import { deriveConversationTitle } from "../deriveConversationTitle"
import {
  isGenerationActive,
  normalizeUiError,
  selectActivePath,
  useConversationStore,
} from "../store"
import type { ConversationNodeView, ConversationTreeView } from "../types"
import { useProviderProfileStore } from "@/features/providers/store"
import type {
  GenerationEventView,
  GenerationTerminalView,
} from "@/features/providers/types"
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

export function useWorkspaceGenerationController({
  conversationClient,
  providerClient,
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
  const recoveryRuns = React.useRef(new Set<number>())
  const isMounted = React.useRef(false)

  const requestExactCancellation = React.useCallback(
    (generationId: string) => {
      if (cancelSentIds.current.has(generationId)) return
      cancelSentIds.current.add(generationId)
      void providerClient.cancelGeneration(generationId).catch(() => undefined)
    },
    [providerClient],
  )

  const recoverAmbiguousRun = React.useCallback(
    async (runId: number, target: GenerationTarget, fallback: unknown) => {
      if (recoveryRuns.current.has(runId)) return
      recoveryRuns.current.add(runId)
      const beforeReload = useConversationStore.getState().generation
      if (
        beforeReload.phase === "idle" ||
        beforeReload.phase === "failed" ||
        beforeReload.runId !== runId
      ) {
        return
      }
      try {
        const tree = await conversationClient.loadConversationTree(
          target.conversationId,
        )
        if (!useConversationStore.getState().recoverGeneration(runId, tree)) {
          const current = useConversationStore.getState().generation
          if (isGenerationActive(current)) {
            useConversationStore
              .getState()
              .failGeneration(runId, normalizeUiError(fallback))
          }
        }
      } catch (error: unknown) {
        useConversationStore
          .getState()
          .failGenerationRecovery(runId, normalizeUiError(error))
      }
    },
    [conversationClient],
  )

  const handleTerminal = React.useCallback(
    async (
      runId: number,
      target: GenerationTarget,
      terminal: GenerationTerminalView,
    ) => {
      generationIds.current.set(runId, terminal.generationId)
      const current = useConversationStore.getState().generation
      if (current.phase === "idle" || current.runId !== runId) return

      if (terminal.type === "completed") {
        if (
          !useConversationStore
            .getState()
            .completeGeneration(runId, terminal.generationId, terminal.node)
        ) {
          await recoverAmbiguousRun(runId, target, terminal)
        }
      } else if (terminal.type === "cancelled") {
        useConversationStore
          .getState()
          .acceptGenerationCancelled(runId, terminal.generationId)
      } else {
        useConversationStore
          .getState()
          .failGeneration(
            runId,
            terminal.error,
            terminal.generationId,
            terminal.stage,
          )
      }
    },
    [recoverAmbiguousRun],
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
      const target = {
        conversationId: current.conversationId,
        parentNodeId: current.parentNodeId,
      }

      void providerClient
        .generateFromActivePath(
          target.conversationId,
          target.parentNodeId,
          (event) => handleEvent(runId, event),
        )
        .then((terminal) => handleTerminal(runId, target, terminal))
        .catch((error: unknown) => {
          const currentGeneration = useConversationStore.getState().generation
          const normalizedError = normalizeUiError(error)
          const knownGenerationId =
            ("generationId" in currentGeneration
              ? currentGeneration.generationId
              : undefined) ??
            generationIds.current.get(runId) ??
            generationIdFromBridgeError(error)
          if (
            knownGenerationId !== undefined ||
            normalizedError.code === "internal"
          ) {
            void recoverAmbiguousRun(runId, target, error)
          } else {
            useConversationStore
              .getState()
              .failGeneration(runId, normalizedError)
          }
        })
    },
    [handleEvent, handleTerminal, providerClient, recoverAmbiguousRun],
  )

  const generate = React.useCallback(() => {
    startGeneration()
  }, [startGeneration])

  const prepareMutation = React.useCallback(() => {
    if (isGenerationActive(useConversationStore.getState().generation)) cancel()
    return true
  }, [cancel])

  React.useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      if (isGenerationActive(useConversationStore.getState().generation))
        cancel()
    }
  }, [cancel])

  const mutationLocked = isGenerationActive(generation)
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
    archiveConversation: async (targetId) => {
      const store = useConversationStore.getState()
      const target = targetId ?? store.conversationId
      if (target === null) return
      // Confirm-time interruption: only archiving the generating current
      // conversation may cancel the run; any other row leaves it untouched.
      // cancel() flips generation.phase synchronously, so the store call
      // below observes an inactive generation.
      if (
        target === store.conversationId &&
        isGenerationActive(store.generation)
      ) {
        cancel()
      }
      await useConversationStore
        .getState()
        .archiveConversation(conversationClient, target)
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
  }
}
