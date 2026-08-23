import * as React from "react"
import { Archive, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Composer, type ComposerAction } from "./Composer"
import {
  ConversationPane,
  type AssistantRegenerationAction,
  type UserGenerationAction,
} from "./ConversationPane"
import { OutlineTree } from "./OutlineTree"
import { useConversationTitleUpdates } from "../hooks/useConversationTitleUpdates"
import { useWorkspaceGenerationController } from "../hooks/useWorkspaceGenerationController"
import {
  isRunActive,
  selectActivePath,
  selectActiveRunIds,
  type ConversationTreeState,
  useConversationStore,
} from "../store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SettingsDialog } from "@/features/settings/components"
import { ConversationProviderPicker } from "./ConversationProviderPicker"
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
  const providerPhase = useProviderStore((state) => state.phase)
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
      expandedIds: state.expandedIds,
      status: state.status,
      error: state.error,
      generationRuns: state.generationRuns,
      history: state.history,
      toggleExpanded: state.toggleExpanded,
      clearError: state.clearError,
      retryHistory: state.retryHistory,
      selectConversation: state.selectConversation,
      enterConversationCreation: state.enterConversationCreation,
    })),
  )
  const initializeHistory = useConversationStore(
    (state) => state.initializeHistory,
  )
  const pathProjection = useConversationStore(useShallow(selectActivePath))
  const controller = useWorkspaceGenerationController({
    conversationClient: client,
    providerClient,
  })
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [pendingArchiveId, setPendingArchiveId] = React.useState<string | null>(
    null,
  )

  React.useEffect(() => {
    void loadProviders(providerClient)
  }, [loadProviders, providerClient])

  React.useEffect(() => {
    void initializeHistory(client)
  }, [client, initializeHistory])

  const projectionError =
    pathProjection.kind === "error" ? pathProjection.error : null
  const visiblePath = pathProjection.kind === "ready" ? pathProjection.path : []
  const isProjectionValid = pathProjection.kind !== "error"
  const isBlankConversation =
    store.isCreatingConversation ||
    (store.conversationId === null && store.history.status === "empty")
  const currentRun =
    store.conversationId === null
      ? undefined
      : store.generationRuns[store.conversationId]
  const activeRunIds = selectActiveRunIds({
    generationRuns: store.generationRuns,
  })
  const transientGeneration = (() => {
    if (currentRun === undefined) return null
    switch (currentRun.phase) {
      case "starting":
        return { phase: "starting" as const }
      case "streaming":
        return {
          phase: "streaming" as const,
          content: currentRun.content,
          thinking: currentRun.thinking,
        }
      case "failed":
        return currentRun.failureKind === "generation"
          ? {
              phase: "failed" as const,
              failureKind: "generation" as const,
            }
          : {
              phase: "failed" as const,
              failureKind: "persistence" as const,
              content: currentRun.content,
            }
      case "cancelled":
        return {
          phase: "cancelled" as const,
          content: currentRun.content,
        }
    }
  })()
  // The transient bubble belongs under the run's parent. When the user is
  // browsing another branch, the run keeps streaming in the background of
  // this conversation and the composer keeps the cancel affordance.
  const transientBubbleVisible =
    transientGeneration !== null &&
    pathProjection.kind === "ready" &&
    pathProjection.path.at(-1)?.id === currentRun?.parentNodeId

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

  const userGenerationAction: UserGenerationAction | null = (() => {
    if (!canMutate || store.activeNodeId === null || currentRun !== undefined) {
      return null
    }
    const activeNode = store.nodesById[store.activeNodeId]
    if (activeNode?.role !== "user" || activeNode.childIds.length > 0) {
      return null
    }
    if (providerPhase === "ready") {
      return {
        kind: "generate",
        onSelect: controller.generate,
      }
    }
    return {
      kind: "configure-provider",
      onSelect: () => setIsSettingsOpen(true),
    }
  })()

  const composerAction: ComposerAction = controller.canCancel
    ? { kind: "cancel", onCancel: controller.cancel }
    : { kind: "send", disabled: !canAppend }

  const canCreateBranch = (nodeId: string) => {
    if (!canMutate) return false
    const node = store.nodesById[nodeId]
    return node?.role === "assistant" && node.childIds.length > 0
  }

  const canEditAsBranch = (nodeId: string) => {
    if (!canMutate) return false
    const node = store.fullNodes[nodeId]
    const parent =
      node?.parentId === undefined ? undefined : store.fullNodes[node.parentId]
    return node?.role === "user" && parent?.role === "assistant"
  }

  const handleRegenerateAssistant = (assistantNodeId: string) => {
    if (useProviderStore.getState().phase !== "ready") return

    const target = resolveAssistantRegenerationTarget(
      useConversationStore.getState(),
    )
    if (target?.assistantNodeId !== assistantNodeId) return

    controller.selectNode(target.parentUserNodeId)
    const selectedState = useConversationStore.getState()
    if (
      selectedState.conversationId !== target.conversationId ||
      selectedState.activeNodeId !== target.parentUserNodeId
    ) {
      return
    }
    controller.generate()
  }

  const assistantRegenerationTarget =
    providerPhase === "ready" ? resolveAssistantRegenerationTarget(store) : null
  const assistantRegenerationAction: AssistantRegenerationAction | null =
    assistantRegenerationTarget === null
      ? null
      : {
          assistantNodeId: assistantRegenerationTarget.assistantNodeId,
          onSelect: handleRegenerateAssistant,
        }

  const handleRetry = () => {
    if (store.conversationId === null) store.clearError()
    else void controller.loadConversation(store.conversationId)
  }

  const pendingArchiveSummary =
    pendingArchiveId === null
      ? null
      : (store.history.summaries.find((item) => item.id === pendingArchiveId) ??
        null)
  // Re-evaluated from the live store on every render while the dialog is
  // open, so the warning reflects the confirm-time run state — including a
  // background run on a non-current conversation.
  const pendingArchiveInterrupts =
    pendingArchiveId !== null && activeRunIds.has(pendingArchiveId)

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <aside
        id="conversation-tree-sidebar"
        aria-label={t("conversation.workspace.sidebar")}
        className={`flex shrink-0 flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground transition-[width] duration-300 motion-reduce:transition-none ${
          isSidebarOpen ? "w-64 md:w-80" : "w-0 overflow-hidden border-none"
        }`}
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3 text-sm font-semibold">
          <span className="font-bold tracking-tight">Canopy</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("conversation.workspace.newConversation")}
                  title={t("conversation.workspace.newConversation")}
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
          </TooltipProvider>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          <section>
            <div className="sticky top-0 z-10 bg-sidebar px-2.5 pb-1 pt-3 text-sm font-medium text-muted-foreground/70">
              {t("conversation.workspace.history")}
            </div>
            {store.history.summaries.length > 0 && (
              <ul
                aria-label={t("conversation.workspace.historyList")}
                className="flex flex-col gap-1"
              >
                {store.history.summaries.map((summary) => {
                  const isCurrent =
                    !isBlankConversation && store.conversationId === summary.id
                  const isGenerating = activeRunIds.has(summary.id)
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
                          {isGenerating && (
                            <Spinner
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label={t(
                                "conversation.workspace.generatingReply",
                              )}
                            />
                          )}
                          {summary.isArchived && (
                            <Badge className="shrink-0" variant="secondary">
                              {t("conversation.workspace.archivedBadge")}
                            </Badge>
                          )}
                        </button>
                        {!summary.isArchived && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute inset-y-0 right-1 my-auto size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-foreground"
                            aria-label={t("conversation.workspace.archive")}
                            title={t("conversation.workspace.archive")}
                            onClick={() => setPendingArchiveId(summary.id)}
                          >
                            <Archive className="size-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {store.history.status === "loading" &&
              store.history.summaries.length === 0 && (
                <p className="px-2.5 py-3 text-sm text-muted-foreground">
                  {t("conversation.workspace.loadingHistory")}
                </p>
              )}
            {store.history.status === "empty" && (
              <p className="px-2.5 py-3 text-sm text-muted-foreground">
                {t("conversation.workspace.emptyHistory")}
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
          <section>
            <div className="sticky top-0 z-10 bg-sidebar px-2.5 pb-1 pt-6 text-sm font-medium text-muted-foreground/70">
              {t("conversation.workspace.treeSection")}
            </div>
            <div>
              {store.rootNodeId !== null && isProjectionValid ? (
                <OutlineTree
                  rootNodeId={store.rootNodeId}
                  activeNodeId={store.activeNodeId ?? ""}
                  nodesById={store.nodesById}
                  expandedIds={store.expandedIds}
                  onToggle={store.toggleExpanded}
                  onSelect={controller.selectNode}
                />
              ) : projectionError !== null ? (
                <div
                  className="px-2.5 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {commandErrorMessage(projectionError.code)}
                </div>
              ) : (
                <div className="px-2.5 py-3 text-sm text-muted-foreground">
                  {t("conversation.workspace.noConversationLoaded")}
                </div>
              )}
            </div>
          </section>
        </div>
        <footer className="shrink-0 p-2">
          <SettingsDialog
            client={providerClient}
            readOnly={!isBlankConversation && store.isArchived}
            open={isSettingsOpen}
            onOpenChange={setIsSettingsOpen}
          />
        </footer>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <header className="z-10 flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
              title={
                isSidebarOpen
                  ? t("conversation.workspace.collapseSidebar")
                  : t("conversation.workspace.expandSidebar")
              }
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
            {!isSidebarOpen && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t("conversation.workspace.newConversation")}
                      title={t("conversation.workspace.newConversation")}
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
              </TooltipProvider>
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
                onManageProviders={() => setIsSettingsOpen(true)}
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
        ) : store.conversationId === null ? null : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <ConversationPane
              path={visiblePath}
              status={projectionError === null ? store.status : "error"}
              error={projectionError ?? store.error}
              onRetry={handleRetry}
              canBranch={canCreateBranch}
              canEdit={canEditAsBranch}
              onCreateBranch={(nodeId, content) =>
                void controller.createBranch(nodeId, content)
              }
              onEditAsBranch={(nodeId, content) =>
                void controller.editNodeAsBranch(nodeId, content)
              }
              transientGeneration={
                transientBubbleVisible ? transientGeneration : null
              }
              onRegenerate={controller.generate}
              userGenerationAction={userGenerationAction}
              assistantRegenerationAction={assistantRegenerationAction}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
              <Composer
                onSubmit={(content) => void controller.appendNode(content)}
                inputDisabled={!canEditDraft}
                action={composerAction}
                placeholder={
                  store.isArchived
                    ? t("conversation.workspace.placeholderArchived")
                    : isRunActive(currentRun) && !transientBubbleVisible
                      ? t("conversation.workspace.placeholderGenerating")
                      : canAppend
                        ? t("conversation.workspace.placeholderNextMessage")
                        : t("conversation.workspace.placeholderDraftOnly")
                }
              />
            </div>
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
                setPendingArchiveId(null)
                if (target !== null) {
                  void controller.archiveConversation(target)
                }
              }}
            >
              {t("conversation.workspace.archiveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
