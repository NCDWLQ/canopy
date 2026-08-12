import * as React from "react"
import {
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Square,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Composer } from "./Composer"
import { ConversationPane } from "./ConversationPane"
import { OutlineTree } from "./OutlineTree"
import { useWorkspaceGenerationController } from "../hooks/useWorkspaceGenerationController"
import {
  isGenerationActive,
  selectActivePath,
  useConversationStore,
} from "../store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { GlobalSettingsDialog } from "@/features/providers/components"
import { useProviderProfileStore } from "@/features/providers/store"
import {
  createConversationClient,
  createProviderClient,
  type ConversationClient,
  type ProviderClient,
} from "@/lib/tauri"

export type ConversationWorkspaceProps = {
  conversationClient?: ConversationClient
  providerClient?: ProviderClient
}

export function ConversationWorkspace({
  conversationClient: injectedConversationClient,
  providerClient: injectedProviderClient,
}: ConversationWorkspaceProps = {}) {
  const client = React.useMemo(
    () => injectedConversationClient ?? createConversationClient(),
    [injectedConversationClient],
  )
  const providerClient = React.useMemo(
    () => injectedProviderClient ?? createProviderClient(),
    [injectedProviderClient],
  )
  const loadProviderProfile = useProviderProfileStore(
    (state) => state.loadProfile,
  )
  const store = useConversationStore(
    useShallow((state) => ({
      conversationId: state.conversationId,
      isCreatingConversation: state.isCreatingConversation,
      isArchived: state.isArchived,
      rootNodeId: state.rootNodeId,
      activeNodeId: state.activeNodeId,
      nodesById: state.nodesById,
      fullNodes: state.fullNodes,
      expandedIds: state.expandedIds,
      status: state.status,
      error: state.error,
      generation: state.generation,
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

  React.useEffect(() => {
    void loadProviderProfile(providerClient)
  }, [loadProviderProfile, providerClient])

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
  const transientGeneration = (() => {
    const generation = store.generation
    switch (generation.phase) {
      case "starting":
        return { phase: "starting" as const }
      case "streaming":
        return {
          phase: "streaming" as const,
          content: generation.content,
        }
      case "committing":
        return {
          phase: "committing" as const,
          content: generation.content,
        }
      case "reconciling":
        return {
          phase: "reconciling" as const,
          content: generation.content,
          needsUserAction: generation.needsUserAction,
        }
      case "failed":
        return generation.failureKind === "generation"
          ? {
              phase: "failed" as const,
              failureKind: "generation" as const,
            }
          : {
              phase: "failed" as const,
              failureKind: "persistence" as const,
              content: generation.content,
            }
      case "cancelled":
        return {
          phase: "cancelled" as const,
          content: generation.content,
        }
      case "idle":
      case "completed":
        return null
    }
  })()
  const canMutate =
    !isBlankConversation &&
    store.conversationId !== null &&
    !store.isArchived &&
    store.status === "ready" &&
    isProjectionValid &&
    !controller.mutationLocked

  const canAppend = (() => {
    if (!canMutate || store.activeNodeId === null) return false
    const node = store.nodesById[store.activeNodeId]
    return node?.role === "assistant" && node.childIds.length === 0
  })()

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

  const handleRetry = () => {
    if (store.conversationId === null) store.clearError()
    else void controller.loadConversation(store.conversationId)
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <aside
        id="conversation-tree-sidebar"
        aria-label="Conversation tree sidebar"
        className={`flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-300 motion-reduce:transition-none ${
          isSidebarOpen ? "w-64 md:w-80" : "w-0 overflow-hidden border-none"
        }`}
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2 text-sm font-semibold">
          <span>History</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="New conversation"
            disabled={
              store.status === "loading" || isGenerationActive(store.generation)
            }
            onClick={store.enterConversationCreation}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            New conversation
          </Button>
        </div>
        <div className="max-h-64 shrink-0 overflow-y-auto p-2">
          {store.history.summaries.length > 0 && (
            <ul
              aria-label="Conversation history"
              className="flex flex-col gap-1"
            >
              {store.history.summaries.map((summary) => (
                <li key={summary.id}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto w-full min-w-0 justify-between px-2 py-2 text-left"
                          aria-current={
                            !isBlankConversation &&
                            store.conversationId === summary.id
                              ? "page"
                              : undefined
                          }
                          disabled={
                            store.status === "loading" ||
                            isGenerationActive(store.generation)
                          }
                          onClick={() =>
                            void store.selectConversation(client, summary.id)
                          }
                        >
                          <span className="min-w-0 truncate">
                            {summary.title}
                          </span>
                          {summary.isArchived && (
                            <Badge className="shrink-0" variant="secondary">
                              Archived
                            </Badge>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{summary.title}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </li>
              ))}
            </ul>
          )}
          {store.history.status === "loading" &&
            store.history.summaries.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Loading history…
              </p>
            )}
          {store.history.status === "empty" && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No saved conversations.
            </p>
          )}
          {store.history.status === "error" && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-col gap-2">
                <p>{store.history.error.message}</p>
                {store.history.error.retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void store.retryHistory(client)}
                  >
                    Retry history
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <Separator />
        <div className="flex h-10 shrink-0 items-center px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conversation tree
        </div>
        <div className="flex-1 overflow-hidden pb-2">
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
            <div className="p-4 text-sm text-destructive" role="alert">
              {projectionError.message}
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              No conversation loaded.
            </div>
          )}
        </div>
        <Separator />
        <footer className="shrink-0 p-2">
          <GlobalSettingsDialog
            client={providerClient}
            readOnly={!isBlankConversation && store.isArchived}
            generationActive={isGenerationActive(store.generation)}
          />
        </footer>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <header className="z-10 flex h-12 shrink-0 items-center justify-between border-b bg-background/90 px-4 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
              title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
              aria-expanded={isSidebarOpen}
              aria-controls="conversation-tree-sidebar"
            >
              {isSidebarOpen ? (
                <PanelLeftClose aria-hidden="true" />
              ) : (
                <PanelLeftOpen aria-hidden="true" />
              )}
            </Button>
            {!isBlankConversation && store.isArchived && (
              <Badge variant="secondary">
                <Archive data-icon="inline-start" />
                Archived — read only
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isBlankConversation &&
              store.conversationId !== null &&
              !store.isArchived &&
              (controller.canCancel ? (
                <Button variant="outline" size="sm" onClick={controller.cancel}>
                  <Square data-icon="inline-start" />
                  Cancel generation
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={controller.generate}
                  disabled={!controller.canGenerate}
                  title={controller.unavailableReason ?? "Generate response"}
                >
                  <Sparkles data-icon="inline-start" />
                  Generate
                </Button>
              ))}
            {canMutate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void controller.archiveConversation()}
              >
                <Archive data-icon="inline-start" />
                Archive
              </Button>
            )}
          </div>
        </header>

        {isBlankConversation ? (
          <>
            <section
              data-testid="blank-conversation-pane"
              className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center"
              aria-labelledby="blank-conversation-title"
            >
              <h1
                id="blank-conversation-title"
                className="text-2xl font-semibold"
              >
                Start a conversation
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                Write your first message below. It will be saved only when you
                send it.
              </p>
              {store.error !== null && (
                <Alert variant="destructive" className="max-w-md text-left">
                  <AlertDescription className="flex flex-col gap-3">
                    <p>{store.error.message}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={store.clearError}
                    >
                      Dismiss
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <Composer
              onSubmit={controller.createConversation}
              disabled={store.status === "loading" || controller.mutationLocked}
              placeholder="Write your first message…"
            />
          </>
        ) : store.conversationId === null &&
          (store.history.status === "idle" ||
            store.history.status === "loading") ? (
          <div
            className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            Loading conversation history…
          </div>
        ) : store.conversationId === null &&
          store.history.status === "error" ? (
          <Alert variant="destructive" className="m-auto max-w-md">
            <AlertDescription className="flex flex-col gap-4 text-center">
              <p>{store.history.error.message}</p>
              {store.history.error.retryable && (
                <Button onClick={() => void store.retryHistory(client)}>
                  Retry loading history
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : store.conversationId === null ? null : (
          <>
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
              transientGeneration={transientGeneration}
              onRegenerate={controller.generate}
              onRetryReconciliation={controller.retryReconciliation}
            />

            <Composer
              onSubmit={(content) => void controller.appendNode(content)}
              disabled={!canAppend}
              placeholder={
                store.isArchived
                  ? "Conversation is archived and cannot be modified."
                  : canAppend
                    ? "Write the next user message…"
                    : "Assistant generation is unavailable; select an assistant leaf to continue."
              }
            />
          </>
        )}
      </div>
    </div>
  )
}
