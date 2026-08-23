import { act, render, screen } from "@testing-library/react"
import App from "./App"
import { useLocaleStore } from "@/lib/i18n/locale-store"

// Mock tauri client so we don't call real IPC in component tests
vi.mock("@/lib/tauri", () => ({
  createConversationClient: () => ({
    listConversations: () => Promise.resolve([]),
  }),
  createProviderClient: () => ({
    listProviders: () =>
      Promise.resolve({ providers: [], activeProviderId: null }),
  }),
}))

describe("Canopy scaffold", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("zh-CN")
  })

  it("renders the ConversationWorkspace", async () => {
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "开始新会话" }),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "新建会话" })).toBeVisible()
  })

  it("syncs <html lang> with the active locale", async () => {
    render(<App />)
    await screen.findByRole("heading", { name: "开始新会话" })
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
})
