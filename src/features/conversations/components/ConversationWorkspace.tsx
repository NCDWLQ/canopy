import * as React from "react"
import {
  Archive,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  SquarePen,
  Trash2,
  Waypoints,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Composer, type ComposerAction, type ComposerHandle } from "./Composer"
import { ConversationPanorama } from "./ConversationPanorama"
import { RenameConversationDialog } from "./RenameConversationDialog"
import { SearchDialog } from "./SearchDialog"
import { WorkspaceStreamingLayer } from "./WorkspaceStreamingLayer"
import { workspaceRenderProbe } from "./workspaceRenderProbe"
import { useConversationTitleUpdates } from "../hooks/useConversationTitleUpdates"
import { useWorkspaceGenerationController } from "../hooks/useWorkspaceGenerationController"
import {
  isRunActive,
  newestLeafDescendant,
  pathIdsToNode,
  selectActivePath,
  siblingBranchInfo,
  useConversationStore,
} from "../store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Spinner } from "@/components/ui/spinner"
import { showClickableToast } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SettingsDialog,
  type SettingsCategory,
} from "@/features/settings/components"
import { ConversationProviderPicker } from "./ConversationProviderPicker"
import { ConversationSettingsDialog } from "./ConversationSettingsDialog"
import { useProviderStore } from "@/features/providers/store"
import {
  createConversationClient,
  createProviderClient,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"

export type ConversationWorkspaceProps = {
  conversationClient?: ConversationClient
  providerClient?: ProviderClient
}

type BranchComposerTarget = {
  conversationId: string
  parentNodeId: string
}

function HistoryGeneratingSpinner({
  conversationId,
}: {
  conversationId: string
}) {
  const { t } = useTranslation()
  const isGenerating = useConversationStore((state) =>
    isRunActive(state.generationRuns[conversationId]),
  )
  if (!isGenerating) return null
  return (
    <Spinner
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-label={t("conversation.workspace.generatingReply")}
    />
  )
}

function WorkspaceRenderProbe() {
  workspaceRenderProbe.count += 1
  return null
}

export function ConversationWorkspace({
  conversationClient: injectedConversationClient,
  providerClient: injectedProviderClient,
}: ConversationWorkspaceProps = {}) {
  const { t } = useTranslation()
  useConversationTitleUpdates()
  const client = React.useMemo(
    () => injectedConversationClient ?? createConversationClient(),
    [injectedConversationClient],
  )
  const providerClient = React.useMemo(
    () => injectedProviderClient ?? createProviderClient(),
    [injectedProviderClient],
  )
  const loadProviders = useProviderStore((state) => state.loadProviders)
  const store = useConversationStore(
    useShallow((state) => ({
      conversationId: state.conversationId,
      title: state.title,
      isCreatingConversation: state.isCreatingConversation,
      isArchived: state.isArchived,
      providerId: state.providerId,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      draftBinding: state.draftBinding,
      draftReasoningEffort: state.draftReasoningEffort,
      rootNodeId: state.rootNodeId,
      activeNodeId: state.activeNodeId,
      nodesById: state.nodesById,
      fullNodes: state.fullNodes,
      status: state.status,
      error: state.error,
      reveal: state.reveal,
      history: state.history,
      clearError: state.clearError,
      retryHistory: state.retryHistory,
      selectConversation: state.selectConversation,
      revealSearchHit: state.revealSearchHit,
      enterConversationCreation: state.enterConversationCreation,
    })),
  )
  const initializeHistory = useConversationStore(
    (state) => state.initializeHistory,
  )
  const selectNode = useConversationStore((state) => state.selectNode)
  const selectBranchAtNode = useConversationStore(
    (state) => state.selectBranchAtNode,
  )
  const pathProjection = useConversationStore(useShallow(selectActivePath))
  const controller = useWorkspaceGenerationController({
    conversationClient: client,
    providerClient,
  })
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [settingsCategory, setSettingsCategory] =
    React.useState<SettingsCategory>("general")
  const [isSearchOpen, setIsSearchOpen] = React.useState(false)
  const [isPanoramaOpen, setIsPanoramaOpen] = React.useState(false)
  const [pendingArchiveId, setPendingArchiveId] = React.useState<string | null>(
    null,
  )
  const [pendingRenameId, setPendingRenameId] = React.useState<string | null>(
    null,
  )
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  )
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = React.useState<
    string | null
  >(null)
  const [branchComposerTarget, setBranchComposerTarget] =
    React.useState<BranchComposerTarget | null>(null)
  // Keep the pending target through the store's authoritative active-node
  // update during createBranch. The submit handler clears it after it has
  // verified that the returned node is the new active branch child.
  const branchSubmissionTargetRef = React.useRef<BranchComposerTarget | null>(
    null,
  )
  const composerRef = React.useRef<ComposerHandle>(null)

  React.useEffect(() => {
    void loadProviders(providerClient)
  }, [loadProviders, providerClient])

  React.useEffect(() => {
    void initializeHistory(client)
  }, [client, initializeHistory])

  // Keep the selected conversation's history row visible — e.g. after a
  // search reveal jumps to an older conversation far down the list.
  const historyScrollRef = React.useRef<HTMLDivElement>(null)
  const scrollHistoryRowIntoView = React.useCallback(
    (conversationId: string) => {
      const row = Array.from(
        historyScrollRef.current?.querySelectorAll<HTMLElement>(
          "[data-conversation-id]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.conversationId === conversationId)
      if (row === undefined) return
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
      row.scrollIntoView?.({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      })
    },
    [],
  )
  React.useEffect(() => {
    if (store.conversationId === null) return
    scrollHistoryRowIntoView(store.conversationId)
  }, [scrollHistoryRowIntoView, store.conversationId])

  const projectionError =
    pathProjection.kind === "error" ? pathProjection.error : null
  const visiblePath = React.useMemo(
    () => (pathProjection.kind === "ready" ? pathProjection.path : []),
    [pathProjection],
  )
  const isProjectionValid = pathProjection.kind !== "error"
  const activePathIds = React.useMemo(
    () => visiblePath.map((message) => message.id),
    [visiblePath],
  )
  // Selection truncates at the clicked card; path chrome still follows the
  // newest leaf under that card so connectors stay lit through the branch.
  const highlightedPathIds = React.useMemo(() => {
    const selectedId = store.activeNodeId
    if (selectedId === null) return activePathIds
    const leafId =
      newestLeafDescendant(store.nodesById, store.fullNodes, selectedId) ??
      selectedId
    if (leafId === selectedId) return activePathIds
    return pathIdsToNode(store.nodesById, leafId) ?? activePathIds
  }, [store.activeNodeId, store.nodesById, store.fullNodes, activePathIds])
  const isBlankConversation =
    store.isCreatingConversation ||
    (store.conversationId === null && store.history.status === "empty")

  const activeSummaries = React.useMemo(
    () => store.history.summaries.filter((summary) => !summary.isArchived),
    [store.history.summaries],
  )
  const archivedSummaries = React.useMemo(
    () => store.history.summaries.filter((summary) => summary.isArchived),
    [store.history.summaries],
  )
  const archivedPanelStatus = React.useMemo(() => {
    if (store.history.status === "error") return "error"
    if (archivedSummaries.length > 0) return "ready"
    if (store.history.status === "loading" || store.history.status === "idle") {
      return "loading"
    }
    return "empty"
  }, [archivedSummaries.length, store.history.status])
  const archivedConversationItems = React.useMemo(
    () =>
      archivedSummaries.map((summary) => ({
        id: summary.id,
        title: summary.title,
        updatedAt: summary.updatedAt,
        isCurrent: !isBlankConversation && store.conversationId === summary.id,
      })),
    [archivedSummaries, isBlankConversation, store.conversationId],
  )
  const historyMutationDisabled =
    store.status === "loading" || controller.mutationLocked

  const canEditDraft =
    !isBlankConversation &&
    store.conversationId !== null &&
    !store.isArchived &&
    store.status === "ready" &&
    isProjectionValid

  const canMutate = canEditDraft && !controller.mutationLocked

  const canAppend = (() => {
    if (!canMutate || store.activeNodeId === null) return false
    const node = store.nodesById[store.activeNodeId]
    return node?.role === "assistant" && node.childIds.length === 0
  })()

  const activeBranchComposerTarget =
    branchComposerTarget?.conversationId === store.conversationId &&
    !isBlankConversation
      ? branchComposerTarget
      : null

  const pendingBranchOriginIndex =
    activeBranchComposerTarget === null
      ? -1
      : visiblePath.findIndex(
          (message) => message.id === activeBranchComposerTarget.parentNodeId,
        )
  const renderedMessagePath =
    pendingBranchOriginIndex === -1
      ? visiblePath
      : visiblePath.slice(0, pendingBranchOriginIndex + 1)
  const pendingBranchOriginId =
    pendingBranchOriginIndex === -1 || activeBranchComposerTarget === null
      ? null
      : activeBranchComposerTarget.parentNodeId

  const branchSwitcherMap = React.useMemo(() => {
    const map = new Map<
      string,
      {
        index: number
        count: number
        prevDisabled: boolean
        nextDisabled: boolean
        onPrev: () => void
        onNext: () => void
      }
    >()
    for (const message of renderedMessagePath) {
      const info = siblingBranchInfo(store.nodesById, message.id)
      if (info === null) continue
      map.set(message.id, {
        index: info.index,
        count: info.count,
        prevDisabled: info.prevId === undefined,
        nextDisabled: info.nextId === undefined,
        onPrev: () => {
          if (info.prevId !== undefined) selectBranchAtNode(info.prevId)
        },
        onNext: () => {
          if (info.nextId !== undefined) selectBranchAtNode(info.nextId)
        },
      })
    }
    return map
  }, [renderedMessagePath, selectBranchAtNode, store.nodesById])

  const branchSwitcherFor = React.useCallback(
    (nodeId: string) => branchSwitcherMap.get(nodeId) ?? null,
    [branchSwitcherMap],
  )

  React.useEffect(
    () =>
      useConversationStore.subscribe((current, previous) => {
        if (
          current.conversationId !== previous.conversationId ||
          (!previous.isCreatingConversation &&
            current.isCreatingConversation) ||
          (current.activeNodeId !== previous.activeNodeId &&
            branchSubmissionTargetRef.current === null)
        ) {
          setBranchComposerTarget(null)
        }
      }),
    [],
  )

  const branchParent =
    activeBranchComposerTarget === null
      ? undefined
      : store.nodesById[activeBranchComposerTarget.parentNodeId]
  const canSubmitBranch =
    canMutate &&
    branchParent?.role === "assistant" &&
    branchParent.childIds.length > 0

  const composerAction: ComposerAction = controller.canCancel
    ? { kind: "cancel", onCancel: controller.cancel }
    : {
        kind: "send",
        disabled:
          activeBranchComposerTarget === null ? !canAppend : !canSubmitBranch,
      }

  const canCreateBranch = React.useCallback(
    (nodeId: string) => {
      if (!canMutate) return false
      const node = store.nodesById[nodeId]
      return node?.role === "assistant" && node.childIds.length > 0
    },
    [canMutate, store.nodesById],
  )

  const canEditAsBranch = React.useCallback(
    (nodeId: string) => {
      if (!canMutate) return false
      const node = store.fullNodes[nodeId]
      const parent =
        node?.parentId === undefined
          ? undefined
          : store.fullNodes[node.parentId]
      return node?.role === "user" && parent?.role === "assistant"
    },
    [canMutate, store.fullNodes],
  )

  const handleEditAsBranch = React.useCallback(
    (nodeId: string, content: string) => {
      void controller.editNodeAsBranch(nodeId, content)
    },
    [controller],
  )

  const handleExportMessage = React.useCallback(
    (nodeId: string) => {
      void useConversationStore.getState().exportUpToMessage(client, nodeId)
    },
    [client],
  )

  const handleConfigureProvider = React.useCallback(() => {
    setSettingsCategory("providers")
    setIsSettingsOpen(true)
  }, [])

  // Shared by the conversation pane's per-message action and the panorama
  // card action. Returns whether the branch composer actually armed; the
  // panorama caller closes the canvas only on success.
  const handleStartBranch = React.useCallback((parentNodeId: string) => {
    const current = useConversationStore.getState()
    const parent = current.nodesById[parentNodeId]
    if (
      current.isCreatingConversation ||
      current.conversationId === null ||
      current.isArchived ||
      current.status !== "ready" ||
      isRunActive(current.generationRuns[current.conversationId]) ||
      selectActivePath(current).kind === "error" ||
      parent?.role !== "assistant" ||
      parent.childIds.length === 0
    ) {
      return false
    }
    setBranchComposerTarget({
      conversationId: current.conversationId,
      parentNodeId,
    })
    composerRef.current?.focus()
    return true
  }, [])

  // Panorama cards sit above the Composer in the render tree: the focus call
  // inside handleStartBranch no-ops while the canvas replaces the pane, so
  // replay it after the switch back to the conversation view.
  const focusComposerAfterPanoramaRef = React.useRef(false)
  React.useEffect(() => {
    if (isPanoramaOpen || !focusComposerAfterPanoramaRef.current) return
    focusComposerAfterPanoramaRef.current = false
    composerRef.current?.focus()
  }, [isPanoramaOpen])

  const handlePanoramaCreateBranch = React.useCallback(
    (nodeId: string) => {
      // Select first so the pane's active path runs through the branch
      // origin (its store update also fires before the target is armed).
      selectNode(nodeId)
      if (!handleStartBranch(nodeId)) return
      focusComposerAfterPanoramaRef.current = true
      setIsPanoramaOpen(false)
    },
    [handleStartBranch, selectNode],
  )

  const handlePanoramaDeleteNode = React.useCallback((nodeId: string) => {
    setPendingDeleteNodeId(nodeId)
  }, [])

  const handleComposerSubmit = async (content: string) => {
    const target = activeBranchComposerTarget
    if (target === null) {
      await controller.appendNode(content)
      return
    }

    const previousActiveNodeId = useConversationStore.getState().activeNodeId
    branchSubmissionTargetRef.current = target
    try {
      await controller.createBranch(target.parentNodeId, content)
    } finally {
      branchSubmissionTargetRef.current = null
    }

    const current = useConversationStore.getState()
    const activeNode =
      current.activeNodeId === null
        ? undefined
        : current.fullNodes[current.activeNodeId]
    const succeeded =
      current.conversationId === target.conversationId &&
      current.status === "ready" &&
      current.activeNodeId !== previousActiveNodeId &&
      activeNode?.role === "user" &&
      activeNode.parentId === target.parentNodeId

    if (succeeded) {
      setBranchComposerTarget((pending) =>
        pending?.conversationId === target.conversationId &&
        pending.parentNodeId === target.parentNodeId
          ? null
          : pending,
      )
    }
    return succeeded
  }

  const handleRegenerateAssistant = React.useCallback(
    (assistantNodeId: string) => {
      if (useProviderStore.getState().phase !== "ready") return

      const state = useConversationStore.getState()
      if (
        state.isCreatingConversation ||
        state.conversationId === null ||
        state.isArchived ||
        state.status !== "ready" ||
        state.generationRuns[state.conversationId] !== undefined
      ) {
        return
      }

      const projection = selectActivePath(state)
      const finalMessage =
        projection.kind === "ready" ? projection.path.at(-1) : null
      if (
        finalMessage?.role !== "assistant" ||
        state.activeNodeId !== finalMessage.id ||
        finalMessage.id !== assistantNodeId
      ) {
        return
      }

      const assistantNode = state.fullNodes[finalMessage.id]
      if (
        assistantNode?.role !== "assistant" ||
        assistantNode.parentId === undefined
      ) {
        return
      }

      const parentUserNodeId = assistantNode.parentId
      controller.selectNode(parentUserNodeId)
      const selectedState = useConversationStore.getState()
      if (
        selectedState.conversationId !== state.conversationId ||
        selectedState.activeNodeId !== parentUserNodeId
      ) {
        return
      }
      controller.generate()
    },
    [controller],
  )

  const handleRetry = () => {
    if (store.conversationId === null) store.clearError()
    else void controller.loadConversation(store.conversationId)
  }

  const pendingArchiveSummary =
    pendingArchiveId === null
      ? null
      : (store.history.summaries.find((item) => item.id === pendingArchiveId) ??
        null)
  const pendingArchiveInterrupts = useConversationStore(
    (state) =>
      pendingArchiveId !== null &&
      isRunActive(state.generationRuns[pendingArchiveId]),
  )
  const openArchivedSettings = React.useCallback(() => {
    setSettingsCategory("archived")
    setIsSettingsOpen(true)
  }, [])
  const confirmArchiveConversation = React.useCallback(
    async (target: string) => {
      setPendingArchiveId(null)
      await controller.archiveConversation(target)
      const summary = useConversationStore
        .getState()
        .history.summaries.find((item) => item.id === target)
      if (summary?.isArchived !== true) return
      showClickableToast({
        kind: "success",
        title: t("conversation.toast.archivedTitle"),
        description: t("conversation.toast.archivedDescription"),
        ariaLabel: t("conversation.toast.openArchivedSettings"),
        onSelect: openArchivedSettings,
      })
    },
    [controller, openArchivedSettings, t],
  )
  const pendingRenameSummary =
    pendingRenameId === null
      ? null
      : (store.history.summaries.find((item) => item.id === pendingRenameId) ??
        null)
  const pendingDeleteSummary =
    pendingDeleteId === null
      ? null
      : (store.history.summaries.find((item) => item.id === pendingDeleteId) ??
        null)
  const pendingDeleteInterrupts = useConversationStore(
    (state) =>
      pendingDeleteId !== null &&
      isRunActive(state.generationRuns[pendingDeleteId]),
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <WorkspaceRenderProbe />
      <aside
        id="conversation-tree-sidebar"
        aria-label={t("conversation.workspace.sidebar")}
        className={`flex shrink-0 flex-col overflow-hidden border-border/70 bg-sidebar text-sidebar-foreground transition-[width] duration-250 ease-[var(--ease-out)] motion-reduce:transition-none ${
          isSidebarOpen ? "w-64 border-r md:w-80" : "w-0 border-r-0"
        }`}
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <div className="flex h-full w-64 shrink-0 flex-col md:w-80">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3 text-sm font-semibold">
            <span className="font-bold tracking-tight">Canopy</span>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("search.openButton")}
                    disabled={store.history.summaries.length === 0}
                    onClick={() => setIsSearchOpen(true)}
                  >
                    <Search className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("search.openButton")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("conversation.workspace.newConversation")}
                    disabled={store.status === "loading"}
                    onClick={store.enterConversationCreation}
                  >
                    <SquarePen className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.workspace.newConversation")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div
            ref={historyScrollRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
          >
            <section>
              <div className="sticky top-0 z-10 bg-sidebar px-2.5 pb-1 pt-3 text-sm font-medium text-muted-foreground/70">
                {t("conversation.workspace.history")}
              </div>
              {activeSummaries.length > 0 && (
                <ul
                  aria-label={t("conversation.workspace.historyList")}
                  className="flex flex-col gap-1"
                >
                  {activeSummaries.map((summary) => {
                    const isCurrent =
                      !isBlankConversation &&
                      store.conversationId === summary.id
                    return (
                      <li key={summary.id}>
                        <div
                          className={cn(
                            "group relative flex items-center rounded-lg transition-colors motion-reduce:transition-none",
                            isCurrent
                              ? "bg-sidebar-accent"
                              : "hover:bg-sidebar-accent",
                          )}
                        >
                          <button
                            type="button"
                            className={cn(
                              "flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg pl-2.5 pr-9 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                              isCurrent && "font-medium",
                            )}
                            aria-current={isCurrent ? "page" : undefined}
                            data-conversation-id={summary.id}
                            disabled={store.status === "loading"}
                            onClick={() =>
                              void store.selectConversation(client, summary.id)
                            }
                          >
                            <span
                              className="min-w-0 truncate"
                              title={summary.title}
                            >
                              {summary.title}
                            </span>
                            <HistoryGeneratingSpinner
                              conversationId={summary.id}
                            />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute inset-y-0 right-1 my-auto size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:text-foreground"
                                aria-label={t(
                                  "conversation.workspace.conversationMenu",
                                  { title: summary.title },
                                )}
                              >
                                <MoreHorizontal
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-auto min-w-40"
                            >
                              <DropdownMenuItem
                                onSelect={() => setPendingRenameId(summary.id)}
                              >
                                <Pencil />
                                {t("conversation.workspace.rename")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setPendingArchiveId(summary.id)}
                              >
                                <Archive />
                                {t("conversation.workspace.archive")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setPendingDeleteId(summary.id)}
                              >
                                <Trash2 />
                                {t("common.delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {store.history.status === "loading" &&
                activeSummaries.length === 0 && (
                  <p className="px-2.5 py-3 text-sm text-muted-foreground">
                    {t("conversation.workspace.loadingHistory")}
                  </p>
                )}
              {store.history.status === "empty" && (
                <p className="px-2.5 py-3 text-sm text-muted-foreground">
                  {t("conversation.workspace.emptyHistory")}
                </p>
              )}
              {store.history.status === "ready" &&
                activeSummaries.length === 0 &&
                archivedSummaries.length > 0 && (
                  <p className="px-2.5 py-3 text-sm text-muted-foreground">
                    {t("conversation.workspace.noActiveHistory")}
                  </p>
                )}
              {store.history.status === "error" && (
                <Alert variant="destructive">
                  <AlertDescription className="flex flex-col gap-2">
                    <p>{commandErrorMessage(store.history.error.code)}</p>
                    {store.history.error.retryable && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void store.retryHistory(client)}
                      >
                        {t("conversation.workspace.retryHistory")}
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </section>
          </div>
          <footer className="shrink-0 p-2">
            <SettingsDialog
              client={providerClient}
              readOnly={false}
              open={isSettingsOpen}
              onOpenChange={(nextOpen) => {
                setIsSettingsOpen(nextOpen)
                if (!nextOpen) {
                  setSettingsCategory("general")
                }
              }}
              initialCategory={settingsCategory}
              archivedConversations={{
                status: archivedPanelStatus,
                items: archivedConversationItems,
                error:
                  store.history.status === "error" ? store.history.error : null,
                disabled: historyMutationDisabled,
                onSelect: (id) => {
                  setIsSettingsOpen(false)
                  setSettingsCategory("general")
                  void store.selectConversation(client, id)
                },
                onRename: setPendingRenameId,
                onUnarchive: (id) => void controller.unarchiveConversation(id),
                onDelete: setPendingDeleteId,
                onRetry: () => void store.retryHistory(client),
              }}
            />
            <SearchDialog
              key={isSearchOpen ? "search-open" : "search-closed"}
              open={isSearchOpen}
              onOpenChange={setIsSearchOpen}
              client={client}
              onReveal={(conversationId, nodeId, query) => {
                void store
                  .revealSearchHit(client, conversationId, nodeId, query)
                  .then(() => {
                    if (
                      useConversationStore.getState().conversationId ===
                      conversationId
                    ) {
                      scrollHistoryRowIntoView(conversationId)
                    }
                  })
              }}
            />
          </footer>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <header className="z-10 flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
                  aria-label={
                    isSidebarOpen
                      ? t("conversation.workspace.collapseSidebar")
                      : t("conversation.workspace.expandSidebar")
                  }
                  aria-expanded={isSidebarOpen}
                  aria-controls="conversation-tree-sidebar"
                >
                  {isSidebarOpen ? (
                    <PanelLeftClose aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isSidebarOpen
                  ? t("conversation.workspace.collapseSidebar")
                  : t("conversation.workspace.expandSidebar")}
              </TooltipContent>
            </Tooltip>
            {!isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t("conversation.workspace.newConversation")}
                    disabled={store.status === "loading"}
                    onClick={store.enterConversationCreation}
                  >
                    <SquarePen className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.workspace.newConversation")}
                </TooltipContent>
              </Tooltip>
            )}
            {!isBlankConversation && store.isArchived && (
              <Badge variant="secondary">
                <Archive data-icon="inline-start" />
                {t("conversation.workspace.archivedReadonlyBadge")}
              </Badge>
            )}
            {(isBlankConversation || store.conversationId !== null) && (
              <ConversationProviderPicker
                conversationClient={client}
                draftMode={isBlankConversation}
                providerId={
                  isBlankConversation
                    ? (store.draftBinding?.providerId ?? null)
                    : store.providerId
                }
                model={
                  isBlankConversation
                    ? (store.draftBinding?.model ?? null)
                    : store.model
                }
                reasoningEffort={
                  isBlankConversation
                    ? store.draftReasoningEffort
                    : store.reasoningEffort
                }
                readOnly={!isBlankConversation && store.isArchived}
                onManageProviders={() => {
                  setSettingsCategory("providers")
                  setIsSettingsOpen(true)
                }}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isBlankConversation && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isPanoramaOpen ? "secondary" : "ghost"}
                    size="icon"
                    className={cn(
                      "size-8",
                      isPanoramaOpen &&
                        "bg-secondary text-secondary-foreground",
                    )}
                    aria-label={
                      isPanoramaOpen
                        ? t("conversation.panorama.closePanorama")
                        : t("conversation.panorama.openPanorama")
                    }
                    aria-pressed={isPanoramaOpen}
                    disabled={store.status === "loading"}
                    onClick={() => setIsPanoramaOpen((isOpen) => !isOpen)}
                  >
                    {isPanoramaOpen ? (
                      <MessageSquare className="size-4" aria-hidden="true" />
                    ) : (
                      <Waypoints className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isPanoramaOpen
                    ? t("conversation.panorama.closePanorama")
                    : t("conversation.panorama.openPanorama")}
                </TooltipContent>
              </Tooltip>
            )}
            {(isBlankConversation || store.conversationId !== null) && (
              <ConversationSettingsDialog
                conversationClient={client}
                draftMode={isBlankConversation}
                readOnly={!isBlankConversation && store.isArchived}
              />
            )}
          </div>
        </header>

        {isBlankConversation ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <section
              data-testid="blank-conversation-pane"
              className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 pb-28 text-center"
              aria-labelledby="blank-conversation-title"
            >
              <h1
                id="blank-conversation-title"
                className="text-2xl font-semibold"
              >
                {t("conversation.workspace.blankTitle")}
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("conversation.workspace.blankHint")}
              </p>
              {store.error !== null && (
                <Alert variant="destructive" className="max-w-md text-left">
                  <AlertDescription className="flex flex-col gap-3">
                    <p>{commandErrorMessage(store.error.code)}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={store.clearError}
                    >
                      {t("common.close")}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
              <Composer
                onSubmit={controller.createConversation}
                inputDisabled={store.status === "loading"}
                action={{
                  kind: "send",
                  disabled: store.status === "loading",
                }}
                placeholder={t(
                  "conversation.workspace.firstMessagePlaceholder",
                )}
              />
            </div>
          </div>
        ) : store.conversationId === null &&
          (store.history.status === "idle" ||
            store.history.status === "loading") ? (
          <div
            className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            {t("conversation.workspace.loadingHistoryPane")}
          </div>
        ) : store.conversationId === null &&
          store.history.status === "error" ? (
          <Alert variant="destructive" className="m-auto max-w-md">
            <AlertDescription className="flex flex-col gap-4 text-center">
              <p>{commandErrorMessage(store.history.error.code)}</p>
              {store.history.error.retryable && (
                <Button onClick={() => void store.retryHistory(client)}>
                  {t("conversation.workspace.retryHistory")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : store.conversationId === null ? null : isPanoramaOpen ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {store.rootNodeId !== null && isProjectionValid ? (
              <ConversationPanorama
                rootNodeId={store.rootNodeId}
                nodesById={store.nodesById}
                activePathIds={activePathIds}
                highlightedPathIds={highlightedPathIds}
                onSelect={selectNode}
                onOpenInConversation={(nodeId) => {
                  // Open the branch through the node (newest leaf + reveal) so
                  // the conversation pane lands on the double-clicked message.
                  selectBranchAtNode(nodeId)
                  setIsPanoramaOpen(false)
                }}
                onCreateBranch={canMutate ? handlePanoramaCreateBranch : null}
                onDeleteNode={canMutate ? handlePanoramaDeleteNode : null}
              />
            ) : projectionError !== null ? (
              <div className="p-6 text-sm text-destructive" role="alert">
                {commandErrorMessage(projectionError.code)}
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                {t("conversation.workspace.noConversationLoaded")}
              </div>
            )}
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <WorkspaceStreamingLayer
              path={renderedMessagePath}
              pendingBranchOriginId={pendingBranchOriginId}
              status={projectionError === null ? store.status : "error"}
              error={projectionError ?? store.error}
              onRetry={handleRetry}
              canBranch={canCreateBranch}
              canEdit={canEditAsBranch}
              onCreateBranch={handleStartBranch}
              onEditAsBranch={handleEditAsBranch}
              onExportMessage={handleExportMessage}
              onRegenerate={controller.generate}
              branchSwitcherFor={branchSwitcherFor}
              reveal={store.reveal}
              canMutate={canMutate}
              canEditDraft={canEditDraft}
              isArchived={store.isArchived}
              activeNodeId={store.activeNodeId}
              nodesById={store.nodesById}
              activeBranchComposerTarget={activeBranchComposerTarget}
              canAppend={canAppend}
              composerAction={composerAction}
              composerRef={composerRef}
              onComposerSubmit={handleComposerSubmit}
              onConfigureProvider={handleConfigureProvider}
              onGenerate={controller.generate}
              onRegenerateAssistant={handleRegenerateAssistant}
            />
          </div>
        )}
      </div>

      <AlertDialog
        open={pendingArchiveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingArchiveId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("conversation.workspace.archiveConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingArchiveSummary !== null && (
                <span className="block font-medium text-foreground">
                  {pendingArchiveSummary.title}
                </span>
              )}
              <span className="block">
                {t("conversation.workspace.archiveConfirmBody")}
              </span>
              {pendingArchiveInterrupts && (
                <span className="block">
                  {t("conversation.workspace.archiveConfirmInterrupts")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingArchiveId(null)}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingArchiveId
                if (target !== null) {
                  void confirmArchiveConversation(target)
                }
              }}
            >
              {t("conversation.workspace.archiveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pendingRenameSummary !== null && (
        <RenameConversationDialog
          key={pendingRenameSummary.id}
          currentTitle={pendingRenameSummary.title}
          onClose={() => setPendingRenameId(null)}
          onRename={(title) =>
            useConversationStore
              .getState()
              .renameConversation(client, pendingRenameSummary.id, title)
          }
        />
      )}

      <ConfirmDialog
        open={pendingDeleteNodeId !== null}
        title={t("conversation.panorama.deleteNodeConfirmTitle")}
        description={t("conversation.panorama.deleteNodeConfirmDescription")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("conversation.panorama.deleteNode")}
        destructive
        onCancel={() => setPendingDeleteNodeId(null)}
        onConfirm={() => {
          const target = pendingDeleteNodeId
          setPendingDeleteNodeId(null)
          if (target !== null) {
            void useConversationStore
              .getState()
              .deleteNodeSubtree(client, target)
          }
        }}
      />

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("conversation.workspace.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteSummary !== null && (
                <span className="block font-medium text-foreground">
                  {pendingDeleteSummary.title}
                </span>
              )}
              <span className="block">
                {t("conversation.workspace.deleteConfirmBody")}
              </span>
              {pendingDeleteInterrupts && (
                <span className="block">
                  {t("conversation.workspace.deleteConfirmInterrupts")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDeleteId
                setPendingDeleteId(null)
                if (target !== null) {
                  void controller.deleteConversation(target)
                }
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
