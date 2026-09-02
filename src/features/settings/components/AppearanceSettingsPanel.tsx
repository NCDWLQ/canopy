import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"

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
import type { ThemePreference } from "@/lib/theme"

export type AppearanceSettingsPanelProps = {
  client: ProviderClient
}

const THEME_OPTIONS: readonly {
  value: ThemePreference
  labelKey:
    | "settings.appearance.themeSystem"
    | "settings.appearance.themeLight"
    | "settings.appearance.themeDark"
  icon: LucideIcon
}[] = [
  {
    value: "system",
    labelKey: "settings.appearance.themeSystem",
    icon: Monitor,
  },
  { value: "light", labelKey: "settings.appearance.themeLight", icon: Sun },
  { value: "dark", labelKey: "settings.appearance.themeDark", icon: Moon },
]

export function AppearanceSettingsPanel({
  client,
}: AppearanceSettingsPanelProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const theme = useProviderStore((state) => state.theme)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const setTheme = useProviderStore((state) => state.setTheme)

  const mutationDisabled = phase === "loading"

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
              <BreadcrumbPage>{t("settings.appearance.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-label={t("settings.appearance.title")}
          className="flex flex-col gap-4"
        >
          {storeError !== null && (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.appearance.updateFailed")}</AlertTitle>
              <AlertDescription>
                {commandErrorMessage(storeError.code)}
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <FieldSet>
              <Field orientation="horizontal" data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="theme">
                    {t("settings.appearance.theme")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.appearance.themeDescription")}
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={theme}
                  disabled={mutationDisabled}
                  onValueChange={(value) =>
                    void setTheme(client, value as ThemePreference)
                  }
                >
                  <SelectTrigger id="theme" className="ml-auto w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                        <SelectItem key={value} value={value}>
                          <Icon aria-hidden className="text-muted-foreground" />
                          {t(labelKey)}
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
