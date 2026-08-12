import { beforeEach, describe, expect, it, vi } from "vitest"

import { selectActivePath, useConversationStore } from "./index"
import type {
  ConversationNodeView,
  ConversationTreeView,
  ConversationView,
} from "../types"
import type { ConversationClient } from "@/lib/tauri"

const conversation: ConversationView = {
  id: "conversation-generation",
  title: "Generation proof",
  rootNodeId: "root",
  isArchived: false,
}

const nodes = {
  root: {
    id: "root",
    conversationId: conversation.id,
    role: "user",
    content: "ROOT_SENTINEL",
    createdAt: 1,
    metadata: null,
  },
  assistant: {
    id: "assistant",
    parentId: "root",
    conversationId: conversation.id,
    role: "assistant",
    content: "ASSISTANT_SENTINEL",
    model: "old-model",
    createdAt: 2,
    metadata: null,
  },
  left: {
    id: "left",
    parentId: "assistant",
    conversationId: conversation.id,
    role: "user",
    content: "LEFT_SIBLING_SENTINEL",
    createdAt: 3,
    metadata: null,
  },
  right: {
    id: "right",
    parentId: "assistant",
    conversationId: conversation.id,
    role: "user",
    content: "RIGHT_ACTIVE_SENTINEL",
    createdAt: 4,
    metadata: null,
  },
} satisfies Record<string, ConversationNodeView>

const tree: ConversationTreeView = {
  conversation,
  rootNodeId: nodes.root.id,
  nodes: [nodes.root, nodes.assistant, nodes.left, nodes.right],
  nodesById: {
    root: {
      id: "root",
      role: "user",
      preview: nodes.root.content,
      childIds: ["assistant"],
    },
    assistant: {
      id: "assistant",
      parentId: "root",
      role: "assistant",
      preview: nodes.assistant.content,
      childIds: ["left", "right"],
    },
    left: {
      id: "left",
      parentId: "assistant",
      role: "user",
      preview: nodes.left.content,
      childIds: [],
    },
    right: {
      id: "right",
      parentId: "assistant",
      role: "user",
      preview: nodes.right.content,
      childIds: [],
    },
  },
}

function createClient() {
  return {
    createConversation: vi.fn<ConversationClient["createConversation"]>(),
    appendNode: vi.fn<ConversationClient["appendNode"]>(),
    createBranch: vi.fn<ConversationClient["createBranch"]>(),
    editNodeAsBranch: vi.fn<ConversationClient["editNodeAsBranch"]>(),
    listConversations: vi.fn<ConversationClient["listConversations"]>(),
    loadConversationTree: vi
      .fn<ConversationClient["loadConversationTree"]>()
      .mockResolvedValue(tree),
    loadActivePath: vi.fn<ConversationClient["loadActivePath"]>(),
    archiveConversation: vi.fn<ConversationClient["archiveConversation"]>(),
  } satisfies ConversationClient
}

const generationId = "11111111-1111-4111-8111-111111111111"
const model = "fixture-model"

async function loadActiveUser() {
  await useConversationStore
    .getState()
    .loadConversation(createClient(), conversation.id)
  useConversationStore.getState().selectNode(nodes.right.id)
}

function beginStreaming(content = "STREAMED_RESPONSE") {
  const runId = useConversationStore.getState().beginGeneration()
  expect(runId).not.toBeNull()
  if (runId === null) throw new Error("Expected generation run")
  expect(
    useConversationStore.getState().acceptGenerationStarted(runId, {
      type: "started",
      generationId,
      conversationId: conversation.id,
      activeNodeId: nodes.right.id,
      model,
    }),
  ).toBe(true)
  expect(
    useConversationStore.getState().appendGenerationDelta(runId, {
      type: "delta",
      generationId,
      content,
    }),
  ).toBe(true)
  return runId
}

