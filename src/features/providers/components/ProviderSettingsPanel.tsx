import * as React from "react"

import { ProviderSettingsEditor } from "./ProviderSettingsEditor"
import { ProviderSettingsList } from "./ProviderSettingsList"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import type { ProviderClient } from "@/lib/tauri"

export type ProviderSettingsPanelProps = {
  client: ProviderClient
  readOnly: boolean
}

type ProviderRoute =
  { view: "list" } | { view: "edit"; providerId: string | null }

export function ProviderSettingsPanel({
  client,
  readOnly,
}: ProviderSettingsPanelProps) {
  const [route, setRoute] = React.useState<ProviderRoute>({ view: "list" })
  const providers = useProviderStore((state) => state.providers)
  const [detailCrumbLabel, setDetailCrumbLabel] = React.useState("编辑")

  const goToList = React.useCallback(() => {
    setRoute({ view: "list" })
  }, [])

  const goToEdit = React.useCallback(
    (providerId: string | null) => {
      setRoute({ view: "edit", providerId })
      if (providerId === null) {
        setDetailCrumbLabel("新建")
        return
      }
      const found = providers.find((item) => item.id === providerId)
      setDetailCrumbLabel(found?.name ?? "编辑")
    },
    [providers],
  )

  const handleSaved = React.useCallback((saved: ProviderView) => {
    setRoute({ view: "edit", providerId: saved.id })
    setDetailCrumbLabel(saved.name.trim() !== "" ? saved.name : "编辑")
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label="面包屑">
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>设置</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {route.view === "list" ? (
              <BreadcrumbItem>
                <BreadcrumbPage>模型提供商</BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      aria-label="返回模型提供商列表"
                      onClick={goToList}
                    >
                      模型提供商
                    </button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">
                    {detailCrumbLabel}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {route.view === "list" ? (
        <ProviderSettingsList
          client={client}
          readOnly={readOnly}
          onEdit={goToEdit}
        />
      ) : (
        <ProviderSettingsEditor
          key={route.providerId ?? "new"}
          client={client}
          readOnly={readOnly}
          providerId={route.providerId}
          onBack={goToList}
          onSaved={handleSaved}
          onDetailLabelChange={setDetailCrumbLabel}
        />
      )}
    </div>
  )
}
