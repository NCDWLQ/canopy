import type { ReactNode } from "react"

import type { PathMessageView } from "../types"
import { cn } from "@/lib/utils"

export type MessageBubbleProps = {
  role: PathMessageView["role"]
  children: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}

const ROLE_LABELS: Record<PathMessageView["role"], string> = {
  system: "系统",
  user: "用户",
  assistant: "助手",
  tool: "工具",
}

export function MessageBubble({
  role,
  children,
  actions,
  footer,
}: MessageBubbleProps) {
  const roleLabel = ROLE_LABELS[role]

  return (
    <article
      aria-label={`${roleLabel}消息`}
      className={cn(
        "my-2 rounded-lg border p-4",
        role === "user" ? "ml-8 bg-muted" : "mr-8 bg-card",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold capitalize text-muted-foreground">
          {roleLabel}
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {children}
      {footer}
    </article>
  )
}
