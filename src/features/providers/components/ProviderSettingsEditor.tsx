import * as React from "react"
import { Check, ChevronDown, Eye, EyeOff, Plus, X } from "lucide-react"

import { resolveApiKeyAction } from "./apiKeyAction"
import { useProviderStore } from "../store"
import type { ModelSummaryView, ProviderProtocol, ProviderView } from "../types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProviderClient } from "@/lib/tauri"

type ProviderDraft = {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseEndpoint: string
  model: string
  models: string[]
  hasApiKey: boolean
}

export type ProviderSettingsEditorProps = {
  client: ProviderClient
  readOnly: boolean
  providerId: string | null
  onBack: () => void
  onSaved: (provider: ProviderView) => void
  onDetailLabelChange: (label: string) => void
}

const emptyDraft = (): ProviderDraft => ({
  name: "",
  protocol: "openai_compatible",
  baseEndpoint: "",
  model: "",
  models: [],
  hasApiKey: false,
})

function draftFromProvider(provider: ProviderView): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseEndpoint: provider.baseEndpoint,
    model: provider.model,
    models: [...provider.models],
    hasApiKey: provider.hasApiKey,
  }
}

function createInitialDraft(providerId: string | null): ProviderDraft {
  if (providerId === null) return emptyDraft()
  const provider = useProviderStore
    .getState()
    .providers.find((item) => item.id === providerId)
  return provider === undefined ? emptyDraft() : draftFromProvider(provider)
}

