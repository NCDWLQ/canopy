import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DiagnosticsPanel } from "./DiagnosticsPanel"
import { ConversationCommandError } from "@/lib/tauri"
import type { DiagnosticsClient, LoggingSettingsView } from "@/lib/tauri"

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}))

const readySettings: LoggingSettingsView = {
  configured: { maxFileMib: 5, maxFiles: 5 },
  active: { maxFileMib: 5, maxFiles: 5 },
  limits: {
    defaultMaxFileMib: 5,
    defaultMaxFiles: 5,
    maxFileMib: 20,
    maxFiles: 10,
    maxTotalMib: 100,
  },
  configStatus: "default",
  sinkStatus: "persistent",
  restartRequired: false,
}

function client(overrides: Partial<DiagnosticsClient> = {}): DiagnosticsClient {
  return {
    getLoggingSettings: vi.fn().mockResolvedValue(readySettings),
    saveLoggingSettings: vi.fn().mockResolvedValue({
      ...readySettings,
      configured: { maxFileMib: 8, maxFiles: 4 },
      configStatus: "custom",
      restartRequired: true,
    }),
    openLogDirectory: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe("DiagnosticsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads settings, validates budget, saves, and shows restart notice", async () => {
    const user = userEvent.setup()
    const saveLoggingSettings = vi.fn().mockResolvedValue({
      ...readySettings,
      configured: { maxFileMib: 8, maxFiles: 4 },
      configStatus: "custom",
      restartRequired: true,
    })
    const bridge = client({ saveLoggingSettings })
    render(<DiagnosticsPanel client={bridge} />)
    await screen.findByRole("heading", { name: "诊断" })
    expect(await screen.findByText(/正在写入本地日志文件/)).toBeVisible()
    expect(screen.getByLabelText("单文件大小")).toHaveValue(5)
    expect(screen.getByLabelText("总文件数")).toHaveValue(5)
    expect(screen.getByText(/计算总预算：25 \/ 100 MiB/)).toBeVisible()

    await user.clear(screen.getByLabelText("单文件大小"))
    await user.type(screen.getByLabelText("单文件大小"), "20")
    await user.clear(screen.getByLabelText("总文件数"))
    await user.type(screen.getByLabelText("总文件数"), "10")
    expect(screen.getByText("总预算不能超过 100 MiB")).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(saveLoggingSettings).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText("单文件大小"))
    await user.type(screen.getByLabelText("单文件大小"), "8")
    await user.clear(screen.getByLabelText("总文件数"))
    await user.type(screen.getByLabelText("总文件数"), "4")
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(saveLoggingSettings).toHaveBeenCalledWith(8, 4))
    expect(await screen.findByText("重启后生效")).toBeVisible()
  })

  it("restores defaults and opens the log directory independently", async () => {
    const user = userEvent.setup()
    const saveLoggingSettings = vi.fn().mockResolvedValue(readySettings)
    const openLogDirectory = vi.fn().mockResolvedValue(true)
    const bridge = client({ saveLoggingSettings, openLogDirectory })
    render(<DiagnosticsPanel client={bridge} />)
    expect(await screen.findByText(/正在写入本地日志文件/)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "恢复默认值" }))
    await waitFor(() => expect(saveLoggingSettings).toHaveBeenCalledWith(5, 5))
    await user.click(screen.getByRole("button", { name: "打开日志目录" }))
    await waitFor(() => expect(openLogDirectory).toHaveBeenCalledTimes(1))
  })

  it("deduplicates in-flight save and open requests", async () => {
    let resolveSave: (value: LoggingSettingsView) => void = () => {}
    const saveLoggingSettings = vi.fn(
      () =>
        new Promise<LoggingSettingsView>((resolve) => {
          resolveSave = resolve
        }),
    )
    let resolveOpen: (value: boolean) => void = () => {}
    const openLogDirectory = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve
        }),
    )
    const bridge = client({ saveLoggingSettings, openLogDirectory })
    render(<DiagnosticsPanel client={bridge} />)
    expect(await screen.findByText(/正在写入本地日志文件/)).toBeVisible()
    const saveButton = screen.getByRole("button", { name: "保存" })
    const openButton = screen.getByRole("button", { name: "打开日志目录" })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)
    fireEvent.click(openButton)
    fireEvent.click(openButton)
    expect(saveLoggingSettings).toHaveBeenCalledTimes(1)
    expect(openLogDirectory).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(saveButton).toBeDisabled())
    await waitFor(() => expect(openButton).toBeDisabled())
    expect(screen.getByRole("button", { name: /恢复默认值/ })).toBeDisabled()
    resolveSave(readySettings)
    resolveOpen(true)
    await waitFor(() => expect(saveButton).toBeEnabled())
    await waitFor(() => expect(openButton).toBeEnabled())
  })

  it("isolates operation errors and keeps other actions available", async () => {
    const user = userEvent.setup()
    const bridge = client({
      openLogDirectory: vi.fn().mockRejectedValue(
        new ConversationCommandError({
          code: "internal",
          message: "无法打开日志目录。",
          retryable: true,
        }),
      ),
    })
    render(<DiagnosticsPanel client={bridge} />)
    expect(await screen.findByText(/正在写入本地日志文件/)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "打开日志目录" }))
    expect(await screen.findByText("无法打开日志目录")).toBeVisible()
    expect(screen.getByText("无法打开日志目录。")).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "打开日志目录" })).toBeEnabled()
  })

  it("shows console fallback status and retries a failed load", async () => {
    const user = userEvent.setup()
    const bridge = client({
      getLoggingSettings: vi
        .fn()
        .mockRejectedValueOnce(
          new ConversationCommandError({
            code: "internal",
            message: "无法加载日志设置。",
            retryable: true,
          }),
        )
        .mockResolvedValue({
          ...readySettings,
          sinkStatus: "console_fallback",
        }),
    })
    render(<DiagnosticsPanel client={bridge} />)
    expect(await screen.findByText("无法加载日志设置")).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "恢复默认值" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "打开日志目录" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText(/当前仅输出到控制台/)).toBeVisible()
  })
})
