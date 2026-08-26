import * as React from "react"
import { ArrowUp, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"

export type ComposerAction =
  { kind: "send"; disabled: boolean } | { kind: "cancel"; onCancel: () => void }

export type ComposerProps = {
  onSubmit: (content: string) => void | Promise<boolean | void>
  inputDisabled: boolean
  action: ComposerAction
  placeholder?: string
}

export type ComposerHandle = {
  focus: () => void
}

export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    { onSubmit, inputDisabled, action, placeholder }: ComposerProps,
    ref,
  ) {
    const { t } = useTranslation()
    const effectivePlaceholder =
      placeholder ?? t("conversation.composer.placeholder")
    const [content, setContent] = React.useState("")
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    React.useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }))

    const handleSubmit = async () => {
      if (
        action.kind === "send" &&
        !action.disabled &&
        !inputDisabled &&
        !isSubmitting &&
        content.trim()
      ) {
        setIsSubmitting(true)
        let submitted: boolean | void
        try {
          submitted = await onSubmit(content)
        } catch {
          submitted = false
        } finally {
          setIsSubmitting(false)
        }
        if (submitted === false) return
        setContent("")
        // Reset height
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto"
        }
      }
    }

    const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (action.kind === "send") {
        void handleSubmit()
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (action.kind === "send" && !action.disabled && !inputDisabled) {
          void handleSubmit()
        }
      }
    }

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget
      target.style.height = "auto"
      target.style.height = `${Math.min(target.scrollHeight, 200)}px`
    }

    return (
      <form
        className="pointer-events-none relative w-full bg-gradient-to-t from-background via-background/80 to-transparent px-4 pb-6 pt-6 md:px-8"
        onSubmit={handleFormSubmit}
      >
        <div className="pointer-events-auto relative mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-border/80 bg-card/95 p-2 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 dark:border-border/60 dark:bg-card/90">
          <label className="sr-only" htmlFor="message-composer">
            {t("conversation.composer.label")}
          </label>
          <textarea
            id="message-composer"
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={inputDisabled || isSubmitting}
            placeholder={effectivePlaceholder}
            rows={1}
            className="max-h-[200px] w-full resize-none border-none bg-transparent px-3 py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
          />
          {action.kind === "cancel" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="size-8 shrink-0 rounded-full"
                  type="button"
                  aria-label={t("conversation.composer.cancelGeneration")}
                  onClick={action.onCancel}
                >
                  <Square
                    className="size-3.5 fill-current"
                    aria-hidden="true"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("conversation.composer.cancelGeneration")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="size-8 shrink-0 rounded-full"
                  disabled={
                    inputDisabled ||
                    isSubmitting ||
                    action.disabled ||
                    !content.trim()
                  }
                  type="submit"
                  aria-label={t("conversation.composer.send")}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>{t("conversation.composer.send")}</span>
                <Kbd>Enter</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </form>
    )
  },
)
