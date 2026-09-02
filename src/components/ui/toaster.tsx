import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as SonnerToaster, toast } from "sonner"

import { t } from "@/lib/i18n"

function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      data-slot="toaster"
      position="top-right"
      expand
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export type ClickableToastOptions = {
  kind: "success" | "error"
  title: string
  description?: string
  ariaLabel?: string
  onSelect: () => void
}

// sonner has no per-toast body click handler (only action buttons), so a
// fully clickable card must be rendered through toast.custom().
export function showClickableToast({
  kind,
  title,
  description,
  ariaLabel,
  onSelect,
}: ClickableToastOptions) {
  toast.custom((id) => (
    <button
      type="button"
      aria-label={ariaLabel ?? t("conversation.toast.jumpToConversation")}
      className="flex w-full cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-border bg-popover p-4 text-left text-popover-foreground shadow-lg outline-none transition-colors hover:bg-muted hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      onClick={() => {
        onSelect()
        toast.dismiss(id)
      }}
    >
      {kind === "success" ? (
        <CircleCheckIcon
          className="mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
      ) : (
        <OctagonXIcon
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-1 text-sm font-medium">{title}</span>
        {description !== undefined && (
          <span className="line-clamp-3 text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </button>
  ))
}

export { Toaster }
