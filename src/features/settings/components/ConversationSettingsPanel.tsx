import * as React from "react"
import { toast } from "sonner"

import { useProviderStore } from "@/features/providers/store"
import type { TitleModelBinding } from "@/features/providers/types"
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
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { ProviderClient } from "@/lib/tauri"
import { trimRustWhitespace } from "@/lib/tauri/schemas"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"

const FOLLOW_SESSION_TITLE_MODEL = "follow"

function titleModelBindingValue(binding: TitleModelBinding): string {
  return `${binding.providerId}\u001f${binding.model}`
}

function parseTitleModelValue(value: string): TitleModelBinding | null {
  if (value === FOLLOW_SESSION_TITLE_MODEL) return null
  const separator = value.indexOf("\u001f")
  if (separator === -1) return null
  return {
    providerId: value.slice(0, separator),
    model: value.slice(separator + 1),
  }
}

export type ConversationSettingsPanelProps = {
  client: ProviderClient
  readOnly: boolean
  onDirtyChange?: (dirty: boolean) => void
}

export function ConversationSettingsPanel({
  client,
  readOnly,
  onDirtyChange,
}: ConversationSettingsPanelProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const autoGenerateTitle = useProviderStore((state) => state.autoGenerateTitle)
  const titleModelBinding = useProviderStore((state) => state.titleModelBinding)
  const defaultSystemPrompt = useProviderStore(
    (state) => state.defaultSystemPrompt,
  )
  const setAutoGenerateTitle = useProviderStore(
    (state) => state.setAutoGenerateTitle,
  )
  const setTitleModelBinding = useProviderStore(
    (state) => state.setTitleModelBinding,
  )
  const setDefaultSystemPrompt = useProviderStore(
    (state) => state.setDefaultSystemPrompt,
  )
  const [promptEdit, setPromptEdit] = React.useState<string | null>(null)
  const promptDraft = promptEdit ?? defaultSystemPrompt ?? ""
  const promptDirty =
    trimRustWhitespace(promptDraft) !== (defaultSystemPrompt ?? "")

  React.useEffect(() => {
    onDirtyChange?.(promptDirty)
  }, [promptDirty, onDirtyChange])

  const saveSystemPrompt = async () => {
    const trimmed = trimRustWhitespace(promptDraft)
    await setDefaultSystemPrompt(client, trimmed.length === 0 ? null : trimmed)
    // Failure surfaces through the storeError alert above; keep the draft so
    // the user can retry.
    if (useProviderStore.getState().phase === "error") return
    setPromptEdit(null)
    toast.success(t("settings.conversation.systemPromptSaved"))
  }

  const mutationDisabled = readOnly || phase === "loading"
  const titleModelValue =
    titleModelBinding === null
      ? FOLLOW_SESSION_TITLE_MODEL
      : titleModelBindingValue(titleModelBinding)

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
              <BreadcrumbPage>
                {t("settings.conversation.title")}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-label={t("settings.conversation.title")}
          className="flex flex-col gap-4"
        >
          {storeError !== null && (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.conversation.updateFailed")}</AlertTitle>
              <AlertDescription>
                {commandErrorMessage(storeError.code)}
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <FieldSet>
              <Field orientation="horizontal" data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="auto-generate-title">
                    {t("settings.conversation.autoGenerateTitle")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.conversation.autoGenerateTitleDescription")}
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="auto-generate-title"
                  className="ml-auto"
                  checked={autoGenerateTitle}
                  disabled={mutationDisabled}
                  onCheckedChange={(checked) =>
                    void setAutoGenerateTitle(client, checked)
                  }
                />
              </Field>
              <Field
                className="pl-4"
                data-disabled={mutationDisabled || !autoGenerateTitle}
              >
                <FieldLabel htmlFor="title-model">
                  {t("settings.conversation.titleModel")}
                </FieldLabel>
                <Select
                  value={titleModelValue}
                  disabled={mutationDisabled || !autoGenerateTitle}
                  onValueChange={(value) =>
                    void setTitleModelBinding(
                      client,
                      parseTitleModelValue(value),
                    )
                  }
                >
                  <SelectTrigger id="title-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectGroup>
                      <SelectItem value={FOLLOW_SESSION_TITLE_MODEL}>
                        {t("settings.conversation.followSession")}
                      </SelectItem>
                    </SelectGroup>
                    {providers.some(
                      (provider) => provider.models.length > 0,
                    ) && <SelectSeparator />}
                    {providers.map((provider) =>
                      provider.models.length === 0 ? null : (
                        <SelectGroup key={provider.id}>
                          <SelectLabel>{provider.name}</SelectLabel>
                          {provider.models.map((model) => (
                            <SelectItem
                              key={`${provider.id}:${model}`}
                              value={titleModelBindingValue({
                                providerId: provider.id,
                                model,
                              })}
                            >
                              {model}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="default-system-prompt">
                    {t("settings.conversation.defaultSystemPrompt")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.conversation.defaultSystemPromptDescription")}
                  </FieldDescription>
                </FieldContent>
                <Textarea
                  id="default-system-prompt"
                  value={promptDraft}
                  disabled={mutationDisabled}
                  placeholder={t(
                    "settings.conversation.defaultSystemPromptPlaceholder",
                  )}
                  onChange={(event) => setPromptEdit(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={mutationDisabled || !promptDirty}
                  onClick={() => void saveSystemPrompt()}
                >
                  {t("settings.conversation.saveDefaultSystemPrompt")}
                </Button>
              </Field>
            </FieldSet>
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}
