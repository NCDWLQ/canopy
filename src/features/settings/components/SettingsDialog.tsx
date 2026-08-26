import * as React from "react"
import { Bot, MessageSquare, Palette, Settings2 } from "lucide-react"

import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel"
import { ConversationSettingsPanel } from "./ConversationSettingsPanel"
import { GeneralSettingsPanel } from "./GeneralSettingsPanel"
import { ProviderSettingsPanel } from "@/features/providers/components/ProviderSettingsPanel"
import { Button } from "@/components/ui/button"
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
}

export type SettingsDialogProps = SettingsDialogBaseProps &
  (
    | { open?: never; onOpenChange?: never }
    | { open: boolean; onOpenChange: (open: boolean) => void }
  )

export type SettingsCategory =
  "general" | "appearance" | "providers" | "conversation"

export function SettingsDialog(props: SettingsDialogProps) {
  const { client, readOnly, initialCategory = "general" } = props
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [category, setCategory] =
    React.useState<SettingsCategory>(initialCategory)
  const [providerSessionKey, setProviderSessionKey] = React.useState(0)

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
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen)
    props.onOpenChange?.(nextOpen)
  }

  const selectCategory = (nextCategory: SettingsCategory) => {
    setCategory(nextCategory)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          <Settings2 data-icon="inline-start" />
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
              <Settings2 data-icon="inline-start" />
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
                />
              ) : (
                <ProviderSettingsPanel
                  key={providerSessionKey}
                  client={client}
                  readOnly={readOnly}
                />
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
