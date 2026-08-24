import * as React from "react"
import { Pencil } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { UiError } from "@/lib/tauri"
import { trimRustWhitespace } from "@/lib/tauri/schemas"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"

const MAX_TITLE_CHARS = 200

export type RenameConversationDialogProps = {
  currentTitle: string
  onClose: () => void
  onRename: (title: string) => Promise<UiError | null>
}

/**
 * Mounted conditionally (keyed by target conversation) so each open starts
 * from a fresh snapshot of the current title.
 */
export function RenameConversationDialog({
  currentTitle,
  onClose,
  onRename,
}: RenameConversationDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState(currentTitle)
  const [error, setError] = React.useState<UiError | null>(null)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const trimmed = trimRustWhitespace(draft)
  const trimmedLength = [...trimmed].length
  const validationHint =
    trimmedLength > MAX_TITLE_CHARS
      ? t("conversation.workspace.renameDialogTitleTooLong")
      : trimmedLength === 0
        ? t("conversation.workspace.renameDialogTitleBlank")
        : null
  const canSave = validationHint === null && !saving

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    void onRename(trimmed).then((failure) => {
      if (failure === null) {
        onClose()
        return
      }
      setError(failure)
      setSaving(false)
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onClose()
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Focus the input with the title fully selected so one keystroke
          // starts a replacement.
          event.preventDefault()
          const input = inputRef.current
          if (input !== null) {
            input.focus()
            input.select()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" aria-hidden="true" />
            {t("conversation.workspace.renameDialogTitle")}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-conversation-title">
              {t("conversation.workspace.renameDialogLabel")}
            </Label>
            <Input
              id="rename-conversation-title"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-invalid={validationHint !== null}
              aria-describedby={
                validationHint !== null ? "rename-conversation-hint" : undefined
              }
            />
            {validationHint !== null && (
              <p
                id="rename-conversation-hint"
                role="alert"
                className="text-sm text-destructive"
              >
                {validationHint}
              </p>
            )}
          </div>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>
                {commandErrorMessage(error.code)}
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
