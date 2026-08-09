import * as React from "react"
import { Archive, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { Composer } from "./Composer"
import { ConversationPane } from "./ConversationPane"
import { NewConversationForm } from "./NewConversationForm"
import { OutlineTree } from "./OutlineTree"
import { selectActivePath, useConversationStore } from "../store"
import { Button } from "@/components/ui/button"
import { createConversationClient } from "@/lib/tauri"

export function ConversationWorkspace() {
  const client = React.useMemo(() => createConversationClient(), [])
  const store = useConversationStore(
    useShallow((state) => ({
      conversationId: state.conversationId,
      isArchived: state.isArchived,
      rootNodeId: state.rootNodeId,
      activeNodeId: state.activeNodeId,
      nodesById: state.nodesById,
      fullNodes: state.fullNodes,
      expandedIds: state.expandedIds,
      status: state.status,
      error: state.error,
      loadConversation: state.loadConversation,
      selectNode: state.selectNode,
      toggleExpanded: state.toggleExpanded,
      createConversation: state.createConversation,
      appendNode: state.appendNode,
      createBranch: state.createBranch,
      editNodeAsBranch: state.editNodeAsBranch,
      archiveConversation: state.archiveConversation,
      clearError: state.clearError,
    })),
  )
  const pathProjection = useConversationStore(useShallow(selectActivePath))
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true)

  const projectionError =
    pathProjection.kind === "error" ? pathProjection.error : null
  const visiblePath = pathProjection.kind === "ready" ? pathProjection.path : []
  const isProjectionValid = pathProjection.kind !== "error"
  const canMutate =
    store.conversationId !== null &&
    !store.isArchived &&
    store.status === "ready" &&
    isProjectionValid

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
    else void store.loadConversation(client, store.conversationId)
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
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4 text-sm font-semibold">
          <span>Conversation tree</span>
        </div>
        <div className="flex-1 overflow-hidden py-2">
          {store.rootNodeId !== null && isProjectionValid ? (
            <OutlineTree
              rootNodeId={store.rootNodeId}
              activeNodeId={store.activeNodeId ?? ""}
              nodesById={store.nodesById}
              expandedIds={store.expandedIds}
              onToggle={store.toggleExpanded}
              onSelect={store.selectNode}
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
            {store.isArchived && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                <Archive aria-hidden="true" />
                Archived — read only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {store.conversationId !== null && !store.isArchived && (
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Assistant generation is not available in this build"
              >
                <Sparkles aria-hidden="true" />
                Generate unavailable
              </Button>
            )}
            {canMutate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void store.archiveConversation(client)}
              >
                <Archive aria-hidden="true" />
                Archive
              </Button>
            )}
          </div>
        </header>

        {store.conversationId === null ? (
          <NewConversationForm
            disabled={store.status === "loading"}
            error={store.error}
            onDismissError={store.clearError}
            onSubmit={(title, content) =>
              void store.createConversation(client, title, content)
            }
          />
        ) : (
          <>
            <ConversationPane
              path={visiblePath}
              status={projectionError === null ? store.status : "error"}
              error={projectionError ?? store.error}
              onRetry={handleRetry}
              canBranch={canCreateBranch}
              canEdit={canEditAsBranch}
              onCreateBranch={(nodeId, content) =>
                void store.createBranch(client, nodeId, content)
              }
              onEditAsBranch={(nodeId, content) =>
                void store.editNodeAsBranch(client, nodeId, content)
              }
            />

            <Composer
              onSubmit={(content) => void store.appendNode(client, content)}
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
