import type { ReactNode, Ref } from "react"

import type { PathMessageView } from "../types"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type MessageBubbleProps = {
  role: PathMessageView["role"]
  children: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  className?: string
  // Stable scroll anchor for search-result positioning.
  nodeId?: string
  articleRef?: Ref<HTMLElement>
}

export function MessageBubble({
  role,
  children,
  actions,
  footer,
  className,
  nodeId,
  articleRef,
}: MessageBubbleProps) {
  const { t } = useTranslation()
  const roleLabels: Record<PathMessageView["role"], string> = {
    system: t("conversation.messageBubble.roleSystem"),
    user: t("conversation.messageBubble.roleUser"),
    assistant: t("conversation.messageBubble.roleAssistant"),
    tool: t("conversation.messageBubble.roleTool"),
  }
  const roleLabel = roleLabels[role]
  const messageAria = t("conversation.messageBubble.messageAria", {
    role: roleLabel,
  })
  if (role === "user") {
    return (
      <article
        ref={articleRef}
        data-node-id={nodeId}
        aria-label={messageAria}
        className={cn("group flex flex-col items-end my-3 w-full", className)}
      >
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground">
          {children}
        </div>
        {footer && <div className="mt-1 w-full max-w-[85%]">{footer}</div>}
        {actions && (
          <div className="mt-1 flex items-center justify-end gap-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </article>
    )
  }

  if (role === "assistant") {
    return (
      <article
        ref={articleRef}
        data-node-id={nodeId}
        aria-label={messageAria}
        className={cn(
          "flex flex-col items-start my-4 w-full text-foreground",
          className,
        )}
      >
        <div className="w-full text-sm">{children}</div>
        {footer && <div className="w-full">{footer}</div>}
        {actions && (
          <div className="mt-2 flex items-center gap-1 text-muted-foreground">
            {actions}
          </div>
        )}
      </article>
    )
  }

  return (
    <article
      ref={articleRef}
      data-node-id={nodeId}
      aria-label={messageAria}
      className={cn("group my-3 flex flex-col items-center w-full", className)}
    >
      <div className="max-w-[85%] rounded-lg border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        {children}
      </div>
      {footer && <div className="w-full">{footer}</div>}
      {actions && (
        <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {actions}
        </div>
      )}
    </article>
  )
}
