import * as React from "react"
import type { PathMessageView, UiError } from "../types"
import { MessageNode } from "./MessageNode"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  transientGeneration: TransientGenerationView | null
  onRetryReconciliation: () => void
}

export type TransientGenerationView = {
  phase:
    | "starting"
    | "streaming"
    | "committing"
    | "reconciling"
    | "failed"
    | "cancelled"
  content: string
  status: string
  retryable: boolean
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
  transientGeneration,
  onRetryReconciliation,
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
  }, [path, status, transientGeneration?.content, transientGeneration?.phase])

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
        {transientGeneration !== null &&
          (transientGeneration.phase === "failed" ||
          transientGeneration.phase === "cancelled" ? (
            <Alert
              className="my-4"
              variant={
                transientGeneration.phase === "failed"
                  ? "destructive"
                  : "default"
              }
            >
              <AlertTitle>
                {transientGeneration.phase === "failed"
                  ? "Generation failed"
                  : "Generation cancelled"}
              </AlertTitle>
              <AlertDescription>{transientGeneration.status}</AlertDescription>
            </Alert>
          ) : (
            <article
              className="my-4 rounded-xl border bg-card p-4 shadow-sm"
              aria-label="Transient assistant response"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Assistant</span>
                <Badge variant="outline">Not saved</Badge>
              </div>
              {transientGeneration.content.length > 0 ? (
                <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {transientGeneration.content}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Waiting for the first response…
                </p>
              )}
              <div
                className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <span>{transientGeneration.status}</span>
                {transientGeneration.phase === "reconciling" &&
                  transientGeneration.retryable && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={onRetryReconciliation}
                    >
                      Retry local reload
                    </Button>
                  )}
              </div>
            </article>
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
