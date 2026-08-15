import * as React from "react"
import {
  GitBranch,
  Edit2,
  X,
  Check,
  Sparkles,
  Settings2,
  RefreshCw,
} from "lucide-react"
import { AssistantMarkdown } from "./AssistantMarkdown"
import { MessageBubble } from "./MessageBubble"
import type { PathMessageView } from "../types"
import { Button } from "@/components/ui/button"

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
  const editInputRef = React.useRef<HTMLTextAreaElement>(null)
  const branchInputRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (isEditing) editInputRef.current?.focus()
  }, [isEditing])

  React.useEffect(() => {
    if (isBranching) branchInputRef.current?.focus()
  }, [isBranching])

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

  const regenerationAction =
    assistantRegenerationAction?.assistantNodeId === message.id
      ? assistantRegenerationAction
      : undefined
  const hasActions =
    (canEdit || canBranch || regenerationAction !== undefined) &&
    !isEditing &&
    !isBranching

  const showGenerationAction =
    generationAction !== undefined && !isEditing && !isBranching

  return (
    <MessageBubble
      role={message.role}
      footer={
        showGenerationAction ? (
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
          </>
        ) : undefined
      }
    >
      {isEditing && canEdit ? (
        <div className="w-full min-w-[260px] sm:min-w-[360px]">
          <textarea
            ref={editInputRef}
            className="min-h-[100px] w-full resize-y rounded-md border bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            aria-label="编辑消息内容"
          />
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
        </div>
      ) : isBranching && canBranch ? (
        <div className="w-full min-w-[260px] sm:min-w-[360px]">
          <textarea
            ref={branchInputRef}
            className="min-h-[100px] w-full resize-y rounded-md border bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            placeholder="输入分支消息…"
            value={branchContent}
            onChange={(e) => setBranchContent(e.target.value)}
            aria-label="分支消息内容"
          />
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
        </div>
      ) : message.role === "assistant" ? (
        <AssistantMarkdown content={message.content} />
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {message.content}
        </div>
      )}
    </MessageBubble>
  )
}
