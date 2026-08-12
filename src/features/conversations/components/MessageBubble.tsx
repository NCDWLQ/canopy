import type { ReactNode } from "react"

import type { PathMessageView } from "../types"
import { cn } from "@/lib/utils"

export type MessageBubbleProps = {
  role: PathMessageView["role"]
  children: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}

export function MessageBubble({
  role,
  children,
  actions,
  footer,
}: MessageBubbleProps) {
  return (
    <article
      aria-label={`${role} message`}
      className={cn(
        "my-2 rounded-lg border p-4 shadow-sm",
        role === "user" ? "ml-8 bg-muted" : "mr-8 bg-card",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold capitalize text-muted-foreground">
          {role}
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {children}
      {footer}
    </article>
  )
}
