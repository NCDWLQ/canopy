import { useProviderStore } from "@/features/providers/store"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ProviderClient } from "@/lib/tauri"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import type { LocalePreference } from "@/lib/i18n"
import { useUpdateCheck } from "../hooks/useUpdateCheck"

export type GeneralSettingsPanelProps = {
  client: ProviderClient
}

const LANGUAGE_OPTIONS: readonly {
  value: LocalePreference
  labelKey:
    | "settings.general.languageSystem"
    | "settings.general.languageZhCn"
    | "settings.general.languageEn"
}[] = [
  { value: "system", labelKey: "settings.general.languageSystem" },
  { value: "zh-CN", labelKey: "settings.general.languageZhCn" },
  { value: "en", labelKey: "settings.general.languageEn" },
]

export function GeneralSettingsPanel({ client }: GeneralSettingsPanelProps) {
  const { t } = useTranslation()
  const {
    currentVersion,
    state: updateState,
    check: checkForUpdates,
    openReleasePage,
  } = useUpdateCheck()
  const phase = useProviderStore((state) => state.phase)
  const language = useProviderStore((state) => state.language)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const setLanguage = useProviderStore((state) => state.setLanguage)

  const mutationDisabled = phase === "loading"
  const displayedVersion =
    currentVersion === null
      ? t("settings.general.versionUnavailable")
      : `v${currentVersion}`
  const updateDescription =
    updateState.kind === "loading"
      ? t("settings.general.updateCheckingStatus", {
          version: displayedVersion,
        })
      : updateState.kind === "up-to-date"
        ? t("settings.general.updateUpToDate", {
            version: `v${updateState.currentVersion}`,
          })
        : updateState.kind === "available"
          ? t("settings.general.updateAvailable", {
              version: `v${updateState.latestVersion}`,
            })
          : updateState.kind === "error"
            ? t("settings.general.updateCheckFailed", {
                version: displayedVersion,
              })
            : t("settings.general.versionDescription", {
                version: displayedVersion,
              })
  const updateActionLabel =
    updateState.kind === "available"
      ? t("settings.general.openReleasePage")
      : updateState.kind === "error"
        ? t("settings.general.retryUpdateCheck")
        : t("settings.general.updateCheck")
  const updateActionVariant =
    updateState.kind === "available" ? "default" : "outline"

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label={t("common.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>{t("common.settings")}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("settings.general.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-label={t("settings.general.title")}
          className="flex flex-col gap-4"
        >
          {storeError !== null && (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.general.updateFailed")}</AlertTitle>
              <AlertDescription>
                {commandErrorMessage(storeError.code)}
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <FieldSet>
              <Field orientation="horizontal" data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="language">
                    {t("settings.general.language")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.general.languageDescription")}
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={language}
                  disabled={mutationDisabled}
                  onValueChange={(value) =>
                    void setLanguage(client, value as LocalePreference)
                  }
                >
                  <SelectTrigger id="language" className="ml-auto w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldSet>
            <FieldSet>
              <Field orientation="horizontal" data-state={updateState.kind}>
                <FieldContent>
                  <FieldLabel>{t("settings.general.version")}</FieldLabel>
                  <FieldDescription
                    role="status"
                    aria-label={t("settings.general.updateCheckResult")}
                    aria-live="polite"
                    className={
                      updateState.kind === "available"
                        ? "font-medium text-primary"
                        : undefined
                    }
                  >
                    {updateDescription}
                  </FieldDescription>
                </FieldContent>
                <Button
                  id="check-for-updates"
                  type="button"
                  variant={updateActionVariant}
                  className="ml-auto"
                  disabled={updateState.kind === "loading"}
                  aria-busy={updateState.kind === "loading"}
                  onClick={() =>
                    void (updateState.kind === "available"
                      ? openReleasePage()
                      : checkForUpdates())
                  }
                >
                  {updateState.kind === "loading" && (
                    <Spinner
                      className="size-3.5"
                      role="presentation"
                      aria-hidden="true"
                      aria-label={undefined}
                    />
                  )}
                  {updateActionLabel}
                </Button>
              </Field>
            </FieldSet>
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}
