import * as React from "react"
import {
  GitBranch,
  Edit2,
  X,
  Check,
  Copy,
  Sparkles,
  Settings2,
  RefreshCw,
} from "lucide-react"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { MessageBubble } from "./MessageBubble"
import { ThinkingBlock } from "./ThinkingBlock"
import type { PathMessageView } from "../types"
import { applySearchHighlight, clearSearchHighlight } from "../highlightMatches"
import { HighlightedText } from "./HighlightedText"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "@/lib/i18n"

export type UserGenerationAction =
  | { kind: "generate"; onSelect: () => void }
  | { kind: "configure-provider"; onSelect: () => void }

export type AssistantRegenerationAction = {
  assistantNodeId: string
  onSelect: (assistantNodeId: string) => void
}

export type MessageNodeProps = {
  message: PathMessageView
  canBranch: boolean
  canEdit: boolean
  onCreateBranch: (nodeId: string, content: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
  generationAction?: UserGenerationAction
  assistantRegenerationAction?: AssistantRegenerationAction
  // Present only on the search-revealed message; drives match highlighting.
  highlightQuery?: string
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
}: MessageNodeProps) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(message.content)
  const [isBranching, setIsBranching] = React.useState(false)
  const [branchContent, setBranchContent] = React.useState("")
  const [isCopied, setIsCopied] = React.useState(false)
  const editInputRef = React.useRef<HTMLTextAreaElement>(null)
  const branchInputRef = React.useRef<HTMLTextAreaElement>(null)
  const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealArticleRef = React.useRef<HTMLElement>(null)

  // Assistant content renders through the markdown pipeline, so plain-text
  // `<mark>` wrapping cannot reach it; the CSS Custom Highlight API applies
  // the same query to the already-rendered article instead (no-op in jsdom
  // or engines without the API — the reveal ring remains as fallback).
  React.useEffect(() => {
    if (highlightQuery === undefined || message.role !== "assistant") return
    const article = revealArticleRef.current
    if (article === null) return
    applySearchHighlight(article, highlightQuery)
    return () => {
      clearSearchHighlight()
    }
  }, [highlightQuery, message.role])

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
    if (isBranching) {
      const el = branchInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }
  }, [isBranching])

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

  const handleBranchSubmit = () => {
    if (canBranch && branchContent.trim()) {
      onCreateBranch(message.id, branchContent)
      setIsBranching(false)
      setBranchContent("")
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
  const hasActions =
    (canCopy || canEdit || canBranch || regenerationAction !== undefined) &&
    !isEditing &&
    !isBranching

  const showGenerationAction =
    generationAction !== undefined && !isEditing && !isBranching

  return (
    <MessageBubble
      role={message.role}
      nodeId={message.id}
      highlighted={highlightQuery !== undefined}
      articleRef={revealArticleRef}
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
        ) : isBranching ? (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBranching(false)}
            >
              <X className="size-3.5 mr-1" aria-hidden="true" />{" "}
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleBranchSubmit}
              disabled={!branchContent.trim()}
            >
              <Check className="size-3.5 mr-1" aria-hidden="true" />{" "}
              {t("conversation.message.createBranch")}
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
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={t("conversation.message.regenerate")}
                aria-label={t("conversation.message.regenerate")}
                onClick={() =>
                  regenerationAction.onSelect(
                    regenerationAction.assistantNodeId,
                  )
                }
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={t("conversation.message.editAsBranch")}
                aria-label={t("conversation.message.editAsBranch")}
                onClick={() => {
                  setEditContent(message.content)
                  setIsEditing(true)
                }}
              >
                <Edit2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {canBranch && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={t("conversation.message.branchFromHere")}
                aria-label={t("conversation.message.branchFromHere")}
                onClick={() => setIsBranching(true)}
              >
                <GitBranch className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {canCopy && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={
                  isCopied
                    ? t("conversation.message.copied")
                    : t("conversation.message.copy")
                }
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
      ) : isBranching && canBranch ? (
        <Textarea
          ref={branchInputRef}
          className="w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          placeholder={t("conversation.message.branchPlaceholder")}
          value={branchContent}
          onChange={(e) => setBranchContent(e.target.value)}
          aria-label={t("conversation.message.branchContent")}
        />
      ) : message.role === "assistant" ? (
        <>
          {message.thinking !== undefined && (
            <ThinkingBlock thinking={message.thinking} streaming={false} />
          )}
          <AssistantMarkdown content={message.content} />
        </>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {highlightQuery === undefined ? (
            message.content
          ) : (
            <HighlightedText text={message.content} query={highlightQuery} />
          )}
        </div>
      )}
    </MessageBubble>
  )
}
