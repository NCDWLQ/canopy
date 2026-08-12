import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Composer } from "./Composer"

describe("Composer", () => {
  it("retains the draft and unlocks submission after an unexpected rejection", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error("unexpected failure"))
    render(<Composer disabled={false} onSubmit={onSubmit} />)
    const composer = screen.getByRole("textbox", { name: "Message composer" })

    await user.type(composer, "RETRY_DRAFT_SENTINEL")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(composer).toHaveValue("RETRY_DRAFT_SENTINEL")
    expect(composer).toBeEnabled()
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
  })
})
