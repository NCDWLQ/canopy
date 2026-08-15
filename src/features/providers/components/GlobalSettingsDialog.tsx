import * as React from "react"
import { KeyRound, Settings2, Trash2 } from "lucide-react"

import { resolveApiKeyAction } from "./apiKeyAction"
import { useProviderProfileStore } from "../store"
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { Spinner } from "@/components/ui/spinner"
import type { ProviderClient } from "@/lib/tauri"

type GlobalSettingsDialogBaseProps = {
  client: ProviderClient
  readOnly: boolean
  generationActive: boolean
}

export type GlobalSettingsDialogProps = GlobalSettingsDialogBaseProps &
  (
    | {
        open?: never
        onOpenChange?: never
      }
    | {
        open: boolean
        onOpenChange: (open: boolean) => void
      }
  )

export function GlobalSettingsDialog(props: GlobalSettingsDialogProps) {
  const { client, readOnly, generationActive } = props
  const controlledOpen = props.open
  const controlledOnOpenChange = props.onOpenChange
  const phase = useProviderProfileStore((state) => state.phase)
  const profile = useProviderProfileStore((state) => state.profile)
  const error = useProviderProfileStore((state) =>
    state.phase === "error" ? state.error : null,
  )
  const saveProfile = useProviderProfileStore((state) => state.saveProfile)
  const deleteProfile = useProviderProfileStore((state) => state.deleteProfile)
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const [baseEndpoint, setBaseEndpoint] = React.useState("")
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [removeKey, setRemoveKey] = React.useState(false)

  const prevOpenRef = React.useRef(open)

  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      setBaseEndpoint(profile?.baseEndpoint ?? "")
      setModel(profile?.model ?? "")
      setApiKey("")
      setRemoveKey(false)
    } else if (!open && prevOpenRef.current) {
      setApiKey("")
      setRemoveKey(false)
    }
    prevOpenRef.current = open
  }, [open, profile?.baseEndpoint, profile?.model])

  const mutationDisabled = readOnly || generationActive || phase === "loading"

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(nextOpen)
    }
    controlledOnOpenChange?.(nextOpen)
    setApiKey("")
    setRemoveKey(false)
    if (nextOpen) {
      setBaseEndpoint(profile?.baseEndpoint ?? "")
      setModel(profile?.model ?? "")
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutationDisabled) return
    const apiKeyAction = resolveApiKeyAction(profile, apiKey, removeKey)
    try {
      await saveProfile(client, {
        baseEndpoint,
        model,
        apiKey: apiKeyAction,
      })
    } finally {
      setApiKey("")
    }
  }

  const handleDelete = async () => {
    if (mutationDisabled) return
    await deleteProfile(client)
    setBaseEndpoint("")
    setModel("")
    setApiKey("")
    setRemoveKey(false)
  }

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>管理应用于整个工作区的配置。</DialogDescription>
        </DialogHeader>

        <section
          aria-labelledby="provider-settings-title"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 id="provider-settings-title" className="font-medium">
              服务提供商
            </h2>
            <p className="text-sm text-muted-foreground">
              配置此工作区使用的单个 OpenAI
              兼容服务提供商。凭据将保存在系统凭据存储中。
            </p>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            {profile !== null && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{profile.model}</Badge>
                <Badge variant="outline">
                  <KeyRound data-icon="inline-start" />
                  {profile.hasApiKey ? "已保存 API 密钥" : "未保存 API 密钥"}
                </Badge>
              </div>
            )}

            {error !== null && (
              <Alert variant="destructive">
                <AlertTitle>服务提供商不可用</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}

            {readOnly && (
              <Alert>
                <AlertTitle>只读</AlertTitle>
                <AlertDescription>
                  查看已归档会话时无法修改服务提供商设置。
                </AlertDescription>
              </Alert>
            )}

            {generationActive && !readOnly && (
              <Alert>
                <AlertTitle>正在生成回复</AlertTitle>
                <AlertDescription>
                  当前回复处理完成后即可修改服务提供商设置。
                </AlertDescription>
              </Alert>
            )}

            <FieldGroup>
              <Field data-disabled={mutationDisabled}>
                <FieldLabel htmlFor="provider-endpoint">基础端点</FieldLabel>
                <Input
                  id="provider-endpoint"
                  type="url"
                  value={baseEndpoint}
                  onChange={(event) => setBaseEndpoint(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  disabled={mutationDisabled}
                  required
                />
              </Field>

              <Field data-disabled={mutationDisabled}>
                <FieldLabel htmlFor="provider-model">模型</FieldLabel>
                <Input
                  id="provider-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="例如：gpt-5"
                  disabled={mutationDisabled}
                  required
                />
              </Field>

              <Field data-disabled={mutationDisabled || removeKey}>
                <FieldLabel htmlFor="provider-api-key">API 密钥</FieldLabel>
                <Input
                  id="provider-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={profile === null ? "可选" : "留空以保留现有密钥"}
                  disabled={mutationDisabled || removeKey}
                />
                <FieldDescription>
                  每次尝试保存后，此对话框中的密钥都会被清空。
                </FieldDescription>
              </Field>

              {profile !== null && (
                <Field
                  orientation="horizontal"
                  data-disabled={mutationDisabled}
                >
                  <Checkbox
                    id="provider-remove-key"
                    checked={removeKey}
                    onCheckedChange={(checked) =>
                      setRemoveKey(checked === true)
                    }
                    disabled={mutationDisabled}
                  />
                  <FieldLabel htmlFor="provider-remove-key">
                    删除已保存的 API 密钥
                  </FieldLabel>
                </Field>
              )}
            </FieldGroup>

            <DialogFooter>
              {profile !== null && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={mutationDisabled}
                    >
                      <Trash2 data-icon="inline-start" />
                      删除配置
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除服务提供商配置？</AlertDialogTitle>
                      <AlertDialogDescription>
                        重新配置服务提供商之前，将无法生成回复。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void handleDelete()}
                      >
                        删除配置
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                type="submit"
                aria-label="保存服务提供商配置"
                disabled={mutationDisabled}
              >
                {phase === "loading" && <Spinner data-icon="inline-start" />}
                保存配置
              </Button>
            </DialogFooter>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  )
}
