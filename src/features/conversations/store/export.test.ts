import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"

import { useConversationStore } from "./index"
import type {
  ConversationNodeView,
  ConversationTreeView,
  ConversationView,
} from "../types"
import { ConversationCommandError, type ConversationClient } from "@/lib/tauri"

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { save } from "@tauri-apps/plugin-dialog"

const saveMock = vi.mocked(save)
const toastSuccessMock = vi.mocked(toast.success)
const toastErrorMock = vi.mocked(toast.error)

const conversation: ConversationView = {
  id: "conversation-export",
  title: "Branch/proof: export?",
  rootNodeId: "root",
  isArchived: false,
}

const root: ConversationNodeView = {
  id: "root",
  conversationId: conversation.id,
  role: "user",
  content: "ROOT_SENTINEL",
  createdAt: 1,
  metadata: null,
}

const assistant: ConversationNodeView = {
  id: "assistant",
  parentId: root.id,
  conversationId: conversation.id,
  role: "assistant",
  content: "**assistant reply**",
  model: "fixture-model",
  createdAt: 2,
  metadata: null,
}

const right: ConversationNodeView = {
  id: "right",
  parentId: assistant.id,
  conversationId: conversation.id,
  role: "user",
  content: "RIGHT_BRANCH_SENTINEL",
  createdAt: 4,
  metadata: null,
}

const tree: ConversationTreeView = {
  conversation,
  rootNodeId: root.id,
  nodes: [root, assistant, right],
  nodesById: {
    root: {
      id: root.id,
      role: root.role,
      preview: root.content,
      childIds: [assistant.id],
    },
    assistant: {
      id: assistant.id,
      parentId: root.id,
      role: assistant.role,
      preview: assistant.content,
      childIds: [right.id],
    },
    right: {
      id: right.id,
      parentId: assistant.id,
      role: right.role,
      preview: right.content,
      childIds: [],
    },
  },
}

function createExportClient() {
  return {
    createConversation: vi.fn<ConversationClient["createConversation"]>(),
    appendNode: vi.fn<ConversationClient["appendNode"]>(),
    createBranch: vi.fn<ConversationClient["createBranch"]>(),
    editNodeAsBranch: vi.fn<ConversationClient["editNodeAsBranch"]>(),
    listConversations: vi
      .fn<ConversationClient["listConversations"]>()
      .mockResolvedValue([]),
    loadConversationTree: vi
      .fn<ConversationClient["loadConversationTree"]>()
      .mockResolvedValue(tree),
    loadActivePath: vi.fn<ConversationClient["loadActivePath"]>(),
    archiveConversation: vi.fn<ConversationClient["archiveConversation"]>(),
    renameConversation: vi.fn<ConversationClient["renameConversation"]>(),
    deleteConversation: vi.fn<ConversationClient["deleteConversation"]>(),
    unarchiveConversation: vi
      .fn<ConversationClient["unarchiveConversation"]>()
      .mockResolvedValue(tree.conversation),
    searchConversations: vi
      .fn<ConversationClient["searchConversations"]>()
      .mockResolvedValue([]),
    writeExportFile: vi
      .fn<ConversationClient["writeExportFile"]>()
      .mockResolvedValue({ bytesWritten: 96 }),
  } satisfies ConversationClient
}

function resetStore() {
  useConversationStore.setState({
    isCreatingConversation: false,
    conversationId: null,
    title: null,
    isArchived: false,
    providerId: null,
    model: null,
    reasoningEffort: null,
    draftBinding: null,
    draftReasoningEffort: null,
    rootNodeId: null,
    activeNodeId: null,
    nodesById: {},
    fullNodes: {},
    expandedIds: new Set(),
    status: "idle",
    error: null,
    generationRuns: {},
    history: { status: "idle", summaries: [], error: null },
  })
}

async function loadConversation() {
  const client = createExportClient()
  await useConversationStore
    .getState()
    .loadConversation(client, conversation.id)
  return client
}

describe("exportUpToMessage", () => {
  beforeEach(() => {
    saveMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
    resetStore()
  })

  it("exports the root-to-anchor prefix through the save dialog", async () => {
    const client = await loadConversation()
    saveMock.mockResolvedValue("/home/user/exports/Branchproof export.md")

    await useConversationStore
      .getState()
      .exportUpToMessage(client, assistant.id)

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: "Branchproof export.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    })
    expect(client.writeExportFile).toHaveBeenCalledTimes(1)
    expect(client.writeExportFile).toHaveBeenCalledWith({
      path: "/home/user/exports/Branchproof export.md",
      content:
        "# Branch/proof: export?\n\n## 用户\n\nROOT_SENTINEL\n\n## 助手\n\n**assistant reply**\n",
    })
    expect(toastSuccessMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "已导出：Branchproof export.md",
    )
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("is a silent no-op when the save dialog is cancelled", async () => {
    const client = await loadConversation()
    saveMock.mockResolvedValue(null)

    await useConversationStore
      .getState()
      .exportUpToMessage(client, assistant.id)

    expect(client.writeExportFile).not.toHaveBeenCalled()
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("does not open the dialog while this conversation is generating", async () => {
    const client = await loadConversation()
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()

    await useConversationStore
      .getState()
      .exportUpToMessage(client, assistant.id)

    expect(saveMock).not.toHaveBeenCalled()
    expect(client.writeExportFile).not.toHaveBeenCalled()
  })

  it("does not open the dialog for a node outside the active path", async () => {
    const client = await loadConversation()

    await useConversationStore
      .getState()
      .exportUpToMessage(client, "missing-node")

    expect(saveMock).not.toHaveBeenCalled()
    expect(client.writeExportFile).not.toHaveBeenCalled()
  })

  it("toasts a localized error when the write command fails", async () => {
    const client = await loadConversation()
    saveMock.mockResolvedValue("/home/user/exports/x.md")
    client.writeExportFile.mockRejectedValue(
      new ConversationCommandError({
        code: "export_file_write",
        message: "写入导出文件失败。",
        retryable: false,
      }),
    )

    await useConversationStore
      .getState()
      .exportUpToMessage(client, assistant.id)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith("导出失败", {
      description: "写入导出文件失败。",
    })
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})
