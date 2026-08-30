import * as React from "react"
import { useShallow } from "zustand/react/shallow"

import { Composer, type ComposerAction, type ComposerHandle } from "./Composer"
import {
  ConversationPane,
  type AssistantRegenerationAction,
  type TransientGenerationView,
  type UserGenerationAction,
} from "./ConversationPane"
import type { BranchSwitcherControl } from "./MessageNode"
import {
  isRunActive,
  selectActivePath,
  selectCurrentRun,
  type ConversationTreeState,
  useConversationStore,
} from "../store"
import type { PathMessageView, SearchReveal, UiError } from "../types"
import { useProviderStore } from "@/features/providers/store"
import { useTranslation } from "@/lib/i18n"

type BranchComposerTarget = {
  conversationId: string
  parentNodeId: string
}

type AssistantRegenerationTarget = {
  conversationId: string
  assistantNodeId: string
  parentUserNodeId: string
}

function resolveAssistantRegenerationTarget(
  state: ConversationTreeState,
): AssistantRegenerationTarget | null {
  if (
    state.isCreatingConversation ||
    state.conversationId === null ||
    state.isArchived ||
    state.status !== "ready" ||
    state.generationRuns[state.conversationId] !== undefined
  ) {
    return null
  }

  const projection = selectActivePath(state)
  const finalMessage =
    projection.kind === "ready" ? projection.path.at(-1) : null
  if (
    finalMessage?.role !== "assistant" ||
    state.activeNodeId !== finalMessage.id
  ) {
    return null
  }

  const assistantNode = state.fullNodes[finalMessage.id]
  if (
    assistantNode?.role !== "assistant" ||
    assistantNode.parentId === undefined ||
    assistantNode.conversationId !== state.conversationId
  ) {
    return null
  }

  const parentNode = state.fullNodes[assistantNode.parentId]
  if (
    parentNode?.role !== "user" ||
    parentNode.conversationId !== state.conversationId
  ) {
    return null
  }

  return {
    conversationId: state.conversationId,
    assistantNodeId: assistantNode.id,
    parentUserNodeId: parentNode.id,
  }
}

function resolveTransientGeneration(
  currentRun: ReturnType<typeof selectCurrentRun>,
): TransientGenerationView | null {
  if (currentRun === undefined) return null
  switch (currentRun.phase) {
    case "starting":
      return { phase: "starting" }
    case "streaming":
      return {
        phase: "streaming",
        content: currentRun.content,
        thinking: currentRun.thinking,
      }
    case "failed":
      return currentRun.failureKind === "generation"
        ? {
            phase: "failed",
            failureKind: "generation",
          }
        : {
            phase: "failed",
            failureKind: "persistence",
            content: currentRun.content,
          }
    case "cancelled":
      return {
        phase: "cancelled",
        content: currentRun.content,
      }
  }
}

export type WorkspaceStreamingLayerProps = {
  path: readonly PathMessageView[]
  pendingBranchOriginId: string | null
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error?: UiError | null
  onRetry: () => void
  canBranch: (nodeId: string) => boolean
  canEdit: (nodeId: string) => boolean
  onCreateBranch: (nodeId: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
  onExportMessage: (nodeId: string) => void
  onRegenerate: () => void
  branchSwitcherFor: (nodeId: string) => BranchSwitcherControl | null
  reveal?: SearchReveal | null
  canMutate: boolean
  canEditDraft: boolean
  isArchived: boolean
  activeNodeId: string | null
  nodesById: ConversationTreeState["nodesById"]
  activeBranchComposerTarget: BranchComposerTarget | null
  canAppend: boolean
  composerAction: ComposerAction
  composerRef: React.RefObject<ComposerHandle | null>
  onComposerSubmit: (content: string) => Promise<boolean | void>
  onConfigureProvider: () => void
  onGenerate: () => void
  onRegenerateAssistant: (assistantNodeId: string) => void
}

export function WorkspaceStreamingLayer({
  path,
  pendingBranchOriginId,
  status,
  error,
  onRetry,
  canBranch,
  canEdit,
  onCreateBranch,
  onEditAsBranch,
  onExportMessage,
  onRegenerate,
  branchSwitcherFor,
  reveal,
  canMutate,
  canEditDraft,
  isArchived,
  activeNodeId,
  nodesById,
  activeBranchComposerTarget,
  canAppend,
  composerAction,
  composerRef,
  onComposerSubmit,
  onConfigureProvider,
  onGenerate,
  onRegenerateAssistant,
}: WorkspaceStreamingLayerProps) {
  const { t } = useTranslation()
  const providerPhase = useProviderStore((state) => state.phase)
  const currentRun = useConversationStore(selectCurrentRun)
  const pathProjection = useConversationStore(useShallow(selectActivePath))

  const transientGeneration = resolveTransientGeneration(currentRun)
  const transientBubbleVisible =
    transientGeneration !== null &&
    pathProjection.kind === "ready" &&
    pathProjection.path.at(-1)?.id === currentRun?.parentNodeId

  const userGenerationAction: UserGenerationAction | null = (() => {
    if (!canMutate || activeNodeId === null || currentRun !== undefined) {
      return null
    }
    const activeNode = nodesById[activeNodeId]
    if (activeNode?.role !== "user" || activeNode.childIds.length > 0) {
      return null
    }
    if (providerPhase === "ready") {
      return {
        kind: "generate",
        onSelect: onGenerate,
      }
    }
    return {
      kind: "configure-provider",
      onSelect: onConfigureProvider,
    }
  })()

  const assistantRegenerationTarget =
    providerPhase === "ready"
      ? resolveAssistantRegenerationTarget(useConversationStore.getState())
      : null
  const assistantRegenerationAction: AssistantRegenerationAction | null =
    assistantRegenerationTarget === null
      ? null
      : {
          assistantNodeId: assistantRegenerationTarget.assistantNodeId,
          onSelect: onRegenerateAssistant,
        }

  const composerPlaceholder = isArchived
    ? t("conversation.workspace.placeholderArchived")
    : isRunActive(currentRun) && !transientBubbleVisible
      ? t("conversation.workspace.placeholderGenerating")
      : activeBranchComposerTarget !== null
        ? t("conversation.workspace.placeholderBranchMessage")
        : canAppend
          ? t("conversation.workspace.placeholderNextMessage")
          : t("conversation.workspace.placeholderDraftOnly")

  return (
    <>
      <ConversationPane
        path={path}
        status={status}
        error={error}
        onRetry={onRetry}
        canBranch={canBranch}
        canEdit={canEdit}
        onCreateBranch={onCreateBranch}
        onEditAsBranch={onEditAsBranch}
        onExportMessage={onExportMessage}
        exportDisabled={isRunActive(currentRun)}
        transientGeneration={
          pendingBranchOriginId === null && transientBubbleVisible
            ? transientGeneration
            : null
        }
        onRegenerate={onRegenerate}
        userGenerationAction={userGenerationAction}
        assistantRegenerationAction={assistantRegenerationAction}
        pendingBranchOriginId={pendingBranchOriginId}
        reveal={reveal}
        branchSwitcherFor={branchSwitcherFor}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <Composer
          ref={composerRef}
          onSubmit={onComposerSubmit}
          inputDisabled={!canEditDraft}
          action={composerAction}
          placeholder={composerPlaceholder}
        />
      </div>
    </>
  )
}
