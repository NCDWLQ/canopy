import * as React from "react"
import type { PathMessageView, SearchReveal, UiError } from "../types"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { MessageBubble } from "./MessageBubble"
import { ThinkingBlock } from "./ThinkingBlock"
import {
  MessageNode,
  type AssistantRegenerationAction,
  type UserGenerationAction,
} from "./MessageNode"
import { Button } from "@/components/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { AlertCircle, GitBranch, RefreshCw } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"

export type { AssistantRegenerationAction, UserGenerationAction }

export type ConversationPaneProps = {
  path: readonly PathMessageView[]
  status: "idle" | "loading" | "ready" | "streaming" | "error"
  error?: UiError | null
  onRetry?: () => void
  canBranch: (nodeId: string) => boolean
  canEdit: (nodeId: string) => boolean
  onCreateBranch: (nodeId: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
  onExportMessage?: (nodeId: string) => void
  exportDisabled?: boolean
  transientGeneration: TransientGenerationView | null
  onRegenerate: () => void
  userGenerationAction?: UserGenerationAction | null
  assistantRegenerationAction?: AssistantRegenerationAction | null
  pendingBranchOriginId?: string | null
  // Active search/mind-map reveal: scrolls the hit message into view
  // anchored at its start and highlights matches until the next navigation
  // clears it.
  reveal?: SearchReveal | null
}

export type TransientGenerationView =
  | { phase: "starting" }
  | { phase: "streaming"; content: string; thinking: string }
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
}

function TransientGenerationMessage({
  generation,
  onRegenerate,
}: TransientGenerationMessageProps) {
  const { t } = useTranslation()
  const content = "content" in generation ? generation.content : ""
  const thinking = "thinking" in generation ? (generation.thinking ?? "") : ""
  let status: string | null = null
  let action: React.ReactNode = null
  const statusInContent = generation.phase === "starting"

  if (generation.phase === "starting") {
    status = t("conversation.pane.thinking")
  } else if (generation.phase === "failed") {
    status =
      generation.failureKind === "generation"
        ? t("conversation.pane.generationFailed")
        : t("conversation.pane.persistFailed")
    action = (
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title={t("conversation.pane.regenerate")}
        aria-label={t("conversation.pane.regenerate")}
        onClick={onRegenerate}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
      </Button>
    )
  } else if (generation.phase === "cancelled") {
    status = t("conversation.pane.replyStopped")
    action = (
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        title={t("conversation.pane.regenerate")}
        aria-label={t("conversation.pane.regenerate")}
        onClick={onRegenerate}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
      </Button>
    )
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
      {thinking.length > 0 && (
        <ThinkingBlock
          thinking={thinking}
          streaming={generation.phase === "streaming" && content.length === 0}
        />
      )}
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
          <Spinner className="size-3.5" aria-hidden="true" />
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
  onExportMessage,
  exportDisabled,
  transientGeneration,
  onRegenerate,
  userGenerationAction,
  assistantRegenerationAction,
  pendingBranchOriginId = null,
  reveal = null,
}: ConversationPaneProps) {
  const { t } = useTranslation()
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const transientContent =
    transientGeneration !== null && "content" in transientGeneration
      ? transientGeneration.content
      : ""
  // `path` is rebuilt with a fresh array identity on unrelated store updates
  // (e.g. background generation deltas in another conversation), so scrolling
  // must key on the displayed tail's content, not on the array reference.
  const lastMessage = path.at(-1)
  const pathScrollKey = `${path.length}|${lastMessage?.id ?? ""}|${lastMessage?.content ?? ""}`
  const revealNodeId = reveal?.nodeId ?? null
  const revealQuery = reveal?.query ?? ""
  const revealOnPath =
    revealNodeId !== null && path.some((message) => message.id === revealNodeId)

  React.useEffect(() => {
    if (status === "ready" || status === "streaming") {
      // While a search reveal owns the viewport, MessageNode scrolls to the
      // matched text; the bottom autoscroll would fight that target.
      if (revealOnPath) return
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
      bottomRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? "auto" : "smooth",
      })
    }
  }, [
    pathScrollKey,
    status,
    transientContent,
    transientGeneration?.phase,
    revealOnPath,
  ])

  if (status === "loading" && path.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <Spinner className="mb-4 size-8" aria-hidden="true" />
        <p>{t("conversation.pane.loading")}</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
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
            <h3 className="font-medium text-sm">
              {t("conversation.pane.errorTitle")}
            </h3>
            <p className="text-sm mt-1 opacity-90">
              {commandErrorMessage(error.code)}
            </p>
          </div>
          {error.retryable && onRetry !== undefined && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="shrink-0"
            >
              <RefreshCw aria-hidden="true" />
              {t("conversation.pane.retry")}
            </Button>
          )}
        </div>
      )}

      {path.length === 0 && status !== "loading" && !error && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p>{t("conversation.pane.empty")}</p>
        </div>
      )}

      <div
        className="mx-auto w-full max-w-4xl flex-1 pb-28 md:pb-32"
        role="log"
      >
        {path.map((msg, index) => {
          const isLastMessage = index === path.length - 1
          const nodeGenerationAction =
            isLastMessage && userGenerationAction && msg.role === "user"
              ? userGenerationAction
              : undefined
          const nodeAssistantRegenerationAction =
            status === "ready" &&
            transientGeneration === null &&
            isLastMessage &&
            msg.role === "assistant" &&
            assistantRegenerationAction?.assistantNodeId === msg.id
              ? assistantRegenerationAction
              : undefined
          return (
            <React.Fragment key={msg.id}>
              <MessageNode
                message={msg}
                canBranch={canBranch(msg.id)}
                canEdit={canEdit(msg.id)}
                onCreateBranch={onCreateBranch}
                onEditAsBranch={onEditAsBranch}
                onExportMessage={onExportMessage}
                exportDisabled={exportDisabled}
                generationAction={nodeGenerationAction}
                assistantRegenerationAction={nodeAssistantRegenerationAction}
                highlightQuery={
                  revealNodeId !== null && revealNodeId === msg.id
                    ? revealQuery
                    : undefined
                }
                scrollContainerRef={containerRef}
              />
              {pendingBranchOriginId === msg.id && (
                <Marker
                  variant="separator"
                  className="my-6"
                  role="separator"
                  aria-label={t("conversation.pane.branchOrigin")}
                >
                  <MarkerIcon>
                    <GitBranch />
                  </MarkerIcon>
                  <MarkerContent>
                    {t("conversation.pane.branchOrigin")}
                  </MarkerContent>
                </Marker>
              )}
            </React.Fragment>
          )
        })}
        {transientGeneration !== null && (
          <TransientGenerationMessage
            generation={transientGeneration}
            onRegenerate={onRegenerate}
          />
        )}
        {status === "loading" && path.length > 0 && (
          <div
            className="flex justify-center p-4"
            aria-label={t("conversation.pane.saving")}
          >
            <Spinner
              className="size-6 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </div>
  )
}
