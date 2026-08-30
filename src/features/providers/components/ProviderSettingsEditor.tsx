import * as React from "react"
import { Eye, EyeOff, Plus, X } from "lucide-react"
import { toast } from "sonner"

import { resolveApiKeyAction } from "./apiKeyAction"
import { ProviderPresetIcon } from "./ProviderPresetIcon"
import { useProviderStore } from "../store"
import type { ModelSummaryView, ProviderProtocol, ProviderView } from "../types"
import {
  CUSTOM_PRESET_ID,
  findProviderPreset,
  isProviderPresetId,
  PROVIDER_PRESETS,
  type ProviderPresetSelection,
} from "../presets"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/reui/badge"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ConversationCommandError, type ProviderClient } from "@/lib/tauri"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"

type ProviderDraft = {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseEndpoint: string
  model: string
  models: string[]
  hasApiKey: boolean
}

/**
 * Semantic breadcrumb detail for the editor route: a new-provider draft, a
 * concrete provider name (user data, never localized), or the edit fallback.
 * Derived into text at render time so locale switches re-translate instantly.
 */
export type ProviderDetailCrumb =
  { kind: "new" } | { kind: "name"; name: string } | { kind: "editFallback" }

export type ProviderSettingsEditorProps = {
  client: ProviderClient
  readOnly: boolean
  providerId: string | null
  initialPresetId?: ProviderPresetSelection
  onBack: () => void
  onSaved: (provider: ProviderView) => void
  onDetailCrumbChange: (crumb: ProviderDetailCrumb) => void
  onDirtyChange?: (dirty: boolean) => void
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

function createInitialDraft(
  providerId: string | null,
  initialPresetId: ProviderPresetSelection,
  presetName: string,
): ProviderDraft {
  if (providerId === null) {
    if (initialPresetId === CUSTOM_PRESET_ID) return emptyDraft()
    const preset = findProviderPreset(initialPresetId)
    if (preset === undefined) return emptyDraft()
    return {
      name: presetName,
      protocol: preset.protocol,
      baseEndpoint: preset.baseEndpoint,
      model: "",
      models: [],
      hasApiKey: false,
    }
  }
  const provider = useProviderStore
    .getState()
    .providers.find((item) => item.id === providerId)
  return provider === undefined ? emptyDraft() : draftFromProvider(provider)
}

export function ProviderSettingsEditor({
  client,
  readOnly,
  providerId,
  initialPresetId = CUSTOM_PRESET_ID,
  onBack,
  onSaved,
  onDetailCrumbChange,
  onDirtyChange,
}: ProviderSettingsEditorProps) {
  const { t } = useTranslation()
  const phase = useProviderStore((state) => state.phase)
  const providers = useProviderStore((state) => state.providers)
  const storeError = useProviderStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const saveProvider = useProviderStore((state) => state.saveProvider)

  const mutationDisabled = readOnly || phase === "loading"
  const isNewProvider = providerId === null
  let initialPresetName = ""
  if (initialPresetId !== CUSTOM_PRESET_ID) {
    const preset = findProviderPreset(initialPresetId)
    if (preset !== undefined) initialPresetName = t(preset.nameKey)
  }

  const [selectedPresetId, setSelectedPresetId] =
    React.useState<ProviderPresetSelection>(initialPresetId)
  const [draft, setDraft] = React.useState<ProviderDraft>(() =>
    createInitialDraft(providerId, initialPresetId, initialPresetName),
  )
  // Baseline for dirty tracking: the draft as mounted or last saved.
  const [savedDraft, setSavedDraft] = React.useState<ProviderDraft>(() =>
    createInitialDraft(providerId, initialPresetId, initialPresetName),
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
      onDetailCrumbChange({ kind: "new" })
      return
    }
    if (draft.name.trim() !== "") {
      onDetailCrumbChange({ kind: "name", name: draft.name })
      return
    }
    const found = providers.find((item) => item.id === draft.id)
    onDetailCrumbChange(
      found === undefined
        ? { kind: "editFallback" }
        : { kind: "name", name: found.name },
    )
  }, [draft.id, draft.name, providers, onDetailCrumbChange])

  const updateDraft = <K extends keyof ProviderDraft>(
    key: K,
    value: ProviderDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }))

  const draftDirty =
    draft.name !== savedDraft.name ||
    draft.protocol !== savedDraft.protocol ||
    draft.baseEndpoint !== savedDraft.baseEndpoint ||
    draft.model !== savedDraft.model ||
    draft.models.length !== savedDraft.models.length ||
    draft.models.some((model, index) => savedDraft.models[index] !== model)
  const editorDirty =
    draftDirty || apiKey !== (savedApiKey ?? "") || modelAddition.trim() !== ""

  React.useEffect(() => {
    onDirtyChange?.(editorDirty)
  }, [editorDirty, onDirtyChange])

  const applyPresetSelection = (presetId: ProviderPresetSelection) => {
    setSelectedPresetId(presetId)
    if (presetId === CUSTOM_PRESET_ID) {
      setDraft((current) => ({
        ...emptyDraft(),
        hasApiKey: current.hasApiKey,
      }))
      setModels([])
      setModelsError(null)
      return
    }
    const preset = findProviderPreset(presetId)
    if (preset === undefined) return
    setDraft((current) => ({
      ...current,
      name: t(preset.nameKey),
      protocol: preset.protocol,
      baseEndpoint: preset.baseEndpoint,
      model: "",
      models: [],
    }))
    setModels([])
    setModelsError(null)
  }

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
        error instanceof ConversationCommandError
          ? commandErrorMessage(error.code)
          : t("settings.providers.fetchModelsFailed"),
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
      toast.success(t("settings.providers.providerSaved"))
      onSaved(saved)
      const nextDraft = draftFromProvider(saved)
      setDraft(nextDraft)
      setSavedDraft(nextDraft)
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
          aria-label={
            draft.id === undefined
              ? t("settings.providers.editorNewTitle")
              : t("settings.providers.editorEditTitle")
          }
          className="flex min-w-0 flex-col gap-4"
        >
          {storeError !== null && (
            <Alert variant="destructive">
              <AlertTitle>{t("settings.providers.incompleteAlert")}</AlertTitle>
              <AlertDescription>
                {commandErrorMessage(storeError.code)}
              </AlertDescription>
            </Alert>
          )}
          {readOnly && (
            <Alert>
              <AlertTitle>{t("settings.providers.readOnlyAlert")}</AlertTitle>
              <AlertDescription>
                {t("settings.providers.readOnlyAlertBody")}
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            {isNewProvider && (
              <Field data-disabled={mutationDisabled}>
                <FieldLabel htmlFor="provider-preset">
                  {t("settings.providers.presetField")}
                </FieldLabel>
                <Select
                  value={selectedPresetId}
                  disabled={mutationDisabled}
                  onValueChange={(value) => {
                    if (
                      value === CUSTOM_PRESET_ID ||
                      isProviderPresetId(value)
                    ) {
                      applyPresetSelection(value)
                    }
                  }}
                >
                  <SelectTrigger id="provider-preset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      <SelectItem value={CUSTOM_PRESET_ID}>
                        <ProviderPresetIcon presetId={CUSTOM_PRESET_ID} />
                        {t("settings.providers.presetCustom")}
                      </SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>
                        {t("settings.providers.presetMenuLabel")}
                      </SelectLabel>
                      {PROVIDER_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          <ProviderPresetIcon presetId={preset.id} />
                          {t(preset.nameKey)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-name">
                {t("settings.providers.nameField")}
              </FieldLabel>
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
              <FieldLabel htmlFor="provider-protocol">
                {t("settings.providers.protocolField")}
              </FieldLabel>
              <Select
                value={draft.protocol}
                disabled={mutationDisabled}
                onValueChange={(value) =>
                  updateDraft("protocol", value as ProviderProtocol)
                }
              >
                <SelectTrigger id="provider-protocol" className="w-full">
                  <SelectValue
                    placeholder={t("settings.providers.protocolPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="openai_compatible">
                      {t("settings.providers.protocolOpenaiCompatible")}
                    </SelectItem>
                    <SelectItem value="anthropic">
                      Anthropic Messages
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-endpoint">
                {t("settings.providers.endpointField")}
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
                  {t("settings.providers.endpointHint")}
                </FieldDescription>
              )}
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-model-add">
                {t("settings.providers.modelsField")}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="provider-model-add"
                  value={modelAddition}
                  onChange={(event) => setModelAddition(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds the typed model instead of implicitly
                    // submitting the whole provider form.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing)
                      return
                    event.preventDefault()
                    addModel(modelAddition)
                  }}
                  placeholder={t("settings.providers.modelInputPlaceholder")}
                  disabled={mutationDisabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutationDisabled || !modelAddition.trim()}
                  onClick={() => addModel(modelAddition)}
                >
                  {t("common.add")}
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
                  {t("settings.providers.fetchModels")}
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
                    <Badge
                      key={model}
                      variant="outline"
                      size="lg"
                      className="gap-1 pr-1"
                    >
                      {model}
                      <button
                        type="button"
                        aria-label={t("settings.providers.removeModelAria", {
                          model,
                        })}
                        disabled={mutationDisabled || draft.models.length <= 1}
                        onClick={() => removeModel(model)}
                        className="rounded-sm opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {models.length > 0 && (
                <>
                  <Separator className="mt-2" />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {models
                      .filter((model) => !draft.models.includes(model.id))
                      .map((model) => (
                        <Button
                          key={model.id}
                          type="button"
                          size="xs"
                          variant="ghost"
                          aria-label={t("settings.providers.addModelAria", {
                            model: model.id,
                          })}
                          disabled={mutationDisabled}
                          onClick={() => addModel(model.id)}
                        >
                          <Plus data-icon="inline-start" aria-hidden="true" />
                          {model.displayName ?? model.id}
                        </Button>
                      ))}
                  </div>
                </>
              )}
            </Field>
            <Field
              data-disabled={mutationDisabled || draft.models.length === 0}
            >
              <FieldLabel htmlFor="provider-default-model">
                {t("settings.providers.defaultModelField")}
              </FieldLabel>
              <Select
                value={
                  draft.models.includes(draft.model) ? draft.model : undefined
                }
                disabled={mutationDisabled || draft.models.length === 0}
                onValueChange={(value) => {
                  if (value !== "") updateDraft("model", value)
                }}
              >
                <SelectTrigger id="provider-default-model" className="w-full">
                  <SelectValue
                    placeholder={t(
                      "settings.providers.defaultModelPlaceholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {draft.models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-disabled={mutationDisabled}>
              <FieldLabel htmlFor="provider-api-key">
                {t("settings.providers.apiKeyField")}
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
                      : t("settings.providers.apiKeyOptional")
                  }
                  disabled={mutationDisabled}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-sm"
                    aria-label={
                      showApiKey
                        ? t("settings.providers.hideApiKey")
                        : t("settings.providers.showApiKey")
                    }
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
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          aria-label={t("settings.providers.saveAria")}
          disabled={mutationDisabled}
        >
          {t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
