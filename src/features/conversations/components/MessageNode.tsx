import * as React from "react"
import { GitBranch, Edit2, X, Check } from "lucide-react"
import type { PathMessageView } from "../types"
import { Button } from "@/components/ui/button"

export type MessageNodeProps = {
  message: PathMessageView
  canBranch: boolean
  canEdit: boolean
  onCreateBranch: (nodeId: string, content: string) => void
  onEditAsBranch: (nodeId: string, content: string) => void
}

export function MessageNode({
  message,
  canBranch,
  canEdit,
  onCreateBranch,
  onEditAsBranch,
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

  return (
    <article
      aria-label={`${message.role} message`}
      className={`my-2 rounded-lg border p-4 shadow-sm ${
        message.role === "user" ? "ml-8 bg-muted" : "mr-8 bg-card"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold capitalize text-muted-foreground">
          {message.role}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !isEditing && !isBranching && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Edit as new branch"
              aria-label="Edit as new branch"
              onClick={() => {
                setEditContent(message.content)
                setIsEditing(true)
              }}
            >
              <Edit2 aria-hidden="true" />
            </Button>
          )}
          {canBranch && !isEditing && !isBranching && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title="Create branch from here"
              aria-label="Create branch from here"
              onClick={() => setIsBranching(true)}
            >
              <GitBranch aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {isEditing && canEdit ? (
        <div className="mt-2">
          <textarea
            ref={editInputRef}
            className="min-h-[100px] w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            aria-label="Edit message content"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              <X aria-hidden="true" /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleEditSubmit}
              disabled={!editContent.trim()}
            >
              <Check aria-hidden="true" /> Save as Branch
            </Button>
          </div>
        </div>
      ) : isBranching && canBranch ? (
        <div className="mt-2">
          <textarea
            ref={branchInputRef}
            className="min-h-[100px] w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Type your branched message..."
            value={branchContent}
            onChange={(e) => setBranchContent(e.target.value)}
            aria-label="Branch message content"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsBranching(false)}
            >
              <X aria-hidden="true" /> Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleBranchSubmit}
              disabled={!branchContent.trim()}
            >
              <Check aria-hidden="true" /> Create Branch
            </Button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {message.content}
        </div>
      )}
    </article>
  )
}
