import * as React from "react"
import { FolderOpen } from "lucide-react"
import { toast } from "sonner"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { LOGGING_LIMITS } from "@/lib/tauri/diagnostics-schemas"
import {
  ConversationCommandError,
  createDiagnosticsClient,
  type DiagnosticsClient,
  type LoggingSettingsView,
} from "@/lib/tauri"

export type DiagnosticsPanelProps = {
  client?: DiagnosticsClient
}

type Operation = "load" | "save" | "open"

function parsePositiveInt(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return null
  return value
}

function sinkLabel(status: LoggingSettingsView["sinkStatus"]): string {
  switch (status) {
    case "persistent":
      return "正在写入本地日志文件"
    case "console_fallback":
      return "当前仅输出到控制台"
    case "disabled":
      return "当前未启用日志"
  }
}

export function DiagnosticsPanel({
  client: injectedClient,
}: DiagnosticsPanelProps) {
  const client = React.useMemo(
    () => injectedClient ?? createDiagnosticsClient(),
    [injectedClient],
  )
  const [settings, setSettings] = React.useState<LoggingSettingsView | null>(
    null,
  )
  const [maxFileMib, setMaxFileMib] = React.useState(
    String(LOGGING_LIMITS.defaultMaxFileMib),
  )
  const [maxFiles, setMaxFiles] = React.useState(
    String(LOGGING_LIMITS.defaultMaxFiles),
  )
  const [pending, setPending] = React.useState<
    Partial<Record<Operation, boolean>>
  >({})
  const inFlight = React.useRef<Partial<Record<Operation, boolean>>>({})
  const [errors, setErrors] = React.useState<
    Partial<Record<Operation, ConversationCommandError>>
  >({})

  const limits = settings?.limits ?? LOGGING_LIMITS
  const fileMibValue = parsePositiveInt(maxFileMib)
  const filesValue = parsePositiveInt(maxFiles)
  const fileMibInvalid =
    fileMibValue === null ||
    fileMibValue < 1 ||
    fileMibValue > limits.maxFileMib
  const filesInvalid =
    filesValue === null || filesValue < 1 || filesValue > limits.maxFiles
  const totalBudget =
    fileMibValue !== null && filesValue !== null
      ? fileMibValue * filesValue
      : null
  const budgetInvalid = totalBudget !== null && totalBudget > limits.maxTotalMib
  const formInvalid = fileMibInvalid || filesInvalid || budgetInvalid

  const loadSettings = React.useCallback(async () => {
    if (inFlight.current.load) return
    inFlight.current.load = true
    setPending((current) => ({ ...current, load: true }))
    setErrors((current) => ({ ...current, load: undefined }))
    try {
      const next = await client.getLoggingSettings()
      setSettings(next)
      setMaxFileMib(String(next.configured.maxFileMib))
      setMaxFiles(String(next.configured.maxFiles))
    } catch (error) {
      setErrors((current) => ({
        ...current,
        load:
          error instanceof ConversationCommandError
            ? error
            : new ConversationCommandError({
                code: "internal",
                message: "无法加载日志设置。",
                retryable: true,
              }),
      }))
    } finally {
      inFlight.current.load = false
      setPending((current) => ({ ...current, load: false }))
    }
  }, [client])

  React.useEffect(() => {
    let cancelled = false
    inFlight.current.load = true
    setPending((current) => ({ ...current, load: true }))
    setErrors((current) => ({ ...current, load: undefined }))
    void client
      .getLoggingSettings()
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        setMaxFileMib(String(next.configured.maxFileMib))
        setMaxFiles(String(next.configured.maxFiles))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setErrors((current) => ({
          ...current,
          load:
            error instanceof ConversationCommandError
              ? error
              : new ConversationCommandError({
                  code: "internal",
                  message: "无法加载日志设置。",
                  retryable: true,
                }),
        }))
      })
      .finally(() => {
        inFlight.current.load = false
        if (cancelled) return
        setPending((current) => ({ ...current, load: false }))
      })
    return () => {
      cancelled = true
    }
  }, [client])

  const runSave = async (nextFileMib: number, nextFiles: number) => {
    if (inFlight.current.save) return
    inFlight.current.save = true
    setPending((current) => ({ ...current, save: true }))
    setErrors((current) => ({ ...current, save: undefined }))
    try {
      const next = await client.saveLoggingSettings(nextFileMib, nextFiles)
      setSettings(next)
      setMaxFileMib(String(next.configured.maxFileMib))
      setMaxFiles(String(next.configured.maxFiles))
      toast.success("日志设置已保存")
    } catch (error) {
      setErrors((current) => ({
        ...current,
        save:
          error instanceof ConversationCommandError
            ? error
            : new ConversationCommandError({
                code: "internal",
                message: "无法保存日志设置。",
                retryable: true,
              }),
      }))
    } finally {
      inFlight.current.save = false
      setPending((current) => ({ ...current, save: false }))
    }
  }

  const handleSave = () => {
    if (formInvalid || fileMibValue === null || filesValue === null) return
    void runSave(fileMibValue, filesValue)
  }

  const handleRestore = () => {
    void runSave(limits.defaultMaxFileMib, limits.defaultMaxFiles)
  }

  const handleOpen = async () => {
    if (inFlight.current.open) return
    inFlight.current.open = true
    setPending((current) => ({ ...current, open: true }))
    setErrors((current) => ({ ...current, open: undefined }))
    try {
      await client.openLogDirectory()
      toast.success("已打开日志目录")
    } catch (error) {
      setErrors((current) => ({
        ...current,
        open:
          error instanceof ConversationCommandError
            ? error
            : new ConversationCommandError({
                code: "internal",
                message: "无法打开日志目录。",
                retryable: true,
              }),
      }))
    } finally {
      inFlight.current.open = false
      setPending((current) => ({ ...current, open: false }))
    }
  }

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
              <BreadcrumbPage>诊断</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section
          aria-labelledby="diagnostics-settings-title"
          className="flex flex-col gap-4"
        >
          <h2 id="diagnostics-settings-title" className="font-medium">
            诊断
          </h2>
          <p className="text-sm text-muted-foreground">
            日志记录应用运行诊断信息，分享前请先检查内容。日志不包含密钥、消息正文或本地路径，但仍可能含有操作标识。
          </p>
          {settings !== null && (
            <p className="text-sm">
              当前输出：{sinkLabel(settings.sinkStatus)}
              {settings.restartRequired ? "。重启后生效" : ""}
            </p>
          )}
          {errors.load !== undefined && (
            <Alert variant="destructive">
              <AlertTitle>无法加载日志设置</AlertTitle>
              <AlertDescription>{errors.load.message}</AlertDescription>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadSettings()}
                disabled={pending.load === true}
              >
                {pending.load === true && <Spinner data-icon="inline-start" />}
                重试
              </Button>
            </Alert>
          )}
          {errors.save !== undefined && (
            <Alert variant="destructive">
              <AlertTitle>无法保存日志设置</AlertTitle>
              <AlertDescription>{errors.save.message}</AlertDescription>
            </Alert>
          )}
          {errors.open !== undefined && (
            <Alert variant="destructive">
              <AlertTitle>无法打开日志目录</AlertTitle>
              <AlertDescription>{errors.open.message}</AlertDescription>
            </Alert>
          )}
          {settings?.restartRequired === true && errors.save === undefined && (
            <Alert>
              <AlertTitle>重启后生效</AlertTitle>
              <AlertDescription>
                新的日志容量设置将在下次启动时应用
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <FieldSet>
              <Field
                orientation="responsive"
                data-invalid={fileMibInvalid || undefined}
              >
                <FieldContent>
                  <FieldLabel htmlFor="max-file-mib">单文件大小</FieldLabel>
                  <FieldDescription>
                    每个日志文件的上限，单位 MiB，范围 1–{limits.maxFileMib}
                    ，默认 {limits.defaultMaxFileMib}
                  </FieldDescription>
                </FieldContent>
                <Input
                  id="max-file-mib"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={limits.maxFileMib}
                  step={1}
                  value={maxFileMib}
                  aria-invalid={fileMibInvalid || undefined}
                  onChange={(event) => setMaxFileMib(event.target.value)}
                />
                {fileMibInvalid && (
                  <FieldError>
                    请输入 1 到 {limits.maxFileMib} 的整数
                  </FieldError>
                )}
              </Field>
              <Field
                orientation="responsive"
                data-invalid={filesInvalid || undefined}
              >
                <FieldContent>
                  <FieldLabel htmlFor="max-files">总文件数</FieldLabel>
                  <FieldDescription>
                    活动文件与归档文件的总数，范围 1–{limits.maxFiles}，默认{" "}
                    {limits.defaultMaxFiles}
                  </FieldDescription>
                </FieldContent>
                <Input
                  id="max-files"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={limits.maxFiles}
                  step={1}
                  value={maxFiles}
                  aria-invalid={filesInvalid || undefined}
                  onChange={(event) => setMaxFiles(event.target.value)}
                />
                {filesInvalid && (
                  <FieldError>请输入 1 到 {limits.maxFiles} 的整数</FieldError>
                )}
              </Field>
              <p className="text-sm text-muted-foreground">
                计算总预算：{totalBudget ?? "—"} / {limits.maxTotalMib} MiB
              </p>
              {budgetInvalid && (
                <FieldError>总预算不能超过 {limits.maxTotalMib} MiB</FieldError>
              )}
            </FieldSet>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                settings === null || formInvalid || pending.save === true
              }
            >
              {pending.save === true && <Spinner data-icon="inline-start" />}
              保存
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRestore}
              disabled={settings === null || pending.save === true}
            >
              {pending.save === true && <Spinner data-icon="inline-start" />}
              恢复默认值
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleOpen()}
              disabled={pending.open === true}
            >
              {pending.open === true ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FolderOpen data-icon="inline-start" />
              )}
              打开日志目录
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
