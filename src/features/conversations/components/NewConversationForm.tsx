import * as React from "react"

import type { UiError } from "../types"
import { Button } from "@/components/ui/button"

export type NewConversationFormProps = {
  disabled: boolean
  error: UiError | null
  onSubmit: (title: string, content: string) => void
  onDismissError: () => void
}

export function NewConversationForm({
  disabled,
  error,
  onSubmit,
  onDismissError,
}: NewConversationFormProps) {
  const [title, setTitle] = React.useState("")
  const [content, setContent] = React.useState("")

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!disabled && title.trim() && content.trim()) {
      onSubmit(title, content)
    }
  }

  return (
    <section
      className="flex flex-1 items-center justify-center overflow-y-auto p-6"
      aria-labelledby="new-conversation-title"
    >
      <form
        className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Conversation workspace
          </p>
          <h1 id="new-conversation-title" className="text-2xl font-semibold">
            Start a conversation
          </h1>
          <p className="text-sm text-muted-foreground">
            This creates one user root. Assistant generation is not available in
            this build, so no assistant reply will be invented.
          </p>
        </div>

        {error !== null && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <p>{error.message}</p>
            <Button
              className="mt-2"
              type="button"
              variant="outline"
              size="sm"
              onClick={onDismissError}
            >
              Dismiss
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="conversation-title">
            Title
          </label>
          <input
            id="conversation-title"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={disabled}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="initial-message">
            First message
          </label>
          <textarea
            id="initial-message"
            className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={disabled}
          />
        </div>

        <Button
          type="submit"
          disabled={disabled || !title.trim() || !content.trim()}
        >
          {disabled ? "Creating…" : "Create conversation"}
        </Button>
      </form>
    </section>
  )
}
