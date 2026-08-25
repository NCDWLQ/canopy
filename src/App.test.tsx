import { act, render, screen } from "@testing-library/react"
import App from "./App"
import { useLocaleStore } from "@/lib/i18n/locale-store"
import { useThemeStore } from "@/lib/theme"

// Mock tauri client so we don't call real IPC in component tests
vi.mock("@/lib/tauri", () => ({
  createConversationClient: () => ({
    listConversations: () => Promise.resolve([]),
  }),
  createProviderClient: () => ({
    listProviders: () =>
      Promise.resolve({
        providers: [],
        activeProviderId: null,
        autoGenerateTitle: true,
        titleModelBinding: null,
        language: "system",
        theme: "system",
      }),
  }),
}))

describe("Canopy scaffold", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-CN")
    useThemeStore.getState().setThemePreference("light")
  })

  it("renders the ConversationWorkspace", async () => {
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "开始新对话" }),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "新建对话" })).toBeVisible()
  })

  it("syncs <html lang> with the active locale", async () => {
    render(<App />)
    await screen.findByRole("heading", { name: "开始新对话" })
    expect(document.documentElement.lang).toBe("zh-CN")

    act(() => {
      useLocaleStore.getState().setLocale("en")
    })
    expect(document.documentElement.lang).toBe("en")

    act(() => {
      useLocaleStore.getState().setLocale("zh-CN")
    })
    expect(document.documentElement.lang).toBe("zh-CN")
  })

  it("syncs document dark class and colorScheme with active theme", async () => {
    render(<App />)
    await screen.findByRole("heading", { name: "开始新对话" })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")

    act(() => {
      useThemeStore.getState().setThemePreference("dark")
    })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    act(() => {
      useThemeStore.getState().setThemePreference("light")
    })
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })
})