export function ProviderSettingsEditor({
  client,
  readOnly,
  providerId,
  onBack,
  onSaved,
  onDetailLabelChange,
}: ProviderSettingsEditorProps) {
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const saveProvider = useProviderStore((state) => state.saveProvider)

  const mutationDisabled = readOnly || phase === "loading"

  const [draft, setDraft] = React.useState<ProviderDraft>(() =>
    createInitialDraft(providerId),
  )
  const [apiKey, setApiKey] = React.useState("")
  const [savedApiKey, setSavedApiKey] = React.useState<string | null>(null)
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [models, setModels] = React.useState<readonly ModelSummaryView[]>([])
  const [modelsError, setModelsError] = React.useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [modelAddition, setModelAddition] = React.useState("")
  const revealRequestIdRef = React.useRef(0)

  React.useEffect(() => {
    if (providerId === null) return

    const requestId = ++revealRequestIdRef.current
    void client
      .revealProviderApiKey(providerId)
      .then((key) => {
        if (revealRequestIdRef.current !== requestId) return
        setSavedApiKey(key)
        setApiKey(key ?? "")
      })
      .catch(() => {
        // Reveal failed: leave the field empty and savedApiKey unknown so
        // saving cannot silently remove the stored key.
      })

    return () => {
      revealRequestIdRef.current += 1
    }
  }, [providerId, client])

  React.useEffect(() => {
    if (draft.id === undefined) {
      onDetailLabelChange("新建")
      return
    }
    if (draft.name.trim() !== "") {
      onDetailLabelChange(draft.name)
      return
    }
    const found = providers.find((item) => item.id === draft.id)
    onDetailLabelChange(found?.name ?? "编辑")
  }, [draft.id, draft.name, providers, onDetailLabelChange])

  const updateDraft = <K extends keyof ProviderDraft>(
    key: K,
    value: ProviderDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }))

  const fetchModels = async () => {
    if (mutationDisabled || !draft.baseEndpoint.trim()) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const result = await client.listProviderModels({
        type: "draft",
        protocol: draft.protocol,
        baseEndpoint: draft.baseEndpoint,
        ...(apiKey === "" ? {} : { apiKey }),
      })
      setModels(result)
    } catch (error: unknown) {
      setModelsError(
        error instanceof Error ? error.message : "获取模型列表失败。",
      )
    } finally {
      setModelsLoading(false)
    }
  }

  const addModel = (raw: string) => {
    const model = raw.trim()
    if (model === "" || mutationDisabled) return
    setDraft((current) => {
      if (current.models.includes(model)) return current
      const nextModels = [...current.models, model]
      return {
        ...current,
        models: nextModels,
        model: current.model === "" ? model : current.model,
      }
    })
    setModelAddition("")
  }

  const removeModel = (model: string) => {
    if (mutationDisabled) return
    setDraft((current) => {
      if (current.models.length <= 1) return current
      const nextModels = current.models.filter((item) => item !== model)
      return {
        ...current,
        models: nextModels,
        model: current.model === model ? (nextModels[0] ?? "") : current.model,
      }
    })
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutationDisabled) return
    const existing =
      draft.id === undefined
        ? null
        : (providers.find((item) => item.id === draft.id) ?? null)
    const saved = await saveProvider(client, {
      ...(draft.id === undefined ? {} : { id: draft.id }),
      name: draft.name,
      protocol: draft.protocol,
      baseEndpoint: draft.baseEndpoint,
      model: draft.model,
      models: draft.models,
      apiKey: resolveApiKeyAction(existing, apiKey, savedApiKey),
    })
    if (saved !== null) {
      onSaved(saved)
      setDraft(draftFromProvider(saved))
      setApiKey("")
      setSavedApiKey(null)
      setShowApiKey(false)
      setModels([])
      setModelsError(null)
      setModelAddition("")
      const requestId = ++revealRequestIdRef.current
      void client
        .revealProviderApiKey(saved.id)
        .then((key) => {
          if (revealRequestIdRef.current !== requestId) return
          setSavedApiKey(key)
          setApiKey(key ?? "")
        })
        .catch(() => {
          // Reveal failed: leave the field empty and savedApiKey unknown so
          // saving cannot silently remove the stored key.
        })
    }
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-labelledby="provider-settings-title"
          className="flex min-w-0 flex-col gap-4"
        >
          <h2 id="provider-settings-title" className="font-medium">
            {draft.id === undefined ? "新建模型提供商" : "编辑模型提供商"}
          </h2>
          {storeError !== null && (
            <Alert variant="destructive">
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{storeError.message}</AlertDescription>
            </Alert>
          )}
          {readOnly && (
            <Alert>
              <AlertTitle>只读</AlertTitle>
              <AlertDescription>
                查看已归档会话时无法修改模型提供商设置。
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-name">名称</FieldLabel>
              <Input
                id="provider-name"
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
                disabled={mutationDisabled}
                maxLength={100}
                required
              />
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel>协议</FieldLabel>
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={mutationDisabled}>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={mutationDisabled}
                  >
                    {draft.protocol === "anthropic"
                      ? "Anthropic Messages"
                      : "OpenAI 兼容"}
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  <DropdownMenuItem
                    onClick={() => updateDraft("protocol", "openai_compatible")}
                  >
                    {draft.protocol === "openai_compatible" && (
                      <Check className="size-4" />
                    )}
                    OpenAI 兼容
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => updateDraft("protocol", "anthropic")}
                  >
                    {draft.protocol === "anthropic" && (
                      <Check className="size-4" />
                    )}
                    Anthropic Messages
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-endpoint">基础端点</FieldLabel>
              <Input
                id="provider-endpoint"
                type="url"
                value={draft.baseEndpoint}
                onChange={(event) =>
                  updateDraft("baseEndpoint", event.target.value)
                }
                placeholder={
                  draft.protocol === "anthropic"
                    ? "https://api.anthropic.com"
                    : "https://api.example.com/v1"
                }
                disabled={mutationDisabled}
                required
              />
              {draft.protocol === "anthropic" && (
                <FieldDescription>
                  Anthropic 兼容网关需带各自前缀，如 DeepSeek 填
                  https://api.deepseek.com/anthropic。
                </FieldDescription>
              )}
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-model-add">模型列表</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="provider-model-add"
                  value={modelAddition}
                  onChange={(event) => setModelAddition(event.target.value)}
                  placeholder="手动输入模型名"
                  disabled={mutationDisabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutationDisabled || !modelAddition.trim()}
                  onClick={() => addModel(modelAddition)}
                >
                  添加
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    mutationDisabled ||
                    modelsLoading ||
                    !draft.baseEndpoint.trim()
                  }
                  onClick={() => void fetchModels()}
                >
                  {modelsLoading && <Spinner data-icon="inline-start" />}
                  获取模型列表
                </Button>
              </div>
              {modelsError !== null && (
                <FieldDescription className="text-destructive">
                  {modelsError}
                </FieldDescription>
              )}
              {draft.models.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {draft.models.map((model) => (
                    <span key={model} className="inline-flex items-center">
                      <Button
                        type="button"
                        size="xs"
                        variant={
                          model === draft.model ? "secondary" : "outline"
                        }
                        aria-label={`设为默认：${model}`}
                        disabled={mutationDisabled}
                        onClick={() => updateDraft("model", model)}
                      >
                        {model === draft.model && (
                          <Check data-icon="inline-start" aria-hidden="true" />
                        )}
                        {model}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`移除 ${model}`}
                        disabled={mutationDisabled || draft.models.length <= 1}
                        onClick={() => removeModel(model)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              {models.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {models
                    .filter((model) => !draft.models.includes(model.id))
                    .map((model) => (
                      <Button
                        key={model.id}
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label={`加入模型：${model.id}`}
                        disabled={mutationDisabled}
                        onClick={() => addModel(model.id)}
                      >
                        <Plus data-icon="inline-start" aria-hidden="true" />
                        {model.displayName ?? model.id}
                      </Button>
                    ))}
                </div>
              )}
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-api-key">API 密钥</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="provider-api-key"
                  type={showApiKey ? "text" : "password"}
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    draft.id !== undefined && draft.hasApiKey
                      ? undefined
                      : "可选"
                  }
                  disabled={mutationDisabled}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                    disabled={mutationDisabled}
                    onClick={() => setShowApiKey((visible) => !visible)}
                  >
                    {showApiKey ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>
        </section>
      </div>
      <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none">
        <Button type="button" variant="outline" onClick={onBack}>
          取消
        </Button>
        <Button
          type="submit"
          aria-label="保存模型提供商"
          disabled={mutationDisabled}
        >
          保存
        </Button>
      </DialogFooter>
    </form>
  )
}
