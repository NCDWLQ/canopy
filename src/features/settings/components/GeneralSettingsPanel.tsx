import { useProviderStore } from "@/features/providers/store"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

export type GeneralSettingsPanelProps = {
  client: ProviderClient
  readOnly: boolean
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

export function GeneralSettingsPanel({
  client,
  readOnly,
}: GeneralSettingsPanelProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const language = useProviderStore((state) => state.language)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const setLanguage = useProviderStore((state) => state.setLanguage)

  const mutationDisabled = readOnly || phase === "loading"

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
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}
