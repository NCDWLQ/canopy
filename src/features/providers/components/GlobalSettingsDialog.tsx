import * as React from "react"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Settings2,
  Star,
  Trash2,
  EllipsisVertical,
  X,
} from "lucide-react"

import { resolveApiKeyAction } from "./apiKeyAction"
import { useProviderStore } from "../store"
import type { ModelSummaryView, ProviderProtocol, ProviderView } from "../types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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

type GlobalSettingsDialogBaseProps = {
  client: ProviderClient
  readOnly: boolean
}

export type GlobalSettingsDialogProps = GlobalSettingsDialogBaseProps &
  (
    | { open?: never; onOpenChange?: never }
    | { open: boolean; onOpenChange: (open: boolean) => void }
  )

type ProviderDraft = {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseEndpoint: string
  model: string
  models: string[]
  hasApiKey: boolean
}

type SettingsView = "list" | "edit"

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

/** Short list row summary: first few model ids, then “等 N 个” for the rest. */
function formatProviderModelsSummary(
  models: readonly string[],
  visibleCount = 2,
): string {
  if (models.length === 0) return "未添加模型"
  const shown = models.slice(0, visibleCount)
  const remaining = models.length - shown.length
  const head = shown.join(", ")
  return remaining > 0 ? `${head} 等 ${remaining} 个` : head
}

