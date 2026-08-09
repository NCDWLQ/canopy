import { render, screen } from "@testing-library/react"

import App from "./App"

describe("Canopy scaffold", () => {
  it("renders the accessible application marker", () => {
    render(<App />)

    expect(screen.getByRole("heading", { name: "Canopy" })).toBeVisible()
    expect(screen.getByText("The application shell is ready.")).toBeVisible()
  })
})
