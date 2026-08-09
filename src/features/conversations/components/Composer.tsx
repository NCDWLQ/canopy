import * as React from "react"
import { SendHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"

export type ComposerProps = {
  onSubmit: (content: string) => void
  disabled: boolean
  placeholder?: string
}

export function Composer({
  onSubmit,
  disabled,
  placeholder = "Type a message...",
}: ComposerProps) {
  const [content, setContent] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (content.trim() && !disabled) {
      onSubmit(content)
      setContent("")
      // Reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    }
  }

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSubmit()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    target.style.height = "auto"
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }

  return (
    <form className="border-t bg-background p-4" onSubmit={handleFormSubmit}>
      <div className="relative mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border bg-muted p-2 focus-within:ring-2 focus-within:ring-ring">
        <label className="sr-only" htmlFor="message-composer">
          Message composer
        </label>
        <textarea
          id="message-composer"
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="max-h-[200px] w-full resize-none border-none bg-transparent px-3 py-2 text-sm text-foreground outline-none disabled:opacity-50"
        />
        <Button
          size="icon"
          className="size-8 shrink-0 rounded-full"
          disabled={disabled || !content.trim()}
          type="submit"
          title="Send message"
          aria-label="Send message"
        >
          <SendHorizontal aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}
