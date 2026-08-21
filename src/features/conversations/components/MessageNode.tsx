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
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

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
}

export function MessageNode({
  message,
  canBranch,
  canEdit,
  onCreateBranch,
  onEditAsBranch,
  generationAction,
  assistantRegenerationAction,
}: MessageNodeProps) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(message.content)
  const [isBranching, setIsBranching] = React.useState(false)
  const [branchContent, setBranchContent] = React.useState("")
  const [isCopied, setIsCopied] = React.useState(false)
  const editInputRef = React.useRef<HTMLTextAreaElement>(null)
  const branchInputRef = React.useRef<HTMLTextAreaElement>(null)
  const copyResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

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
      footer={
        isEditing ? (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              <X className="size-3.5 mr-1" aria-hidden="true" /> 取消
            </Button>
            <Button
              size="sm"
              onClick={handleEditSubmit}
              disabled={!editContent.trim()}
            >
              <Check className="size-3.5 mr-1" aria-hidden="true" />{" "}
              保存为新分支
            </Button>
          </div>
        ) : isBranching ? (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBranching(false)}
            >
              <X className="size-3.5 mr-1" aria-hidden="true" /> 取消
            </Button>
            <Button
              size="sm"
              onClick={handleBranchSubmit}
              disabled={!branchContent.trim()}
            >
              <Check className="size-3.5 mr-1" aria-hidden="true" /> 创建分支
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
                  生成回复
                </>
              ) : (
                <>
                  <Settings2 data-icon="inline-start" aria-hidden="true" />
                  配置服务提供商以生成
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
                title="重新生成"
                aria-label="重新生成"
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
                title="编辑为新分支"
                aria-label="编辑为新分支"
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
                title="从此处创建分支"
                aria-label="从此处创建分支"
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
                title={isCopied ? "已复制" : "复制"}
                aria-label={isCopied ? "已复制" : "复制"}
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
          aria-label="编辑消息内容"
        />
      ) : isBranching && canBranch ? (
        <Textarea
          ref={branchInputRef}
          className="w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          placeholder="输入分支消息…"
          value={branchContent}
          onChange={(e) => setBranchContent(e.target.value)}
          aria-label="分支消息内容"
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
          {message.content}
        </div>
      )}
    </MessageBubble>
  )
}
