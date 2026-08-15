import * as React from "react"
import type { PathMessageView, UiError } from "../types"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { MessageBubble } from "./MessageBubble"
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
  transientGeneration: TransientGenerationView | null
  onRegenerate: () => void
  onRetryReconciliation: () => void
}

export type TransientGenerationView =
  | { phase: "starting" }
  | { phase: "streaming" | "committing"; content: string }
  | {
      phase: "reconciling"
      content: string
      needsUserAction: boolean
    }
  | {
      phase: "failed"
      failureKind: "generation"
    }
  | {
      phase: "failed"
      failureKind: "persistence"
      content: string
    }
  | { phase: "cancelled"; content: string }

type TransientGenerationMessageProps = {
  generation: TransientGenerationView
  onRegenerate: () => void
  onRetryReconciliation: () => void
}

function TransientGenerationMessage({
  generation,
  onRegenerate,
  onRetryReconciliation,
}: TransientGenerationMessageProps) {
  const content = "content" in generation ? generation.content : ""
  let status: string | null = null
  let action: React.ReactNode = null
  const statusInContent = generation.phase === "starting"

  if (generation.phase === "starting") {
    status = "正在思考"
  } else if (generation.phase === "reconciling") {
    status = "正在恢复这条回复…"
    if (generation.needsUserAction) {
      action = (
        <Button variant="ghost" size="xs" onClick={onRetryReconciliation}>
          重试恢复
        </Button>
      )
    }
  } else if (generation.phase === "failed") {
    status =
      generation.failureKind === "generation" ? "回复失败" : "这条回复未能保存"
    action = (
      <Button variant="ghost" size="xs" onClick={onRegenerate}>
        重新生成
      </Button>
    )
  } else if (generation.phase === "cancelled") {
    status = "回复已停止"
  }

  return (
    <MessageBubble
      role="assistant"
      footer={
        status === null || statusInContent ? null : (
          <div
            className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <span>{status}</span>
            {action}
          </div>
        )
      }
    >
      {content.length > 0 ? (
        <AssistantMarkdown
          content={content}
          isStreaming={generation.phase === "streaming"}
        />
      ) : statusInContent && status !== null ? (
        <span
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {status}
        </span>
      ) : null}
    </MessageBubble>
  )
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
  onRegenerate,
  onRetryReconciliation,
}: ConversationPaneProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const transientContent =
    transientGeneration !== null && "content" in transientGeneration
      ? transientGeneration.content
      : ""

  React.useEffect(() => {
    if (status === "ready" || status === "streaming") {
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
      bottomRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? "auto" : "smooth",
      })
    }
  }, [path, status, transientContent, transientGeneration?.phase])

  if (status === "loading" && path.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <Loader2
          className="mb-4 size-8 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p>正在加载会话…</p>
      </div>
    )
  }

  return (
    <div
      data-testid="conversation-pane"
      className="relative flex h-full flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8 [contain:paint]"
    >
      {error && (
        <div
          className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive shadow-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="font-medium text-sm">出错了</h3>
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
              重试
            </Button>
          )}
        </div>
      )}

      {path.length === 0 && status !== "loading" && !error && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p>尚未选择消息。</p>
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
        {transientGeneration !== null && (
          <TransientGenerationMessage
            generation={transientGeneration}
            onRegenerate={onRegenerate}
            onRetryReconciliation={onRetryReconciliation}
          />
        )}
        {status === "loading" && path.length > 0 && (
          <div className="flex justify-center p-4" aria-label="正在保存消息">
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
