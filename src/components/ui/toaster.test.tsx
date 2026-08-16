import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { Toaster, showClickableToast } from "./toaster"

describe("toaster", () => {
  beforeAll(() => {
    // Sonner's swipe gesture needs pointer capture, which jsdom lacks.
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
  })

  it("renders the clickable toast card through real sonner and selects on click", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Toaster />)

    showClickableToast({
      kind: "success",
      title: "提示词预览",
      description: "回复预览",
      onSelect,
    })

    // The whole card is one button; sonner itself has no per-toast click
    // handler, so this assertion guards the custom-card wiring end to end.
    const card = await screen.findByRole("button", { name: "跳转到会话" })
    expect(card).toHaveTextContent("提示词预览")
    expect(card).toHaveTextContent("回复预览")

    await user.click(card)
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
  })
})
