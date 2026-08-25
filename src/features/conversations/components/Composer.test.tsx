import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Composer } from "./Composer"

describe("Composer", () => {
  it("retains the draft and unlocks submission after an unexpected rejection", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error("unexpected failure"))
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: false }}
        onSubmit={onSubmit}
      />,
    )
    const composer = screen.getByRole("textbox", { name: "消息输入框" })

    await user.type(composer, "RETRY_DRAFT_SENTINEL")
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(composer).toHaveValue("RETRY_DRAFT_SENTINEL")
    expect(composer).toBeEnabled()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
  })

  it("submits draft on Enter when send is enabled and clears draft on success", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: false }}
        onSubmit={onSubmit}
      />,
    )
    const composer = screen.getByRole("textbox", { name: "消息输入框" })

    await user.type(composer, "ENTER_SUBMIT_SENTINEL")
    await user.keyboard("{Enter}")

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("ENTER_SUBMIT_SENTINEL")
      expect(composer).toHaveValue("")
    })
  })

  it("does not submit or clear draft on Enter when send is disabled", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: true }}
        onSubmit={onSubmit}
      />,
    )
    const composer = screen.getByRole("textbox", { name: "消息输入框" })

    expect(composer).toBeEnabled()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()

    await user.type(composer, "DISABLED_SEND_SENTINEL")
    await user.keyboard("{Enter}")

    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer).toHaveValue("DISABLED_SEND_SENTINEL")
  })

  it("renders cancel action during generation and invokes onCancel on click without submitting", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "cancel", onCancel }}
        onSubmit={onSubmit}
      />,
    )

    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    const cancelButton = screen.getByRole("button", { name: "停止生成" })

    expect(composer).toBeEnabled()
    expect(cancelButton).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "发送消息" }),
    ).not.toBeInTheDocument()

    await user.type(composer, "STREAMING_DRAFT_SENTINEL")
    await user.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer).toHaveValue("STREAMING_DRAFT_SENTINEL")
  })

  it("does not submit, cancel, or newline on plain Enter when action is cancel", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "cancel", onCancel }}
        onSubmit={onSubmit}
      />,
    )

    const composer = screen.getByRole("textbox", { name: "消息输入框" })

    await user.type(composer, "CANCEL_ENTER_SENTINEL")
    await user.keyboard("{Enter}")

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(composer).toHaveValue("CANCEL_ENTER_SENTINEL")
  })

  it("inserts a newline on Shift+Enter without submitting", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: false }}
        onSubmit={onSubmit}
      />,
    )

    const composer = screen.getByRole("textbox", { name: "消息输入框" })

    await user.type(composer, "line1{Shift>}{Enter}{/Shift}line2")

    expect(onSubmit).not.toHaveBeenCalled()
    expect(composer).toHaveValue("line1\nline2")
  })

  it("preserves typed draft across action prop transitions", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: true }}
        onSubmit={onSubmit}
      />,
    )

    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, "PRESERVED_DRAFT_SENTINEL")

    // Transition to streaming (cancel action)
    rerender(
      <Composer
        inputDisabled={false}
        action={{ kind: "cancel", onCancel }}
        onSubmit={onSubmit}
      />,
    )
    expect(composer).toHaveValue("PRESERVED_DRAFT_SENTINEL")
    expect(screen.getByRole("button", { name: "停止生成" })).toBeEnabled()

    // Transition to completed (send enabled)
    rerender(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: false }}
        onSubmit={onSubmit}
      />,
    )
    expect(composer).toHaveValue("PRESERVED_DRAFT_SENTINEL")
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
  })

  it("disables textarea when inputDisabled is true", () => {
    render(
      <Composer
        inputDisabled={true}
        action={{ kind: "send", disabled: true }}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled()
  })

  it("keeps Cancel enabled and callable during a pending submit promise without corrupting state", async () => {
    const user = userEvent.setup()
    let resolveSubmit: (val?: boolean | void) => void
    const pendingSubmit = new Promise<boolean | void>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn().mockReturnValue(pendingSubmit)
    const onCancel = vi.fn()

    const { rerender } = render(
      <Composer
        inputDisabled={false}
        action={{ kind: "send", disabled: false }}
        onSubmit={onSubmit}
      />,
    )

    const composer = screen.getByRole("textbox", { name: "消息输入框" })
    await user.type(composer, "PENDING_SUBMIT_DRAFT")
    await user.click(screen.getByRole("button", { name: "发送消息" }))

    expect(onSubmit).toHaveBeenCalledWith("PENDING_SUBMIT_DRAFT")

    // Automatic generation transitions parent to starting/streaming (cancel action) while onSubmit promise is still pending
    rerender(
      <Composer
        inputDisabled={false}
        action={{ kind: "cancel", onCancel }}
        onSubmit={onSubmit}
      />,
    )

    const cancelButton = screen.getByRole("button", { name: "停止生成" })
    expect(cancelButton).toBeVisible()
    expect(cancelButton).toBeEnabled()

    // Clicking cancel must call onCancel immediately
    await user.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)

    // Now resolve the submit promise
    resolveSubmit!(true)
    await waitFor(() => {
      expect(composer).toHaveValue("")
      expect(composer).toBeEnabled()
    })
  })
})
