import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationSettingsDialog } from "./ConversationSettingsDialog"
import { useConversationStore } from "../store"
import { useProviderStore } from "@/features/providers/store"
import { ConversationCommandError, type ConversationClient } from "@/lib/tauri"

function createClient() {
  return {
    setConversationSystemPrompt:
      vi.fn<ConversationClient["setConversationSystemPrompt"]>(),
  } as unknown as ConversationClient & {
    setConversationSystemPrompt: ReturnType<
      typeof vi.fn<ConversationClient["setConversationSystemPrompt"]>
    >
  }
}

describe("ConversationSettingsDialog", () => {
  beforeEach(() => {
    useConversationStore.setState({
      isCreatingConversation: false,
      conversationId: "conversation-1",
      isArchived: false,
      systemPrompt: null,
      draftSystemPrompt: null,
    })
    useProviderStore.setState({
      defaultSystemPrompt: "You are helpful",
    })
  })

  it("writes a draft prompt locally without invoking IPC", async () => {
    const user = userEvent.setup()
    const conversationClient = createClient()
    render(
      <ConversationSettingsDialog
        conversationClient={conversationClient}
        draftMode
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "对话设置" }))
    const textarea = screen.getByRole("textbox", { name: "系统提示词" })
    expect(textarea).toHaveAttribute("placeholder", "跟随全局默认")
    expect(screen.getByText("当前全局默认: You are helpful")).toBeVisible()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()

    await user.type(textarea, "Be concise")
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect(useConversationStore.getState().draftSystemPrompt).toBe("Be concise")
    expect(
      conversationClient.setConversationSystemPrompt,
    ).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
  })

  it("saves a loaded conversation prompt through the store action", async () => {
    const user = userEvent.setup()
    const conversationClient = createClient()
    conversationClient.setConversationSystemPrompt.mockImplementation(
      (input) => {
        useConversationStore.setState({ systemPrompt: input.systemPrompt })
        return Promise.resolve({
          id: input.conversationId,
          systemPrompt: input.systemPrompt,
        })
      },
    )
    render(
      <ConversationSettingsDialog
        conversationClient={conversationClient}
        draftMode={false}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "对话设置" }))
    await user.type(
      screen.getByRole("textbox", { name: "系统提示词" }),
      "Be brief",
    )
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(
        conversationClient.setConversationSystemPrompt,
      ).toHaveBeenCalledWith({
        conversationId: "conversation-1",
        systemPrompt: "Be brief",
      }),
    )
    expect(useConversationStore.getState().systemPrompt).toBe("Be brief")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
  })

  it("keeps the dialog open when saving a loaded prompt fails", async () => {
    const user = userEvent.setup()
    const conversationClient = createClient()
    conversationClient.setConversationSystemPrompt.mockRejectedValueOnce(
      new ConversationCommandError({
        code: "database_unavailable",
        message: "Prompt failed.",
        retryable: true,
      }),
    )
    render(
      <ConversationSettingsDialog
        conversationClient={conversationClient}
        draftMode={false}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "对话设置" }))
    await user.type(
      screen.getByRole("textbox", { name: "系统提示词" }),
      "Be brief",
    )
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(conversationClient.setConversationSystemPrompt).toHaveBeenCalled(),
    )
    expect(screen.getByRole("dialog")).toBeVisible()
    expect(useConversationStore.getState().systemPrompt).toBeNull()
    expect(useConversationStore.getState().error?.message).toBe(
      "Prompt failed.",
    )
  })

  it("restores follow-global for a loaded conversation", async () => {
    const user = userEvent.setup()
    const conversationClient = createClient()
    conversationClient.setConversationSystemPrompt.mockResolvedValue({
      id: "conversation-1",
      systemPrompt: null,
    })
    useConversationStore.setState({ systemPrompt: "Override" })
    render(
      <ConversationSettingsDialog
        conversationClient={conversationClient}
        draftMode={false}
        readOnly={false}
      />,
    )

    await user.click(screen.getByRole("button", { name: "对话设置" }))
    expect(screen.getByRole("textbox", { name: "系统提示词" })).toHaveValue(
      "Override",
    )
    expect(screen.queryByText(/当前全局默认/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "恢复全局默认" }))
    await waitFor(() => {
      expect(
        conversationClient.setConversationSystemPrompt,
      ).toHaveBeenCalledWith({
        conversationId: "conversation-1",
        systemPrompt: null,
      })
      expect(useConversationStore.getState().systemPrompt).toBeNull()
    })
    expect(screen.getByRole("textbox", { name: "系统提示词" })).toHaveValue("")
  })

  it("keeps an archived conversation prompt read-only", async () => {
    const user = userEvent.setup()
    const conversationClient = createClient()
    useConversationStore.setState({
      systemPrompt: "Override",
      isArchived: true,
    })
    render(
      <ConversationSettingsDialog
        conversationClient={conversationClient}
        draftMode={false}
        readOnly
      />,
    )

    await user.click(screen.getByRole("button", { name: "对话设置" }))
    expect(screen.getByRole("textbox", { name: "系统提示词" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "恢复全局默认" }),
    ).not.toBeInTheDocument()
  })
})
