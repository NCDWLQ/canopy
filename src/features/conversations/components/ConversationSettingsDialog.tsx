import * as React from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useProviderStore } from "@/features/providers/store"
import { useConversationStore } from "../store"
import { trimRustWhitespace } from "@/lib/tauri/schemas"
import type { ConversationClient } from "@/lib/tauri"
import { useTranslation } from "@/lib/i18n"

export type ConversationSettingsDialogProps = {
  conversationClient: ConversationClient
  draftMode: boolean
  readOnly: boolean
}

function normalizeDraft(value: string): string | null {
  const trimmed = trimRustWhitespace(value)
  return trimmed.length === 0 ? null : trimmed
}

export function ConversationSettingsDialog({
  conversationClient,
  draftMode,
  readOnly,
}: ConversationSettingsDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const systemPrompt = useConversationStore((state) => state.systemPrompt)
  const draftSystemPrompt = useConversationStore(
    (state) => state.draftSystemPrompt,
  )
  const setConversationSystemPrompt = useConversationStore(
    (state) => state.setConversationSystemPrompt,
  )
  const setDraftSystemPrompt = useConversationStore(
    (state) => state.setDraftSystemPrompt,
  )
  const defaultSystemPrompt = useProviderStore(
    (state) => state.defaultSystemPrompt,
  )
  const stored = draftMode ? draftSystemPrompt : systemPrompt
  const [edit, setEdit] = React.useState<string | null>(null)
  const draft = edit ?? stored ?? ""

  const normalizedDraft = normalizeDraft(draft)
  const dirty = normalizedDraft !== (stored ?? null)
  const followsGlobal = stored === null
  const canSave = !readOnly && dirty

  const handleOpenChange = (next: boolean) => {
    if (next) setEdit(null)
    setOpen(next)
  }

  const handleSave = () => {
    if (readOnly || !dirty) return
    if (draftMode) {
      setDraftSystemPrompt(normalizedDraft)
      setOpen(false)
      return
    }
    // The store action swallows IPC failures into `error`; only close when
    // the authoritative prompt actually matches what we asked to persist.
    void setConversationSystemPrompt(conversationClient, normalizedDraft).then(
      () => {
        if (useConversationStore.getState().systemPrompt === normalizedDraft) {
          setOpen(false)
        }
      },
    )
  }

  const handleRestore = () => {
    if (readOnly) return
    if (draftMode) {
      setDraftSystemPrompt(null)
      setEdit(null)
      return
    }
    void setConversationSystemPrompt(conversationClient, null).then(() => {
      if (useConversationStore.getState().systemPrompt === null) {
        setEdit(null)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("conversation.workspace.conversationSettings")}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t("conversation.workspace.conversationSettings")}
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("conversation.settingsDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("conversation.settingsDialog.systemPromptDescription")}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="conversation-system-prompt">
            {t("conversation.settingsDialog.systemPrompt")}
          </FieldLabel>
          <Textarea
            id="conversation-system-prompt"
            value={draft}
            disabled={readOnly}
            placeholder={t("conversation.settingsDialog.followGlobal")}
            onChange={(event) => setEdit(event.target.value)}
          />
          {followsGlobal && defaultSystemPrompt !== null ? (
            <FieldDescription>
              {t("conversation.settingsDialog.globalPreview")}
              {`: ${defaultSystemPrompt}`}
            </FieldDescription>
          ) : null}
        </Field>
        <DialogFooter>
          {!followsGlobal && !readOnly ? (
            <Button type="button" variant="outline" onClick={handleRestore}>
              {t("conversation.settingsDialog.restoreFollowGlobal")}
            </Button>
          ) : null}
          <Button type="button" disabled={!canSave} onClick={handleSave}>
            {t("conversation.settingsDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
