import * as React from "react"
import {
  GitBranch,
  Edit2,
  X,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
  Settings2,
  RefreshCw,
} from "lucide-react"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { BranchSwitcher } from "./BranchSwitcher"
import { MessageBubble } from "./MessageBubble"
import { ThinkingBlock } from "./ThinkingBlock"
import type { PathMessageView } from "../types"
import {
  applySearchHighlight,
  clearSearchHighlight,
  findTextMatchRanges,
} from "../highlightMatches"
import { HighlightedText } from "./HighlightedText"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"

export type UserGenerationAction =
  | { kind: "generate"; onSelect: () => void }
  | { kind: "configure-provider"; onSelect: () => void }

export type AssistantRegenerationAction = {
  assistantNodeId: string
  onSelect: (assistantNodeId: string) => void
}

export type BranchSwitcherControl = {
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  prevDisabled: boolean
  nextDisabled: boolean
}

export type MessageNodeProps = {
  message: PathMessageView
  canBranch: boolean
  canEdit: boolean
  onCreateBranch: (nodeId: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
  generationAction?: UserGenerationAction
  assistantRegenerationAction?: AssistantRegenerationAction
  // Present only on the search-revealed message; drives match highlighting.
  highlightQuery?: string
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  /** Present only on assistant messages; undefined hides the export button. */
  onExportMessage?: (nodeId: string) => void
  /** Present when the message has sibling branches on the active path. */
  branchSwitcher?: BranchSwitcherControl
  /** True while this conversation is generating (streaming content is not durable yet). */
  exportDisabled?: boolean
}

export function MessageNode({
  message,
  canBranch,
  canEdit,
  onCreateBranch,
  onEditAsBranch,
  generationAction,
  assistantRegenerationAction,
  highlightQuery,
  scrollContainerRef,
  onExportMessage,
  branchSwitcher,
  exportDisabled = false,
}: MessageNodeProps) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(message.content)
  const [isCopied, setIsCopied] = React.useState(false)
  const editInputRef = React.useRef<HTMLTextAreaElement>(null)
  const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealArticleRef = React.useRef<HTMLElement>(null)
  const assistantContentRef = React.useRef<HTMLDivElement>(null)

  // Reveal positioning + match highlighting for the search-selected message.
  // The scroll target is the match itself, not the article: a message taller
  // than the viewport must still show its revealed part. Anchoring is the
  // message start (top), never the center — long bubbles read from the top.
  // Plain text roles scroll to their inline <mark>; assistant content renders
  // through the markdown pipeline, so the CSS Custom Highlight API marks the
  // first-occurrence match on the already-rendered article (no-op in jsdom
  // or engines without the API). Align the assistant's exact DOM Range to
  // the container top geometrically because a containing paragraph may
  // itself exceed the viewport; fall back to that containing element when
  // range geometry or element scrolling is unavailable.
  React.useEffect(() => {
    if (highlightQuery === undefined) return
    const article = revealArticleRef.current
    const matchRoot =
      message.role === "assistant" ? assistantContentRef.current : article
    if (article === null || matchRoot === null) return

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches
    const behavior = reducedMotion ? "auto" : "smooth"

    if (message.role !== "assistant") {
      const matchTarget = article.querySelector("mark") ?? article
      matchTarget.scrollIntoView?.({
        block: "start",
        inline: "nearest",
        behavior,
      })
      return
    }

    const matchRange = findTextMatchRanges(matchRoot, highlightQuery)[0]
    const scrollContainer = scrollContainerRef?.current
    const matchRect = matchRange?.getBoundingClientRect?.()
    const containerRect = scrollContainer?.getBoundingClientRect()
    const hasUsableGeometry =
      matchRect !== undefined &&
      containerRect !== undefined &&
      Number.isFinite(matchRect.top) &&
      Number.isFinite(matchRect.height) &&
      Number.isFinite(containerRect.top) &&
      Number.isFinite(containerRect.height) &&
      containerRect.height > 0 &&
      (matchRect.width > 0 || matchRect.height > 0)
    if (
      matchRange !== undefined &&
      scrollContainer !== null &&
      scrollContainer !== undefined &&
      typeof scrollContainer.scrollBy === "function" &&
      hasUsableGeometry
    ) {
      scrollContainer.scrollBy({
        top: matchRect.top - containerRect.top,
        behavior,
      })
    } else {
      const fallbackTarget = matchRange?.startContainer.parentElement ?? article
      fallbackTarget.scrollIntoView?.({
        block: "start",
        inline: "nearest",
        behavior,
      })
    }

    applySearchHighlight(matchRoot, highlightQuery)
    return () => {
      clearSearchHighlight()
    }
  }, [highlightQuery, message.content, message.role, scrollContainerRef])

  React.useEffect(() => {
    if (isEditing) {
      const el = editInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }
  }, [isEditing])

  React.useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) {
        clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  const handleEditSubmit = () => {
    if (canEdit && editContent.trim()) {
      onEditAsBranch(message.id, editContent)
      setIsEditing(false)
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(message.content).then(
      () => {
        setIsCopied(true)
        if (copyResetRef.current !== null) {
          clearTimeout(copyResetRef.current)
        }
        copyResetRef.current = setTimeout(() => setIsCopied(false), 1500)
      },
      () => {},
    )
  }

  const regenerationAction =
    assistantRegenerationAction?.assistantNodeId === message.id
      ? assistantRegenerationAction
      : undefined
  const canCopy = message.role === "user" || message.role === "assistant"
  const canExport =
    message.role === "assistant" && onExportMessage !== undefined
  const hasActions =
    (canCopy ||
      canEdit ||
      canBranch ||
      canExport ||
      regenerationAction !== undefined) &&
    !isEditing

  const showGenerationAction = generationAction !== undefined && !isEditing
  const branchPager =
    branchSwitcher !== undefined && !isEditing ? (
      <BranchSwitcher
        index={branchSwitcher.index}
        count={branchSwitcher.count}
        onPrev={branchSwitcher.onPrev}
        onNext={branchSwitcher.onNext}
        prevDisabled={branchSwitcher.prevDisabled}
        nextDisabled={branchSwitcher.nextDisabled}
      />
    ) : undefined

  return (
    <MessageBubble
      role={message.role}
      nodeId={message.id}
      articleRef={revealArticleRef}
      pager={branchPager}
      footer={
        isEditing ? (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              <X className="size-3.5 mr-1" aria-hidden="true" />{" "}
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleEditSubmit}
              disabled={!editContent.trim()}
            >
              <Check className="size-3.5 mr-1" aria-hidden="true" />{" "}
              {t("conversation.message.saveAsBranch")}
            </Button>
          </div>
        ) : showGenerationAction ? (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={generationAction.onSelect}
            >
              {generationAction.kind === "generate" ? (
                <>
                  <Sparkles data-icon="inline-start" aria-hidden="true" />
                  {t("conversation.message.generateReply")}
                </>
              ) : (
                <>
                  <Settings2 data-icon="inline-start" aria-hidden="true" />
                  {t("conversation.message.configureProvider")}
                </>
              )}
            </Button>
          </div>
        ) : undefined
      }
      actions={
        hasActions ? (
          <>
            {regenerationAction !== undefined && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={t("conversation.message.regenerate")}
                    onClick={() =>
                      regenerationAction.onSelect(
                        regenerationAction.assistantNodeId,
                      )
                    }
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.message.regenerate")}
                </TooltipContent>
              </Tooltip>
            )}
            {canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={t("conversation.message.editAsBranch")}
                    onClick={() => {
                      setEditContent(message.content)
                      setIsEditing(true)
                    }}
                  >
                    <Edit2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.message.editAsBranch")}
                </TooltipContent>
              </Tooltip>
            )}
            {canBranch && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={t("conversation.message.branchFromHere")}
                    onClick={() => onCreateBranch(message.id)}
                  >
                    <GitBranch className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.message.branchFromHere")}
                </TooltipContent>
              </Tooltip>
            )}
            {canCopy && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={
                      isCopied
                        ? t("conversation.message.copied")
                        : t("conversation.message.copy")
                    }
                    onClick={handleCopy}
                  >
                    {isCopied ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCopied
                    ? t("conversation.message.copied")
                    : t("conversation.message.copy")}
                </TooltipContent>
              </Tooltip>
            )}
            {canExport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={t("conversation.message.export")}
                    disabled={exportDisabled}
                    onClick={() => onExportMessage?.(message.id)}
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("conversation.message.export")}
                </TooltipContent>
              </Tooltip>
            )}
          </>
        ) : undefined
      }
    >
      {isEditing && canEdit ? (
        <Textarea
          ref={editInputRef}
          className="w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          aria-label={t("conversation.message.editContent")}
        />
      ) : message.role === "assistant" ? (
        <>
          {message.thinking !== undefined && (
            <ThinkingBlock thinking={message.thinking} streaming={false} />
          )}
          <div ref={assistantContentRef}>
            <AssistantMarkdown content={message.content} />
          </div>
        </>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {highlightQuery === undefined ? (
            message.content
          ) : (
            <HighlightedText
              text={message.content}
              query={highlightQuery}
              firstOnly
            />
          )}
        </div>
      )}
    </MessageBubble>
  )
}
