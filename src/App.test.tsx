import { render, screen } from "@testing-library/react"
import App from "./App"

// Mock tauri client so we don't call real IPC in component tests
vi.mock("@/lib/tauri", () => ({
  createConversationClient: () => ({
    listConversations: () => Promise.resolve([]),
  }),
  createProviderClient: () => ({
    loadProviderProfile: () =>
      Promise.resolve({
        baseEndpoint: "http://127.0.0.1:7788/v1",
        model: "fixture-model",
        hasApiKey: false,
        updatedAt: 1,
      }),
  }),
}))

describe("Canopy scaffold", () => {
  it("renders the ConversationWorkspace", async () => {
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "开始新会话" }),
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "新建会话" })).toBeVisible()
  })
})
