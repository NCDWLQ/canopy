import { beforeEach, describe, expect, it } from "vitest"

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
    createConversation: () => Promise.resolve(tree),
    appendNode: () => Promise.resolve(nodes.right),
    createBranch: () => Promise.resolve(nodes.right),
    editNodeAsBranch: () => Promise.resolve(nodes.right),
    listConversations: () => Promise.resolve([]),
    loadConversationTree: () => Promise.resolve(tree),
    loadActivePath: () =>
      Promise.resolve({
        conversationId: conversation.id,
        activeNodeId: nodes.right.id,
        path: [],
      }),
    archiveConversation: () => Promise.resolve(conversation),
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

function completedNode(content = "STREAMED_RESPONSE"): ConversationNodeView {
  return {
    id: "completed-assistant",
    parentId: nodes.right.id,
    conversationId: conversation.id,
    role: "assistant",
    content,
    model,
    createdAt: 5,
    metadata: null,
  }
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

  it("keeps streamed content transient until the authoritative result merges", async () => {
    await loadActiveUser()
    const nodesBefore = useConversationStore.getState().nodesById
    const runId = beginStreaming()

    expect(useConversationStore.getState().nodesById).toBe(nodesBefore)
    expect(
      selectActivePath(useConversationStore.getState()).path,
    ).not.toContain(completedNode())
    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completedNode()),
    ).toBe(true)
    expect(
      useConversationStore.getState().fullNodes["completed-assistant"],
    ).toEqual(completedNode())
    expect(useConversationStore.getState().generation).toEqual({
      phase: "idle",
    })
  })

  it("accepts a completed result before started callbacks when the target is still current", async () => {
    await loadActiveUser()
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return
    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completedNode()),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toEqual({
      phase: "idle",
    })
  })

  it("cancels exact runs while preserving displayed partial content", async () => {
    await loadActiveUser()
    const runId = beginStreaming("PARTIAL_RESPONSE")
    expect(useConversationStore.getState().cancelGenerationRun(runId)).toBe(
      true,
    )
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "cancelled",
      conversationId: conversation.id,
      parentNodeId: nodes.right.id,
      content: "PARTIAL_RESPONSE",
    })
    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completedNode("FINAL")),
    ).toBe(true)
  })

  it("classifies persistence failures without inserting a partial node", async () => {
    await loadActiveUser()
    const runId = beginStreaming("COMPLETE_RESPONSE")
    expect(
      useConversationStore.getState().failGeneration(
        runId,
        {
          code: "database_unavailable",
          message: "保存失败。",
          retryable: true,
        },
        generationId,
        "persistence",
      ),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: "COMPLETE_RESPONSE",
    })
    expect(
      useConversationStore.getState().fullNodes["completed-assistant"],
    ).toBeUndefined()
  })

  it("classifies generation failures and discards partial content", async () => {
    await loadActiveUser()
    const runId = beginStreaming("PARTIAL_THAT_MUST_BE_DISCARDED")
    expect(
      useConversationStore.getState().failGeneration(
        runId,
        {
          code: "provider_unavailable",
          message: "生成失败。",
          retryable: true,
        },
        generationId,
        "generation",
      ),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toEqual({
      phase: "failed",
      runId,
      failureKind: "generation",
      error: {
        code: "provider_unavailable",
        message: "生成失败。",
        retryable: true,
      },
    })
  })

  it("preserves a persistence failure when the terminal result beats started", async () => {
    await loadActiveUser()
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return

    expect(
      useConversationStore.getState().failGeneration(
        runId,
        {
          code: "database_unavailable",
          message: "保存失败。",
          retryable: true,
        },
        generationId,
        "persistence",
      ),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: "",
    })
  })

  it("retains complete content when persistence loses a race with local cancellation", async () => {
    await loadActiveUser()
    const runId = beginStreaming("COMPLETE_BEFORE_CANCEL")
    expect(useConversationStore.getState().cancelGenerationRun(runId)).toBe(
      true,
    )
    expect(
      useConversationStore.getState().failGeneration(
        runId,
        {
          code: "database_unavailable",
          message: "保存失败。",
          retryable: true,
        },
        generationId,
        "persistence",
      ),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toMatchObject({
      phase: "failed",
      failureKind: "persistence",
      content: "COMPLETE_BEFORE_CANCEL",
    })
  })

  it("reloads exactly one new assistant as authority and never guesses among duplicates", async () => {
    await loadActiveUser()
    const runId = beginStreaming()
    const reloadedNode = { ...completedNode(), id: "reloaded-assistant" }
    const reloaded: ConversationTreeView = {
      ...tree,
      nodes: [...tree.nodes, reloadedNode],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [reloadedNode.id] },
        [reloadedNode.id]: {
          id: reloadedNode.id,
          parentId: nodes.right.id,
          role: "assistant",
          preview: reloadedNode.content,
          childIds: [],
        },
      },
    }
    expect(
      useConversationStore.getState().recoverGeneration(runId, reloaded),
    ).toBe(true)
    expect(useConversationStore.getState().generation).toEqual({
      phase: "idle",
    })

    useConversationStore.getState().selectNode(nodes.right.id)
    const secondRun = beginStreaming()
    const duplicate = { ...reloadedNode, id: "reloaded-two" }
    const secondNewNode = { ...reloadedNode, id: "reloaded-three" }
    const duplicateTree: ConversationTreeView = {
      ...reloaded,
      nodes: [...reloaded.nodes, duplicate, secondNewNode],
      nodesById: {
        ...reloaded.nodesById,
        right: {
          ...reloaded.nodesById.right!,
          childIds: [reloadedNode.id, duplicate.id, secondNewNode.id],
        },
        [duplicate.id]: {
          id: duplicate.id,
          parentId: nodes.right.id,
          role: "assistant",
          preview: duplicate.content,
          childIds: [],
        },
        [secondNewNode.id]: {
          id: secondNewNode.id,
          parentId: nodes.right.id,
          role: "assistant",
          preview: secondNewNode.content,
          childIds: [],
        },
      },
    }
    expect(
      useConversationStore
        .getState()
        .recoverGeneration(secondRun, duplicateTree),
    ).toBe(false)
    expect(useConversationStore.getState().generation.phase).toBe("streaming")
  })

  it("does not recover from a model-less assistant", async () => {
    await loadActiveUser()
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return
    const modelLess = {
      ...completedNode(),
      id: "model-less-assistant",
      model: undefined,
    }
    const reloaded: ConversationTreeView = {
      ...tree,
      nodes: [...tree.nodes, modelLess],
      nodesById: {
        ...tree.nodesById,
        right: { ...tree.nodesById.right!, childIds: [modelLess.id] },
        [modelLess.id]: {
          id: modelLess.id,
          parentId: nodes.right.id,
          role: "assistant",
          preview: modelLess.content,
          childIds: [],
        },
      },
    }

    expect(
      useConversationStore.getState().recoverGeneration(runId, reloaded),
    ).toBe(false)
    expect(useConversationStore.getState().generation.phase).toBe("starting")
  })
})
