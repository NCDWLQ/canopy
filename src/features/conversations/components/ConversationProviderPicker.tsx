import * as React from "react"
import { ChevronDown, Settings2 } from "lucide-react"

import { useProviderStore } from "@/features/providers/store"
import {
  useConversationStore,
  type ConversationProviderBinding,
} from "@/features/conversations/store"
import type { ReasoningEffort } from "@/features/providers/types"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ConversationClient } from "@/lib/tauri"
import { useTranslation } from "@/lib/i18n"

export type ConversationProviderPickerProps = {
  conversationClient: ConversationClient
  /** When true, edits update the new-conversation draft instead of IPC. */
  draftMode: boolean
  providerId: string | null
  model: string | null
  reasoningEffort: ReasoningEffort | null
  readOnly: boolean
  onManageProviders: () => void
}

export function ConversationProviderPicker({
  conversationClient,
  draftMode,
  providerId,
  model,
  reasoningEffort,
  readOnly,
  onManageProviders,
}: ConversationProviderPickerProps) {
  const { t } = useTranslation()
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const setConversationProvider = useConversationStore(
    (state) => state.setConversationProvider,
  )
  const setDraftConversationProvider = useConversationStore(
    (state) => state.setDraftConversationProvider,
  )
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Highlight uses the session binding when present; otherwise the active
  // global provider (effective). Choosing anything always snapshots.
  const highlightedProviderId = providerId ?? activeProviderId
  const highlightedProvider = providers.find(
    (item) => item.id === highlightedProviderId,
  )
  const highlightedModel = model ?? highlightedProvider?.model ?? null
  // The model options come from the provider's persisted list only — the
  // picker never fetches over the network (settings maintains the list).
  const modelOptions = highlightedProvider
    ? highlightedProvider.models.length > 0
      ? highlightedProvider.models
      : [highlightedProvider.model]
    : []

  const persist = React.useCallback(
    async (
      nextBinding: ConversationProviderBinding,
      nextEffort: ReasoningEffort | null,
    ) => {
      if (readOnly) return
      if (draftMode) {
        setDraftConversationProvider({
          binding: nextBinding,
          reasoningEffort: nextEffort,
        })
        return
      }
      if (conversationClient.setConversationProvider === undefined) return
      setSaving(true)
      try {
        await setConversationProvider(conversationClient, {
          binding: nextBinding,
          reasoningEffort: nextEffort,
        })
      } finally {
        setSaving(false)
      }
    },
    [
      conversationClient,
      draftMode,
      readOnly,
      setConversationProvider,
      setDraftConversationProvider,
    ],
  )

  const snapshotBinding = (): ConversationProviderBinding | null => {
    if (providerId !== null && model !== null) {
      return { providerId, model }
    }
    if (highlightedProviderId === null || highlightedModel === null) {
      return null
    }
    return { providerId: highlightedProviderId, model: highlightedModel }
  }

  const chooseProvider = (id: string) => {
    const provider = providers.find((item) => item.id === id)
    if (provider === undefined) return
    void persist({ providerId: id, model: provider.model }, reasoningEffort)
  }

  const chooseModel = (nextModel: string) => {
    const targetId = providerId ?? activeProviderId
    if (targetId === null) return
    void persist({ providerId: targetId, model: nextModel }, reasoningEffort)
  }

  const chooseEffort = (value: string) => {
    const nextEffort = value === "default" ? null : (value as ReasoningEffort)
    const binding = snapshotBinding()
    if (binding === null) return
    void persist(binding, nextEffort)
  }

  const effortLabels = {
    low: t("conversation.providerPicker.effortLow"),
    medium: t("conversation.providerPicker.effortMedium"),
    high: t("conversation.providerPicker.effortHigh"),
  } as const
  const effortLabel =
    reasoningEffort === null ? null : effortLabels[reasoningEffort]
  const triggerLabel =
    highlightedModel === null
      ? t("conversation.providerPicker.triggerUnconfigured")
      : effortLabel === null
        ? highlightedModel
        : `${highlightedModel} · ${effortLabel}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={readOnly}
          aria-label={t("conversation.providerPicker.open")}
        >
          <span className="max-w-40 truncate">{triggerLabel}</span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div>
          <p
            id="conversation-provider-picker-providers-label"
            className="px-1 text-xs font-medium text-muted-foreground"
          >
            {t("conversation.providerPicker.providers")}
          </p>
          <div
            role="listbox"
            aria-labelledby="conversation-provider-picker-providers-label"
            className="flex max-h-36 flex-col overflow-y-auto"
          >
            {providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                role="option"
                aria-selected={provider.id === highlightedProviderId}
                variant={
                  provider.id === highlightedProviderId ? "secondary" : "ghost"
                }
                className="w-full justify-start"
                disabled={readOnly || saving}
                onClick={() => chooseProvider(provider.id)}
              >
                <span className="flex w-full min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0 truncate">{provider.name}</span>
                  {provider.id === activeProviderId && (
                    <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                      {t("common.default")}
                    </span>
                  )}
                </span>
              </Button>
            ))}
            {providers.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t("conversation.providerPicker.noProviders")}
              </p>
            )}
          </div>
        </div>
        <Separator />
        <div>
          <p
            id="conversation-provider-picker-models-label"
            className="px-1 text-xs font-medium text-muted-foreground"
          >
            {t("conversation.providerPicker.models")}
          </p>
          <div
            role="listbox"
            aria-labelledby="conversation-provider-picker-models-label"
            className="flex max-h-36 flex-col overflow-y-auto"
          >
            {modelOptions.map((item) => (
              <Button
                key={item}
                type="button"
                role="option"
                aria-selected={item === highlightedModel}
                variant={item === highlightedModel ? "secondary" : "ghost"}
                className="w-full justify-start"
                disabled={readOnly || saving || highlightedProviderId === null}
                onClick={() => chooseModel(item)}
              >
                <span className="flex w-full min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0 truncate">{item}</span>
                  {item === highlightedProvider?.model && (
                    <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                      {t("common.default")}
                    </span>
                  )}
                </span>
              </Button>
            ))}
            {highlightedProviderId === null && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t("conversation.providerPicker.noModelsHint")}
              </p>
            )}
          </div>
        </div>
        <Separator />
        <div>
          <p className="px-1 text-xs font-medium text-muted-foreground">
            {t("conversation.providerPicker.reasoningEffort")}
          </p>
          <ToggleGroup
            type="single"
            value={reasoningEffort ?? "default"}
            onValueChange={(value) => {
              if (value) chooseEffort(value)
            }}
            size="sm"
            spacing={0}
            className="w-full"
            disabled={readOnly || saving}
          >
            <ToggleGroupItem
              value="default"
              aria-label={t("conversation.providerPicker.effortDefault")}
            >
              {t("conversation.providerPicker.effortDefault")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="low"
              aria-label={t("conversation.providerPicker.effortLow")}
            >
              {t("conversation.providerPicker.effortLow")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="medium"
              aria-label={t("conversation.providerPicker.effortMedium")}
            >
              {t("conversation.providerPicker.effortMedium")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="high"
              aria-label={t("conversation.providerPicker.effortHigh")}
            >
              {t("conversation.providerPicker.effortHigh")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Separator />
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            setOpen(false)
            onManageProviders()
          }}
        >
          <Settings2 data-icon="inline-start" />
          {t("conversation.providerPicker.manageProviders")}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
