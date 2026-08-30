import * as React from "react"
import { ChevronDown, EllipsisVertical, Plus, Star, Trash2 } from "lucide-react"

import { formatProviderModelsSummary } from "./formatProviderModelsSummary"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
import {
  CUSTOM_PRESET_ID,
  PROVIDER_PRESETS,
  type ProviderPresetSelection,
} from "../presets"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProviderClient } from "@/lib/tauri"
import { useTranslation } from "@/lib/i18n"

export type ProviderSettingsListProps = {
  client: ProviderClient
  readOnly: boolean
  onEdit: (
    providerId: string | null,
    presetId?: ProviderPresetSelection,
  ) => void
}

export function ProviderSettingsList({
  client,
  readOnly,
  onEdit,
}: ProviderSettingsListProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const deleteProvider = useProviderStore((state) => state.deleteProvider)
  const setActiveProvider = useProviderStore((state) => state.setActiveProvider)
  const [providerPendingDelete, setProviderPendingDelete] =
    React.useState<ProviderView | null>(null)

  const mutationDisabled = readOnly || phase === "loading"

  const handleDelete = async (providerId: string) => {
    if (mutationDisabled || providerId === activeProviderId) return
    if (!(await deleteProvider(client, providerId))) return
    setProviderPendingDelete(null)
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-labelledby="provider-list-title"
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="provider-list-title" className="font-medium">
              {t("settings.providers.allProviders")}
            </h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mutationDisabled}
                >
                  <Plus data-icon="inline-start" />
                  {t("settings.providers.create")}
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-52">
                <DropdownMenuItem
                  onSelect={() => onEdit(null, CUSTOM_PRESET_ID)}
                >
                  {t("settings.providers.presetCustom")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("settings.providers.presetMenuLabel")}
                  </DropdownMenuLabel>
                  {PROVIDER_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      onSelect={() => onEdit(null, preset.id)}
                    >
                      {t(preset.nameKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border p-1">
            {providers.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {t("settings.providers.empty")}
              </p>
            ) : (
              providers.map((provider) => {
                const isDefault = provider.id === activeProviderId
                return (
                  <div
                    key={provider.id}
                    className="flex items-center rounded-md hover:bg-muted"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 justify-start py-2 hover:bg-transparent"
                      aria-label={t("settings.providers.editAria", {
                        name: provider.name,
                      })}
                      onClick={() => onEdit(provider.id)}
                    >
                      <span className="flex w-full min-w-0 items-start gap-2">
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
                          <span className="w-full truncate">
                            {provider.name}
                          </span>
                          <span className="w-full truncate text-xs font-normal text-muted-foreground">
                            {formatProviderModelsSummary(provider.models)}
                          </span>
                        </span>
                        {isDefault && (
                          <span
                            className="shrink-0 self-center text-xs font-normal text-muted-foreground"
                            aria-label={t(
                              "settings.providers.defaultBadgeAria",
                            )}
                          >
                            {t("common.default")}
                          </span>
                        )}
                      </span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 hover:bg-transparent"
                          aria-label={t("settings.providers.moreActionsAria", {
                            name: provider.name,
                          })}
                          disabled={mutationDisabled}
                        >
                          <EllipsisVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-auto min-w-44"
                      >
                        {isDefault ? (
                          <span
                            className="flex w-full"
                            title={t("settings.providers.alreadyDefault")}
                          >
                            <DropdownMenuItem
                              disabled
                              className="w-full"
                              aria-label={t(
                                "settings.providers.setAsDefaultDisabledAria",
                              )}
                            >
                              <Star />
                              {t("settings.providers.setAsDefault")}
                            </DropdownMenuItem>
                          </span>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              void setActiveProvider(client, provider.id)
                            }
                          >
                            <Star />
                            {t("settings.providers.setAsDefault")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {isDefault ? (
                          <span
                            className="flex w-full"
                            title={t("settings.providers.deleteDisabled")}
                          >
                            <DropdownMenuItem
                              variant="destructive"
                              disabled
                              className="w-full"
                              aria-label={t(
                                "settings.providers.deleteDisabledAria",
                              )}
                            >
                              <Trash2 />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </span>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setProviderPendingDelete(provider)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
      <AlertDialog
        open={providerPendingDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setProviderPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {providerPendingDelete === null
                ? t("settings.providers.deleteTitle")
                : t("settings.providers.deleteConfirm", {
                    name: providerPendingDelete.name,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.providers.deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                mutationDisabled ||
                providerPendingDelete === null ||
                providerPendingDelete.id === activeProviderId
              }
              onClick={() => {
                if (providerPendingDelete === null) return
                void handleDelete(providerPendingDelete.id)
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
