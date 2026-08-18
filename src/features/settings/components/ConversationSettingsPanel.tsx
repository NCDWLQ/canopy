import { useProviderStore } from "@/features/providers/store"
import type { TitleModelBinding } from "@/features/providers/types"
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
import { Switch } from "@/components/ui/switch"
import type { ProviderClient } from "@/lib/tauri"

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
}

export function ConversationSettingsPanel({
  client,
  readOnly,
}: ConversationSettingsPanelProps) {
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const autoGenerateTitle = useProviderStore((state) => state.autoGenerateTitle)
  const titleModelBinding = useProviderStore((state) => state.titleModelBinding)
  const setAutoGenerateTitle = useProviderStore(
    (state) => state.setAutoGenerateTitle,
  )
  const setTitleModelBinding = useProviderStore(
    (state) => state.setTitleModelBinding,
  )

  const mutationDisabled = readOnly || phase === "loading"
  const titleModelValue =
    titleModelBinding === null
      ? FOLLOW_SESSION_TITLE_MODEL
      : titleModelBindingValue(titleModelBinding)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label="面包屑">
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>设置</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>会话</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-labelledby="conversation-settings-title"
          className="flex flex-col gap-4"
        >
          <h2 id="conversation-settings-title" className="font-medium">
            会话
          </h2>
          <FieldGroup>
            <FieldSet>
              <Field orientation="horizontal" data-disabled={mutationDisabled}>
                <FieldContent>
                  <FieldLabel htmlFor="auto-generate-title">
                    自动生成标题
                  </FieldLabel>
                  <FieldDescription>
                    首轮对话后，使用下方配置的模型自动生成标题
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
                <FieldLabel htmlFor="title-model">标题模型</FieldLabel>
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
                        跟随会话
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
            </FieldSet>
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}
