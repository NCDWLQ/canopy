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
      await screen.findByRole("heading", { name: "Start a conversation" }),
    ).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "Message composer" }),
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toBeVisible()
  })
})
