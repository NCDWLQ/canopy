import * as React from "react"
import { EllipsisVertical, Plus, Star, Trash2 } from "lucide-react"

import { formatProviderModelsSummary } from "./formatProviderModelsSummary"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProviderClient } from "@/lib/tauri"

export type ProviderSettingsListProps = {
  client: ProviderClient
  readOnly: boolean
  onEdit: (providerId: string | null) => void
}

export function ProviderSettingsList({
  client,
  readOnly,
  onEdit,
}: ProviderSettingsListProps) {
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
              全部提供商
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={mutationDisabled}
              onClick={() => onEdit(null)}
            >
              <Plus data-icon="inline-start" />
              新建
            </Button>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border p-1">
            {providers.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                尚未添加模型提供商。
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
                      aria-label={`编辑：${provider.name}`}
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
                            aria-label="当前全局默认"
                          >
                            默认
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
                          aria-label={`更多操作：${provider.name}`}
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
                            title="已是当前默认提供商"
                          >
                            <DropdownMenuItem
                              disabled
                              className="w-full"
                              aria-label="设为默认（已是当前默认提供商）"
                            >
                              <Star />
                              设为默认
                            </DropdownMenuItem>
                          </span>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              void setActiveProvider(client, provider.id)
                            }
                          >
                            <Star />
                            设为默认
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        {isDefault ? (
                          <span
                            className="flex w-full"
                            title="当前为默认提供商，无法删除"
                          >
                            <DropdownMenuItem
                              variant="destructive"
                              disabled
                              className="w-full"
                              aria-label="删除（当前为默认提供商，无法删除）"
                            >
                              <Trash2 />
                              删除
                            </DropdownMenuItem>
                          </span>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setProviderPendingDelete(provider)}
                          >
                            <Trash2 />
                            删除
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
                ? "删除模型提供商？"
                : `删除「${providerPendingDelete.name}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              使用它的会话将回退到全局默认。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
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
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
