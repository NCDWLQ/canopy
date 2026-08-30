import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { BranchSwitcher } from "./BranchSwitcher"

describe("BranchSwitcher", () => {
  it("renders the 1-based position and disables the leading control on the first branch", () => {
    render(
      <BranchSwitcher
        index={0}
        count={2}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        prevDisabled
        nextDisabled={false}
      />,
    )

    expect(screen.getByRole("group", { name: "分支 1/2" })).toBeVisible()
    expect(screen.getByText("1/2")).toBeVisible()
    expect(screen.getByRole("button", { name: "上一条分支" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "下一条分支" })).toBeEnabled()
  })

  it("calls the navigation handlers when enabled", async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(
      <BranchSwitcher
        index={1}
        count={2}
        onPrev={onPrev}
        onNext={onNext}
        prevDisabled={false}
        nextDisabled
      />,
    )

    await user.click(screen.getByRole("button", { name: "上一条分支" }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "下一条分支" })).toBeDisabled()
  })
})
