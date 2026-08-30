import * as React from "react"

import {
  ProviderSettingsEditor,
  type ProviderDetailCrumb,
} from "./ProviderSettingsEditor"
import { ProviderSettingsList } from "./ProviderSettingsList"
import { useProviderStore } from "../store"
import type { ProviderView } from "../types"
import { CUSTOM_PRESET_ID, type ProviderPresetSelection } from "../presets"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { ProviderClient } from "@/lib/tauri"
import { useTranslation } from "@/lib/i18n"

export type ProviderSettingsPanelProps = {
  client: ProviderClient
  readOnly: boolean
  onDirtyChange?: (dirty: boolean) => void
}

type ProviderRoute =
  | { view: "list" }
  | {
      view: "edit"
      providerId: string | null
      presetId: ProviderPresetSelection
    }

export function ProviderSettingsPanel({
  client,
  readOnly,
  onDirtyChange,
}: ProviderSettingsPanelProps) {
  const { t } = useTranslation()
  const [route, setRoute] = React.useState<ProviderRoute>({ view: "list" })
  const [editorDirty, setEditorDirty] = React.useState(false)
  const [confirmBackToList, setConfirmBackToList] = React.useState(false)
  const providers = useProviderStore((state) => state.providers)
  // Stored as a semantic value, not rendered text, so a locale switch derives
  // the label fresh from `t()` instead of replaying the previous language.
  const [detailCrumb, setDetailCrumb] = React.useState<ProviderDetailCrumb>({
    kind: "editFallback",
  })

  const detailCrumbLabel =
    detailCrumb.kind === "new"
      ? t("settings.providers.crumbNew")
      : detailCrumb.kind === "name"
        ? detailCrumb.name
        : t("settings.providers.crumbEdit")

  const goToList = React.useCallback(() => {
    if (editorDirty) {
      setConfirmBackToList(true)
      return
    }
    setRoute({ view: "list" })
  }, [editorDirty])

  const confirmGoToList = React.useCallback(() => {
    setConfirmBackToList(false)
    setEditorDirty(false)
    setRoute({ view: "list" })
  }, [])

  const goToEdit = React.useCallback(
    (
      providerId: string | null,
      presetId: ProviderPresetSelection = CUSTOM_PRESET_ID,
    ) => {
      setEditorDirty(false)
      setRoute({ view: "edit", providerId, presetId })
      if (providerId === null) {
        setDetailCrumb({ kind: "new" })
        return
      }
      const found = providers.find((item) => item.id === providerId)
      setDetailCrumb(
        found === undefined
          ? { kind: "editFallback" }
          : { kind: "name", name: found.name },
      )
    },
    [providers],
  )

  const handleSaved = React.useCallback((saved: ProviderView) => {
    setRoute({
      view: "edit",
      providerId: saved.id,
      presetId: CUSTOM_PRESET_ID,
    })
    setDetailCrumb(
      saved.name.trim() !== ""
        ? { kind: "name", name: saved.name }
        : { kind: "editFallback" },
    )
  }, [])

  const panelDirty = route.view === "edit" && editorDirty

  React.useEffect(() => {
    onDirtyChange?.(panelDirty)
  }, [panelDirty, onDirtyChange])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label={t("common.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>{t("common.settings")}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            {route.view === "list" ? (
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {t("settings.providers.backToList")}
                </BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <button
                      type="button"
                      aria-label={t("settings.providers.backToListAria")}
                      onClick={goToList}
                    >
                      {t("settings.providers.backToList")}
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
          key={route.providerId ?? `new-${route.presetId}`}
          client={client}
          readOnly={readOnly}
          providerId={route.providerId}
          initialPresetId={route.presetId}
          onBack={goToList}
          onSaved={handleSaved}
          onDetailCrumbChange={setDetailCrumb}
          onDirtyChange={setEditorDirty}
        />
      )}
      <ConfirmDialog
        open={confirmBackToList}
        title={t("common.unsavedChangesTitle")}
        description={t("common.unsavedChangesBody")}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("common.discard")}
        destructive
        onCancel={() => setConfirmBackToList(false)}
        onConfirm={confirmGoToList}
      />
    </div>
  )
}
