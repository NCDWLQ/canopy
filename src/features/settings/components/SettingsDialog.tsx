import * as React from "react"
import { Archive, Bot, MessageSquare, Palette, Settings } from "lucide-react"

import {
  ArchivedConversationsPanel,
  type ArchivedConversationsPanelProps,
} from "./ArchivedConversationsPanel"
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel"
import { ConversationSettingsPanel } from "./ConversationSettingsPanel"
import { GeneralSettingsPanel } from "./GeneralSettingsPanel"
import { ProviderSettingsPanel } from "@/features/providers/components/ProviderSettingsPanel"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ProviderClient } from "@/lib/tauri"
import { useTranslation } from "@/lib/i18n"

type SettingsDialogBaseProps = {
  client: ProviderClient
  readOnly: boolean
  initialCategory?: SettingsCategory
  archivedConversations: ArchivedConversationsPanelProps
}

export type SettingsDialogProps = SettingsDialogBaseProps &
  (
    | { open?: never; onOpenChange?: never }
    | { open: boolean; onOpenChange: (open: boolean) => void }
  )

export type SettingsCategory =
  "general" | "appearance" | "providers" | "conversation" | "archived"

type PendingDiscard =
  { kind: "switch"; category: SettingsCategory } | { kind: "close" }

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    client,
    readOnly,
    initialCategory = "general",
    archivedConversations,
  } = props
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [category, setCategory] =
    React.useState<SettingsCategory>(initialCategory)
  const [providerSessionKey, setProviderSessionKey] = React.useState(0)
  const [panelDirty, setPanelDirty] = React.useState(false)
  const [pendingDiscard, setPendingDiscard] =
    React.useState<PendingDiscard | null>(null)

  const isControlled = props.open !== undefined
  const open = isControlled ? props.open : uncontrolledOpen
  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevInitialCategory, setPrevInitialCategory] =
    React.useState(initialCategory)

  if (open !== prevOpen || (open && initialCategory !== prevInitialCategory)) {
    setPrevOpen(open)
    setPrevInitialCategory(initialCategory)
    if (open) {
      setCategory(initialCategory)
      setProviderSessionKey((current) => current + 1)
      setPanelDirty(false)
      setPendingDiscard(null)
    }
  }

  const closeDialog = () => {
    if (!isControlled) setUncontrolledOpen(false)
    props.onOpenChange?.(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && panelDirty) {
      setPendingDiscard({ kind: "close" })
      return
    }
    if (!isControlled) setUncontrolledOpen(nextOpen)
    props.onOpenChange?.(nextOpen)
  }

  const selectCategory = (nextCategory: SettingsCategory) => {
    if (nextCategory !== category && panelDirty) {
      setPendingDiscard({ kind: "switch", category: nextCategory })
      return
    }
    setCategory(nextCategory)
  }

  const confirmDiscard = () => {
    const action = pendingDiscard
    setPendingDiscard(null)
    setPanelDirty(false)
    if (action === null) return
    if (action.kind === "switch") {
      setCategory(action.category)
    } else {
      closeDialog()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          <Settings data-icon="inline-start" />
          {t("common.settings")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("common.settings")}</DialogTitle>
          <DialogDescription>
            {t("settings.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label={t("settings.dialog.navLabel")}
            className="flex flex-col gap-1 border-b p-2 md:border-r md:border-b-0"
          >
            <Button
              type="button"
              variant={category === "general" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "general" ? "page" : undefined}
              onClick={() => selectCategory("general")}
            >
              <Settings data-icon="inline-start" />
              {t("settings.dialog.generalCategory")}
            </Button>
            <Button
              type="button"
              variant={category === "appearance" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "appearance" ? "page" : undefined}
              onClick={() => selectCategory("appearance")}
            >
              <Palette data-icon="inline-start" />
              {t("settings.dialog.appearanceCategory")}
            </Button>
            <Button
              type="button"
              variant={category === "providers" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "providers" ? "page" : undefined}
              onClick={() => selectCategory("providers")}
            >
              <Bot data-icon="inline-start" />
              {t("settings.dialog.providersCategory")}
            </Button>
            <Button
              type="button"
              variant={category === "conversation" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "conversation" ? "page" : undefined}
              onClick={() => selectCategory("conversation")}
            >
              <MessageSquare data-icon="inline-start" />
              {t("settings.dialog.conversationsCategory")}
            </Button>
            <Button
              type="button"
              variant={category === "archived" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "archived" ? "page" : undefined}
              onClick={() => selectCategory("archived")}
            >
              <Archive data-icon="inline-start" />
              {t("settings.dialog.archivedCategory")}
            </Button>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-col">
            {open &&
              (category === "general" ? (
                <GeneralSettingsPanel client={client} readOnly={readOnly} />
              ) : category === "appearance" ? (
                <AppearanceSettingsPanel client={client} readOnly={readOnly} />
              ) : category === "conversation" ? (
                <ConversationSettingsPanel
                  client={client}
                  readOnly={readOnly}
                  onDirtyChange={setPanelDirty}
                />
              ) : category === "archived" ? (
                <ArchivedConversationsPanel {...archivedConversations} />
              ) : (
                <ProviderSettingsPanel
                  key={providerSessionKey}
                  client={client}
                  readOnly={readOnly}
                  onDirtyChange={setPanelDirty}
                />
              ))}
          </div>
        </div>
        <ConfirmDialog
          open={pendingDiscard !== null}
          title={t("common.unsavedChangesTitle")}
          description={t("common.unsavedChangesBody")}
          cancelLabel={t("common.cancel")}
          confirmLabel={t("common.discard")}
          destructive
          onCancel={() => setPendingDiscard(null)}
          onConfirm={confirmDiscard}
        />
      </DialogContent>
    </Dialog>
  )
}
