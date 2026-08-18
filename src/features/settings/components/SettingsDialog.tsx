import * as React from "react"
import { Bot, HeartPulse, MessageSquare, Settings2 } from "lucide-react"

import { ConversationSettingsPanel } from "./ConversationSettingsPanel"
import { DiagnosticsPanel } from "./DiagnosticsPanel"
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
import type { DiagnosticsClient, ProviderClient } from "@/lib/tauri"

type SettingsDialogBaseProps = {
  client: ProviderClient
  diagnosticsClient?: DiagnosticsClient
  readOnly: boolean
}

export type SettingsDialogProps = SettingsDialogBaseProps &
  (
    | { open?: never; onOpenChange?: never }
    | { open: boolean; onOpenChange: (open: boolean) => void }
  )

type SettingsCategory = "providers" | "conversation" | "diagnostics"

export function SettingsDialog(props: SettingsDialogProps) {
  const { client, diagnosticsClient, readOnly } = props
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [category, setCategory] = React.useState<SettingsCategory>("providers")
  const [providerSessionKey, setProviderSessionKey] = React.useState(0)

  const isControlled = props.open !== undefined
  const open = isControlled ? props.open : uncontrolledOpen
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setCategory("providers")
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
          设置
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>工作区设置</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label="设置分类"
            className="flex flex-col gap-1 border-b p-2 md:border-r md:border-b-0"
          >
            <Button
              type="button"
              variant={category === "providers" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "providers" ? "page" : undefined}
              onClick={() => selectCategory("providers")}
            >
              <Bot data-icon="inline-start" />
              模型提供商
            </Button>
            <Button
              type="button"
              variant={category === "conversation" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "conversation" ? "page" : undefined}
              onClick={() => selectCategory("conversation")}
            >
              <MessageSquare data-icon="inline-start" />
              会话
            </Button>
            <Button
              type="button"
              variant={category === "diagnostics" ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={category === "diagnostics" ? "page" : undefined}
              onClick={() => selectCategory("diagnostics")}
            >
              <HeartPulse data-icon="inline-start" />
              诊断
            </Button>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-col">
            {open &&
              (category === "conversation" ? (
                <ConversationSettingsPanel
                  client={client}
                  readOnly={readOnly}
                />
              ) : category === "diagnostics" ? (
                <DiagnosticsPanel client={diagnosticsClient} />
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