export function GlobalSettingsDialog(props: GlobalSettingsDialogProps) {
  const { client, readOnly } = props
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const saveProvider = useProviderStore((state) => state.saveProvider)
  const deleteProvider = useProviderStore((state) => state.deleteProvider)
  const setActiveProvider = useProviderStore((state) => state.setActiveProvider)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [view, setView] = React.useState<SettingsView>("list")
  const [draft, setDraft] = React.useState<ProviderDraft>(emptyDraft)
  const [apiKey, setApiKey] = React.useState("")
  // The revealed key the field was seeded with; null while unknown (new
  // provider or failed reveal) — then an empty field must read as "keep".
  const [savedApiKey, setSavedApiKey] = React.useState<string | null>(null)
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [models, setModels] = React.useState<readonly ModelSummaryView[]>([])
  const [modelsError, setModelsError] = React.useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [modelAddition, setModelAddition] = React.useState("")
  const selectedIdRef = React.useRef<string | null>(null)
  const isControlled = props.open !== undefined
  const open = isControlled ? props.open : uncontrolledOpen
  const mutationDisabled = readOnly || phase === "loading"

  const clearEphemeralKeyState = React.useCallback(() => {
    setApiKey("")
    setSavedApiKey(null)
    setShowApiKey(false)
  }, [])

  const resetToList = React.useCallback(() => {
    selectedIdRef.current = null
    setDraft(emptyDraft())
    clearEphemeralKeyState()
    setModels([])
    setModelsError(null)
    setModelAddition("")
    setView("list")
  }, [clearEphemeralKeyState])

  const openEditor = React.useCallback(
    (providerId: string | null) => {
      selectedIdRef.current = providerId
      const provider = providers.find((item) => item.id === providerId)
      setDraft(
        provider === undefined ? emptyDraft() : draftFromProvider(provider),
      )
      setApiKey("")
      setSavedApiKey(null)
      setShowApiKey(false)
      setModels([])
      setModelsError(null)
      setModelAddition("")
      setView("edit")
      if (providerId === null) return
      void client
        .revealProviderApiKey(providerId)
        .then((key) => {
          if (selectedIdRef.current !== providerId) return
          setSavedApiKey(key)
          setApiKey(key ?? "")
        })
        .catch(() => {
          // Reveal failed: leave the field empty and savedApiKey unknown so
          // saving cannot silently remove the stored key.
        })
    },
    [providers, client],
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen)
    props.onOpenChange?.(nextOpen)
    if (nextOpen) resetToList()
    else clearEphemeralKeyState()
  }

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
    if (saved !== null) openEditor(saved.id)
  }

  const handleDelete = async () => {
    if (mutationDisabled || draft.id === undefined) return
    if (await deleteProvider(client, draft.id)) resetToList()
  }

  const detailCrumbLabel =
    draft.id === undefined
      ? "新建"
      : draft.name.trim() !== ""
        ? draft.name
        : (providers.find((item) => item.id === draft.id)?.name ?? "编辑")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
        >
          <Settings2 data-icon="inline-start" />
          设置
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>工作区设置</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label="设置分类"
            className="flex flex-col gap-1 border-b p-2 md:border-r md:border-b-0"
          >
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              aria-current="page"
            >
              <Bot data-icon="inline-start" />
              模型提供商
            </Button>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center gap-1 border-b px-4 py-3 pr-12 text-sm">
              <span className="text-muted-foreground">设置</span>
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {view === "list" ? (
                <span className="font-medium text-foreground">模型提供商</span>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground"
                    aria-label="返回模型提供商列表"
                    onClick={resetToList}
                  >
                    模型提供商
                  </Button>
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {detailCrumbLabel}
                  </span>
                </>
              )}
            </div>
            {view === "list" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <section
                  aria-labelledby="provider-list-title"
                  className="flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="provider-list-title" className="font-medium">
                      模型提供商
                    </h2>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={mutationDisabled}
                      onClick={() => openEditor(null)}
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
                      providers.map((provider) => (
                        <div
                          key={provider.id}
                          className="flex items-center rounded-md hover:bg-muted"
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto min-w-0 flex-1 justify-start py-2 hover:bg-transparent"
                            aria-label={`编辑：${provider.name}`}
                            onClick={() => openEditor(provider.id)}
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
                              {provider.id === activeProviderId && (
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
                              <DropdownMenuItem
                                disabled={provider.id === activeProviderId}
                                onClick={() =>
                                  void setActiveProvider(client, provider.id)
                                }
                              >
                                <Star />
                                设为默认
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            ) : (
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
                      {draft.id === undefined
                        ? "新建模型提供商"
                        : "编辑模型提供商"}
                    </h2>
                    {storeError !== null && (
                      <Alert variant="destructive">
                        <AlertTitle>操作未完成</AlertTitle>
                        <AlertDescription>
                          {storeError.message}
                        </AlertDescription>
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
                          onChange={(event) =>
                            updateDraft("name", event.target.value)
                          }
                          disabled={mutationDisabled}
                          maxLength={100}
                          required
                        />
                      </Field>
                      <Field data-disabled={mutationDisabled}>
                        <FieldLabel>协议</FieldLabel>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            asChild
                            disabled={mutationDisabled}
                          >
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
                              onClick={() =>
                                updateDraft("protocol", "openai_compatible")
                              }
                            >
                              {draft.protocol === "openai_compatible" && (
                                <Check className="size-4" />
                              )}
                              OpenAI 兼容
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updateDraft("protocol", "anthropic")
                              }
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
                        <FieldLabel htmlFor="provider-endpoint">
                          基础端点
                        </FieldLabel>
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
                        <FieldLabel htmlFor="provider-model-add">
                          模型列表
                        </FieldLabel>
                        <div className="flex gap-2">
                          <Input
                            id="provider-model-add"
                            value={modelAddition}
                            onChange={(event) =>
                              setModelAddition(event.target.value)
                            }
                            placeholder="手动输入模型名"
                            disabled={mutationDisabled}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              mutationDisabled || !modelAddition.trim()
                            }
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
                            {modelsLoading && (
                              <Spinner data-icon="inline-start" />
                            )}
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
                              <span
                                key={model}
                                className="inline-flex items-center"
                              >
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={
                                    model === draft.model
                                      ? "secondary"
                                      : "outline"
                                  }
                                  aria-label={`设为默认：${model}`}
                                  disabled={mutationDisabled}
                                  onClick={() => updateDraft("model", model)}
                                >
                                  {model === draft.model && (
                                    <Check
                                      data-icon="inline-start"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {model}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`移除 ${model}`}
                                  disabled={
                                    mutationDisabled || draft.models.length <= 1
                                  }
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
                              .filter(
                                (model) => !draft.models.includes(model.id),
                              )
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
                                  <Plus
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />
                                  {model.displayName ?? model.id}
                                </Button>
                              ))}
                          </div>
                        )}
                      </Field>
                      <Field data-disabled={mutationDisabled}>
                        <FieldLabel htmlFor="provider-api-key">
                          API 密钥
                        </FieldLabel>
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
                              aria-label={
                                showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"
                              }
                              disabled={mutationDisabled}
                              onClick={() =>
                                setShowApiKey((visible) => !visible)
                              }
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
                    {draft.id !== undefined && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          <KeyRound data-icon="inline-start" />
                          {draft.hasApiKey
                            ? "已保存 API 密钥"
                            : "未保存 API 密钥"}
                        </Badge>
                        <Badge variant="secondary">
                          {draft.protocol === "anthropic"
                            ? "Anthropic"
                            : "OpenAI 兼容"}
                        </Badge>
                      </div>
                    )}
                  </section>
                </div>
                <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none">
                  {draft.id !== undefined && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={mutationDisabled}
                        >
                          <Trash2 data-icon="inline-start" />
                          删除
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除模型提供商？</AlertDialogTitle>
                          <AlertDialogDescription>
                            使用它的会话将回退到全局默认。删除当前全局默认后，不会自动选择替代项。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void handleDelete()}
                          >
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button
                    type="submit"
                    aria-label="保存模型提供商"
                    disabled={mutationDisabled}
                  >
                    {phase === "loading" && (
                      <Spinner data-icon="inline-start" />
                    )}
                    保存
                  </Button>
                </DialogFooter>
              </form>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
