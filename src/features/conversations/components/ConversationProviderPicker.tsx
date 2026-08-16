import * as React from "react"
import { Check, ChevronDown, Settings2 } from "lucide-react"

import { useProviderStore } from "@/features/providers/store"
import { useConversationStore } from "@/features/conversations/store"
import type { ReasoningEffort } from "@/features/providers/types"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ConversationClient } from "@/lib/tauri"

export type ConversationProviderPickerProps = {
  conversationClient: ConversationClient
  providerId: string | null
  model: string | null
  reasoningEffort: ReasoningEffort | null
  readOnly: boolean
  onManageProviders: () => void
}

export function ConversationProviderPicker({
  conversationClient,
  providerId,
  model,
  reasoningEffort,
  readOnly,
  onManageProviders,
}: ConversationProviderPickerProps) {
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const setConversationProvider = useConversationStore(
    (state) => state.setConversationProvider,
  )
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const effectiveProviderId = providerId ?? activeProviderId
  const effectiveProvider = providers.find(
    (item) => item.id === effectiveProviderId,
  )
  const effectiveModel = model ?? effectiveProvider?.model ?? null
  // The model options come from the provider's persisted list only — the
  // picker never fetches over the network (settings maintains the list).
  const modelOptions = effectiveProvider
    ? effectiveProvider.models.length > 0
      ? effectiveProvider.models
      : [effectiveProvider.model]
    : []

  const save = React.useCallback(
    async (
      nextBinding: { providerId: string; model: string } | null,
      nextEffort: ReasoningEffort | null,
    ) => {
      if (readOnly || conversationClient.setConversationProvider === undefined)
        return
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
    [conversationClient, readOnly, setConversationProvider],
  )

  const chooseProvider = (id: string) => {
    const provider = providers.find((item) => item.id === id)
    if (provider === undefined) return
    void save({ providerId: id, model: provider.model }, reasoningEffort)
  }

  const chooseModel = (nextModel: string) => {
    const targetId = providerId ?? activeProviderId
    if (targetId === null) return
    void save({ providerId: targetId, model: nextModel }, reasoningEffort)
  }

  const chooseEffort = (value: string) => {
    const nextEffort = value === "default" ? null : (value as ReasoningEffort)
    const binding =
      providerId === null || model === null ? null : { providerId, model }
    void save(binding, nextEffort)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={readOnly}
          aria-label="选择服务提供商和模型"
        >
          <span className="max-w-40 truncate">
            {effectiveProvider?.name ?? "未配置服务提供商"}
            {effectiveModel === null ? "" : ` · ${effectiveModel}`}
          </span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          服务提供商
        </p>
        <div className="flex max-h-36 flex-col overflow-y-auto">
          <Button
            type="button"
            variant={providerId === null ? "secondary" : "ghost"}
            className="justify-start"
            disabled={readOnly || saving}
            onClick={() => void save(null, reasoningEffort)}
          >
            {providerId === null && (
              <Check data-icon="inline-start" aria-hidden="true" />
            )}
            跟随全局默认
          </Button>
          {providers.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant={provider.id === providerId ? "secondary" : "ghost"}
              className="justify-start"
              disabled={readOnly || saving}
              onClick={() => chooseProvider(provider.id)}
            >
              {provider.id === providerId && (
                <Check data-icon="inline-start" aria-hidden="true" />
              )}
              {provider.name}
              <span className="ml-auto text-xs text-muted-foreground">
                {provider.model}
              </span>
            </Button>
          ))}
        </div>
        <div className="border-t pt-2">
          <p className="px-1 text-xs font-medium text-muted-foreground">模型</p>
          <div className="mt-1 flex max-h-32 flex-col overflow-y-auto">
            {modelOptions.map((item) => (
              <Button
                key={item}
                type="button"
                variant={item === effectiveModel ? "secondary" : "ghost"}
                className="justify-start"
                disabled={readOnly || saving || effectiveProviderId === null}
                onClick={() => chooseModel(item)}
              >
                {item === effectiveModel && (
                  <Check data-icon="inline-start" aria-hidden="true" />
                )}
                {item}
              </Button>
            ))}
            {effectiveProviderId === null && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                选择服务提供商后可选模型。
              </p>
            )}
          </div>
        </div>
        <div className="border-t pt-2">
          <p className="px-1 text-xs font-medium text-muted-foreground">
            推理强度
          </p>
          <ToggleGroup
            type="single"
            value={reasoningEffort ?? "default"}
            onValueChange={(value) => {
              if (value) chooseEffort(value)
            }}
            size="sm"
            spacing={0}
            className="mt-1 w-full"
            disabled={readOnly || saving}
          >
            <ToggleGroupItem value="default" aria-label="默认">
              默认
            </ToggleGroupItem>
            <ToggleGroupItem value="low" aria-label="低">
              低
            </ToggleGroupItem>
            <ToggleGroupItem value="medium" aria-label="中">
              中
            </ToggleGroupItem>
            <ToggleGroupItem value="high" aria-label="高">
              高
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="border-t pt-2">
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
            管理服务提供商…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
