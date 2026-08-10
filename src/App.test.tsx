import { render, screen } from "@testing-library/react"
import App from "./App"

// Mock tauri client so we don't call real IPC in component tests
vi.mock("@/lib/tauri", () => ({
  createConversationClient: () => ({}),
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
  it("renders the ConversationWorkspace", () => {
    render(<App />)
    expect(
      screen.getByRole("heading", { name: "Start a conversation" }),
    ).toBeVisible()
    expect(
      screen.getByText(/generate a response from the selected user message/i),
    ).toBeVisible()
  })
})
