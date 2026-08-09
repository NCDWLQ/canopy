import { render, screen } from "@testing-library/react"
import App from "./App"

// Mock tauri client so we don't call real IPC in component tests
vi.mock("@/lib/tauri", () => ({
  createConversationClient: () => ({}),
}))

describe("Canopy scaffold", () => {
  it("renders the ConversationWorkspace", () => {
    render(<App />)
    expect(
      screen.getByRole("heading", { name: "Start a conversation" }),
    ).toBeVisible()
    expect(
      screen.getByText(/no assistant reply will be invented/i),
    ).toBeVisible()
  })
})
