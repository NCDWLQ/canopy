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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ProviderClient } from "@/lib/tauri"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import {
  isThemeColorPreference,
  THEME_COLORS,
  type ThemeColorPreference,
  type ThemePreference,
} from "@/lib/theme"

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

const THEME_COLOR_LABEL_KEYS = {
  neutral: "settings.appearance.themeColorNeutral",
  blue: "settings.appearance.themeColorBlue",
  green: "settings.appearance.themeColorGreen",
  orange: "settings.appearance.themeColorOrange",
  red: "settings.appearance.themeColorRed",
  rose: "settings.appearance.themeColorRose",
  violet: "settings.appearance.themeColorViolet",
} as const satisfies Record<
  ThemeColorPreference,
  | "settings.appearance.themeColorNeutral"
  | "settings.appearance.themeColorBlue"
  | "settings.appearance.themeColorGreen"
  | "settings.appearance.themeColorOrange"
  | "settings.appearance.themeColorRed"
  | "settings.appearance.themeColorRose"
  | "settings.appearance.themeColorViolet"
>

function ThemeColorSwatch({ color }: { color: ThemeColorPreference }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full border border-border/60"
      style={{
        backgroundColor: `var(--theme-color-${color}-primary)`,
      }}
    />
  )
}

export function AppearanceSettingsPanel({
  client,
}: AppearanceSettingsPanelProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const theme = useProviderStore((state) => state.theme)
  const themeColor = useProviderStore((state) => state.themeColor)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const setTheme = useProviderStore((state) => state.setTheme)
  const setThemeColor = useProviderStore((state) => state.setThemeColor)

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
                  <FieldLabel id="theme-label">
                    {t("settings.appearance.theme")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.appearance.themeDescription")}
                  </FieldDescription>
                </FieldContent>
                <ToggleGroup
                  type="single"
                  value={theme}
                  disabled={mutationDisabled}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  className="ml-auto"
                  aria-labelledby="theme-label"
                  onValueChange={(value) => {
                    if (value) void setTheme(client, value as ThemePreference)
                  }}
                >
                  {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                    <ToggleGroupItem
                      key={value}
                      value={value}
                      aria-label={t(labelKey)}
                    >
                      <Icon data-icon="inline-start" aria-hidden />
                      {t(labelKey)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field orientation="horizontal" data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="theme-color">
                    {t("settings.appearance.themeColor")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.appearance.themeColorDescription")}
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={themeColor}
                  disabled={mutationDisabled}
                  onValueChange={(value) => {
                    if (isThemeColorPreference(value)) {
                      void setThemeColor(client, value)
                    }
                  }}
                >
                  <SelectTrigger id="theme-color" className="ml-auto w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="end">
                    <SelectGroup>
                      {THEME_COLORS.map((color) => (
                        <SelectItem key={color} value={color}>
                          <span className="flex items-center gap-2">
                            <ThemeColorSwatch color={color} />
                            {t(THEME_COLOR_LABEL_KEYS[color])}
                          </span>
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
