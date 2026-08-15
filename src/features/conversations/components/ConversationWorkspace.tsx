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
import { useWorkspaceGenerationController } from "../hooks/useWorkspaceGenerationController"
import {
  isGenerationActive,
  selectActivePath,
  type ConversationTreeState,
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
    state.generation.phase !== "idle"
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
  const providerPhase = useProviderProfileStore((state) => state.phase)
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
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)

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
        return null
    }
  })()

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
    if (
      !canMutate ||
      store.activeNodeId === null ||
      transientGeneration !== null
    ) {
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
    if (useProviderProfileStore.getState().phase !== "ready") return

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

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <aside
        id="conversation-tree-sidebar"
        aria-label="会话树侧栏"
        className={`flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-300 motion-reduce:transition-none ${
          isSidebarOpen ? "w-64 md:w-80" : "w-0 overflow-hidden border-none"
        }`}
        aria-hidden={!isSidebarOpen}
        inert={!isSidebarOpen}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3 text-sm font-semibold">
          <span className="font-bold tracking-tight">Canopy</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="新建会话"
                  title="新建会话"
                  disabled={
                    store.status === "loading" ||
                    isGenerationActive(store.generation)
                  }
                  onClick={store.enterConversationCreation}
                >
                  <SquarePen className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>新建会话</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex h-8 shrink-0 items-center px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          历史记录
        </div>
        <div className="max-h-64 shrink-0 overflow-y-auto px-2 pb-2">
          {store.history.summaries.length > 0 && (
            <ul aria-label="会话历史记录" className="flex flex-col gap-1">
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
                              已归档
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
                正在加载历史记录…
              </p>
            )}
          {store.history.status === "empty" && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              暂无已保存的会话。
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
                    重试加载历史记录
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <Separator />
        <div className="flex h-8 shrink-0 items-center px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          会话树
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
              尚未加载会话。
            </div>
          )}
        </div>
        <Separator />
        <footer className="shrink-0 p-2">
          <GlobalSettingsDialog
            client={providerClient}
            readOnly={!isBlankConversation && store.isArchived}
            generationActive={isGenerationActive(store.generation)}
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
              title={isSidebarOpen ? "收起侧栏" : "展开侧栏"}
              aria-label={isSidebarOpen ? "收起侧栏" : "展开侧栏"}
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
                      aria-label="新建会话"
                      title="新建会话"
                      disabled={
                        store.status === "loading" ||
                        isGenerationActive(store.generation)
                      }
                      onClick={store.enterConversationCreation}
                    >
                      <SquarePen className="size-4" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>新建会话</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!isBlankConversation && store.isArchived && (
              <Badge variant="secondary">
                <Archive data-icon="inline-start" />
                已归档 — 只读
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {canMutate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void controller.archiveConversation()}
              >
                <Archive data-icon="inline-start" />
                归档
              </Button>
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
                开始新会话
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                在下方输入第一条消息。发送后才会保存。
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
                      关闭
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </section>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
              <Composer
                onSubmit={controller.createConversation}
                inputDisabled={
                  store.status === "loading" || controller.mutationLocked
                }
                action={{
                  kind: "send",
                  disabled:
                    store.status === "loading" || controller.mutationLocked,
                }}
                placeholder="输入第一条消息…"
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
            正在加载会话历史记录…
          </div>
        ) : store.conversationId === null &&
          store.history.status === "error" ? (
          <Alert variant="destructive" className="m-auto max-w-md">
            <AlertDescription className="flex flex-col gap-4 text-center">
              <p>{store.history.error.message}</p>
              {store.history.error.retryable && (
                <Button onClick={() => void store.retryHistory(client)}>
                  重试加载历史记录
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
              transientGeneration={transientGeneration}
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
                    ? "会话已归档，无法修改。"
                    : canAppend
                      ? "输入下一条用户消息…"
                      : "可输入草稿；当前路径暂无法发送。"
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
