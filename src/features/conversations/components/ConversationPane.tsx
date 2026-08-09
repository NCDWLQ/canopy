import * as React from "react"
import type { PathMessageView, UiError } from "../types"
import { MessageNode } from "./MessageNode"
import { Button } from "@/components/ui/button"
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react"

export type ConversationPaneProps = {
  path: readonly PathMessageView[]
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error?: UiError | null
  onRetry?: () => void
  canBranch: (nodeId: string) => boolean
  canEdit: (nodeId: string) => boolean
  onCreateBranch: (nodeId: string, content: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
}

export function ConversationPane({
  path,
  status,
  error,
  onRetry,
  canBranch,
  canEdit,
  onCreateBranch,
  onEditAsBranch,
}: ConversationPaneProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (status === "ready" || status === "streaming") {
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
      bottomRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? "auto" : "smooth",
      })
    }
  }, [path, status])

  if (status === "loading" && path.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <Loader2
          className="mb-4 size-8 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p>Loading conversation...</p>
      </div>
    )
  }

  return (
    <div
      data-testid="conversation-pane"
      className="relative flex h-full flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8"
    >
      {error && (
        <div
          className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive shadow-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="font-medium text-sm">Error: {error.code}</h3>
            <p className="text-sm mt-1 opacity-90">{error.message}</p>
          </div>
          {error.retryable && onRetry !== undefined && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="shrink-0"
            >
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      )}

      {path.length === 0 && status !== "loading" && !error && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p>No messages selected.</p>
        </div>
      )}

      <div className="mx-auto w-full max-w-4xl flex-1 pb-4" role="log">
        {path.map((msg) => (
          <MessageNode
            key={msg.id}
            message={msg}
            canBranch={canBranch(msg.id)}
            canEdit={canEdit(msg.id)}
            onCreateBranch={onCreateBranch}
            onEditAsBranch={onEditAsBranch}
          />
        ))}
        {status === "loading" && path.length > 0 && (
          <div className="flex justify-center p-4" aria-label="Saving message">
            <Loader2
              className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden="true"
            />
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  )
}