describe("conversation generation state", () => {
  beforeEach(() => {
    useConversationStore.setState({
      isCreatingConversation: false,
      conversationId: null,
      isArchived: false,
      rootNodeId: null,
      activeNodeId: null,
      nodesById: {},
      fullNodes: {},
      expandedIds: new Set(),
      status: "idle",
      error: null,
      generation: { phase: "idle" },
      history: { status: "idle", summaries: [], error: null },
    })
  })

  it("keeps streamed content transient until exact authoritative completion", async () => {
    await loadActiveUser()
    const nodesBefore = useConversationStore.getState().nodesById
    const runId = beginStreaming()

    expect(useConversationStore.getState().nodesById).toBe(nodesBefore)
    expect(Object.keys(useConversationStore.getState().fullNodes)).toHaveLength(
      4,
    )
    const projection = selectActivePath(useConversationStore.getState())
    expect(projection.kind).toBe("ready")
    expect(projection.path.map((message) => message.content)).not.toContain(
      nodes.left.content,
    )

    expect(
      useConversationStore
        .getState()
        .markGenerationCommitting(runId, generationId),
    ).toBe(true)
    expect(Object.keys(useConversationStore.getState().fullNodes)).toHaveLength(
      4,
    )

    const completed: ConversationNodeView = {
      id: "completed-assistant",
      parentId: nodes.right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "STREAMED_RESPONSE",
      model,
      createdAt: 5,
      metadata: null,
    }
    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completed),
    ).toBe(true)
    expect(useConversationStore.getState().fullNodes[completed.id]).toEqual(
      completed,
    )
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "completed",
      nodeId: completed.id,
    })
  })

  it("invalidates a cancelled run before a path change can acknowledge", async () => {
    await loadActiveUser()
    const runId = beginStreaming()
    expect(useConversationStore.getState().cancelGenerationRun(runId)).toBe(
      true,
    )
    useConversationStore.getState().selectNode(nodes.left.id)

    expect(useConversationStore.getState().activeNodeId).toBe(nodes.left.id)
    expect(
      useConversationStore
        .getState()
        .markGenerationCommitting(runId, generationId),
    ).toBe(false)
  })

  it("rejects authoritative content drift without modifying durable nodes", async () => {
    await loadActiveUser()
    const runId = beginStreaming()
    useConversationStore
      .getState()
      .markGenerationCommitting(runId, generationId)
    const durableBefore = useConversationStore.getState().nodesById

    expect(
      useConversationStore.getState().completeGeneration(runId, generationId, {
        id: "drifted",
        parentId: nodes.right.id,
        conversationId: conversation.id,
        role: "assistant",
        content: "DRIFTED_CONTENT",
        model,
        createdAt: 5,
        metadata: null,
      }),
    ).toBe(false)
    expect(useConversationStore.getState().nodesById).toBe(durableBefore)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      error: { code: "tree_integrity" },
    })
  })

  it("reconciles one exact unseen assistant from SQLite authority", async () => {
    await loadActiveUser()
    useConversationStore.setState({
      history: {
        status: "ready",
        summaries: [{ ...conversation, updatedAt: nodes.right.createdAt }],
        error: null,
      },
    })
    const runId = beginStreaming()
    useConversationStore
      .getState()
      .markGenerationCommitting(runId, generationId)
    useConversationStore.getState().beginGenerationReconciliation(runId, {
      code: "network_failure",
      message: "Delivery was ambiguous.",
      retryable: true,
    })
    const completed: ConversationNodeView = {
      id: "reloaded-assistant",
      parentId: nodes.right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "STREAMED_RESPONSE",
      model,
      createdAt: 5,
      metadata: null,
    }
    const reloaded: ConversationTreeView = {
      ...tree,
      nodes: [...tree.nodes, completed],
      nodesById: {
        ...tree.nodesById,
        right: {
          ...tree.nodesById.right!,
          childIds: [completed.id],
        },
        [completed.id]: {
          id: completed.id,
          parentId: nodes.right.id,
          role: "assistant",
          preview: completed.content,
          childIds: [],
        },
      },
    }

    expect(
      useConversationStore.getState().reconcileGeneration(runId, reloaded),
    ).toBe(true)
    expect(useConversationStore.getState().activeNodeId).toBe(completed.id)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "completed",
      nodeId: completed.id,
    })
    expect(useConversationStore.getState().history).toMatchObject({
      status: "ready",
      summaries: [{ id: conversation.id, updatedAt: completed.createdAt }],
    })
  })

  it("keeps accepting an exact completed event after an early reload", async () => {
    await loadActiveUser()
    const runId = beginStreaming()
    useConversationStore
      .getState()
      .markGenerationCommitting(runId, generationId)
    useConversationStore.getState().beginGenerationReconciliation(runId, {
      code: "network_failure",
      message: "Delivery was ambiguous.",
      retryable: true,
    })

    expect(
      useConversationStore.getState().reconcileGeneration(runId, tree),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "reconciling",
      error: { retryable: true },
    })

    const completed: ConversationNodeView = {
      id: "late-completed-assistant",
      parentId: nodes.right.id,
      conversationId: conversation.id,
      role: "assistant",
      content: "STREAMED_RESPONSE",
      model,
      createdAt: 5,
      metadata: null,
    }
    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completed),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "completed",
      nodeId: completed.id,
    })
  })
})
