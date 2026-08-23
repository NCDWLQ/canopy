import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  isRunActive,
  selectActivePath,
  selectActiveRunIds,
  truncatePreview,
  useConversationStore,
} from "./index"
import type {
  ConversationNodeView,
  ConversationSummaryView,
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

// A second conversation used as the loaded foreground while the first
// conversation's run streams in the background.
const conversationB: ConversationView = {
  id: "conversation-background",
  title: "Background peer",
  rootNodeId: "root-b",
  isArchived: false,
}

const rootB: ConversationNodeView = {
  id: "root-b",
  conversationId: conversationB.id,
  role: "user",
  content: "B_ROOT_SENTINEL",
  createdAt: 1,
  metadata: null,
}

const assistantB: ConversationNodeView = {
  id: "assistant-b",
  parentId: rootB.id,
  conversationId: conversationB.id,
  role: "assistant",
  content: "B_ASSISTANT_SENTINEL",
  model: "old-model",
  createdAt: 2,
  metadata: null,
}

const leafB: ConversationNodeView = {
  id: "leaf-b",
  parentId: assistantB.id,
  conversationId: conversationB.id,
  role: "user",
  content: "B_LEAF_SENTINEL",
  createdAt: 3,
  metadata: null,
}

const treeB: ConversationTreeView = {
  conversation: conversationB,
  rootNodeId: rootB.id,
  nodes: [rootB, assistantB, leafB],
  nodesById: {
    "root-b": {
      id: rootB.id,
      role: "user",
      preview: rootB.content,
      childIds: [assistantB.id],
    },
    "assistant-b": {
      id: assistantB.id,
      parentId: rootB.id,
      role: "assistant",
      preview: assistantB.content,
      childIds: [leafB.id],
    },
    "leaf-b": {
      id: leafB.id,
      parentId: assistantB.id,
      role: "user",
      preview: leafB.content,
      childIds: [],
    },
  },
}

// A flat variant of the first conversation: an assistant leaf for append
// locking and a user leaf with a pre-existing assistant child for
// regeneration runs (prior child IDs).
const assistantLeaf: ConversationNodeView = {
  id: "assistant-leaf",
  parentId: nodes.root.id,
  conversationId: conversation.id,
  role: "assistant",
  content: "ASSISTANT_LEAF_SENTINEL",
  model: "old-model",
  createdAt: 2,
  metadata: null,
}

const regeneratedParent: ConversationNodeView = {
  ...nodes.right,
  parentId: "root",
  createdAt: 5,
}

const oldAssistantChild: ConversationNodeView = {
  id: "old-assistant-child",
  parentId: nodes.right.id,
  conversationId: conversation.id,
  role: "assistant",
  content: "OLD_CHILD_SENTINEL",
  model: "old-model",
  createdAt: 6,
  metadata: null,
}

const flatTree: ConversationTreeView = {
  conversation,
  rootNodeId: nodes.root.id,
  nodes: [nodes.root, assistantLeaf, regeneratedParent, oldAssistantChild],
  nodesById: {
    root: {
      id: "root",
      role: "user",
      preview: nodes.root.content,
      childIds: [assistantLeaf.id, regeneratedParent.id],
    },
    [assistantLeaf.id]: {
      id: assistantLeaf.id,
      parentId: "root",
      role: "assistant",
      preview: assistantLeaf.content,
      childIds: [],
    },
    [regeneratedParent.id]: {
      id: regeneratedParent.id,
      parentId: "root",
      role: "user",
      preview: regeneratedParent.content,
      childIds: [oldAssistantChild.id],
    },
    [oldAssistantChild.id]: {
      id: oldAssistantChild.id,
      parentId: regeneratedParent.id,
      role: "assistant",
      preview: oldAssistantChild.content,
      childIds: [],
    },
  },
}

function createClient() {
  return {
    createConversation: () => Promise.resolve(tree),
    appendNode: vi.fn(() => Promise.resolve(leafB)),
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
    renameConversation: () =>
      Promise.resolve({ ...conversation, title: "Renamed" }),
    deleteConversation: () =>
      Promise.resolve({ conversationId: conversation.id }),
    unarchiveConversation: () => Promise.resolve(conversation),
  } satisfies ConversationClient
}

const generationId = "11111111-1111-4111-8111-111111111111"
const model = "fixture-model"

function runFor(conversationId: string) {
  return useConversationStore.getState().generationRuns[conversationId]
}

async function loadActiveUser() {
  await useConversationStore
    .getState()
    .loadConversation(createClient(), conversation.id)
  useConversationStore.getState().selectNode(nodes.right.id)
}

async function loadBackgroundPeer() {
  const client = {
    ...createClient(),
    loadConversationTree: () => Promise.resolve(treeB),
  } satisfies ConversationClient
  await useConversationStore
    .getState()
    .loadConversation(client, conversationB.id)
  useConversationStore.getState().selectNode(leafB.id)
}

function seedHistory(summaries: readonly ConversationSummaryView[]) {
  useConversationStore.setState({
    history: { status: "ready", summaries, error: null },
  })
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
      generationRuns: {},
      history: { status: "idle", summaries: [], error: null },
    })
  })

  it("captures a flattened, truncated prompt preview when a run begins", async () => {
    const longPrompt = `第一行${"很长的提问".repeat(20)}
第二行还有更多内容`
    await loadActiveUser()
    useConversationStore.setState({
      fullNodes: {
        ...useConversationStore.getState().fullNodes,
        [nodes.right.id]: {
          ...nodes.right,
          content: longPrompt,
        },
      },
    })

    const runId = useConversationStore.getState().beginGeneration()

    expect(runId).not.toBeNull()
    expect(runFor(conversation.id)?.parentPreview).toBe(
      truncatePreview(longPrompt, 60),
    )
    expect(runFor(conversation.id)?.parentPreview?.endsWith("…")).toBe(true)
    expect(runFor(conversation.id)?.parentPreview).not.toContain("\n")
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
    expect(runFor(conversation.id)).toBeUndefined()
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
    expect(runFor(conversation.id)).toBeUndefined()
  })

  it("cancels exact runs while preserving displayed partial content", async () => {
    await loadActiveUser()
    const runId = beginStreaming("PARTIAL_RESPONSE")
    expect(useConversationStore.getState().cancelGenerationRun(runId)).toBe(
      true,
    )
    expect(runFor(conversation.id)).toMatchObject({
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
    expect(runFor(conversation.id)).toMatchObject({
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
    expect(runFor(conversation.id)).toEqual({
      phase: "failed",
      runId,
      conversationId: conversation.id,
      parentNodeId: nodes.right.id,
      priorChildIds: [],
      parentPreview: "RIGHT_ACTIVE_SENTINEL",
      generationId,
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
    expect(runFor(conversation.id)).toMatchObject({
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
    expect(runFor(conversation.id)).toMatchObject({
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
    expect(runFor(conversation.id)).toBeUndefined()
    expect(useConversationStore.getState().activeNodeId).toBe(
      "reloaded-assistant",
    )

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
    expect(runFor(conversation.id)?.phase).toBe("streaming")
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
    expect(runFor(conversation.id)?.phase).toBe("starting")
  })

  it("completes a background run without touching the loaded conversation", async () => {
    await loadActiveUser()
    seedHistory([
      { ...conversation, updatedAt: nodes.right.createdAt },
      { ...conversationB, updatedAt: leafB.createdAt },
    ])
    const runId = beginStreaming()
    await loadBackgroundPeer()
    const beforeNodes = useConversationStore.getState().nodesById

    expect(
      useConversationStore
        .getState()
        .completeGeneration(runId, generationId, completedNode()),
    ).toBe(true)

    expect(runFor(conversation.id)).toBeUndefined()
    expect(useConversationStore.getState().nodesById).toBe(beforeNodes)
    expect(useConversationStore.getState().conversationId).toBe(
      conversationB.id,
    )
    expect(
      useConversationStore
        .getState()
        .history.summaries.find((summary) => summary.id === conversation.id)
        ?.updatedAt,
    ).toBe(completedNode().createdAt)
  })

  it("keeps streaming in the background across a conversation switch and re-attaches focus on return", async () => {
    await loadActiveUser()
    const runId = beginStreaming("CROSS_SWITCH_PARTIAL")
    await loadBackgroundPeer()

    expect(runFor(conversation.id)?.phase).toBe("streaming")
    expect(selectActiveRunIds(useConversationStore.getState())).toContain(
      conversation.id,
    )
    // Content keeps accumulating while backgrounded.
    expect(
      useConversationStore.getState().appendGenerationDelta(runId, {
        type: "delta",
        generationId,
        content: "+MORE",
      }),
    ).toBe(true)
    expect(runFor(conversation.id)).toMatchObject({
      content: "CROSS_SWITCH_PARTIAL+MORE",
    })

    // The newest leaf drifted to the sibling, but the run's parent must win.
    const drifted: ConversationTreeView = {
      ...tree,
      nodes: [
        nodes.root,
        nodes.assistant,
        { ...nodes.left, createdAt: 9 },
        nodes.right,
      ],
    }
    const client = {
      ...createClient(),
      loadConversationTree: () => Promise.resolve(drifted),
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(client, conversation.id)

    expect(useConversationStore.getState().activeNodeId).toBe(nodes.right.id)
    expect(useConversationStore.getState().expandedIds).toContain(
      nodes.right.id,
    )
    expect(isRunActive(runFor(conversation.id))).toBe(true)
  })

  it("allows node selection while the conversation's own run is active", async () => {
    await loadActiveUser()
    beginStreaming()

    useConversationStore.getState().selectNode(nodes.left.id)

    expect(useConversationStore.getState().activeNodeId).toBe(nodes.left.id)
    expect(isRunActive(runFor(conversation.id))).toBe(true)
  })

  it("locks mutations only for the conversation with the active run", async () => {
    const client = createClient()
    const flatClient = {
      ...client,
      loadConversationTree: () => Promise.resolve(flatTree),
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(flatClient, conversation.id)
    useConversationStore.getState().selectNode(regeneratedParent.id)
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return
    expect(runFor(conversation.id)?.priorChildIds).toEqual([
      oldAssistantChild.id,
    ])

    // Same conversation: the assistant leaf is appendable in shape, but the
    // active run must block it.
    useConversationStore.getState().selectNode(assistantLeaf.id)
    await useConversationStore.getState().appendNode(client, "BLOCKED")
    expect(client.appendNode).not.toHaveBeenCalled()

    // A different conversation keeps mutating freely.
    await loadBackgroundPeer()
    const backgroundClient = {
      ...client,
      createBranch: vi.fn<ConversationClient["createBranch"]>(() =>
        Promise.resolve<ConversationNodeView>({
          ...leafB,
          id: "branched-user",
          parentId: assistantB.id,
          conversationId: conversationB.id,
          role: "user",
          createdAt: 7,
        }),
      ),
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .createBranch(backgroundClient, assistantB.id, "ALLOWED")
    expect(backgroundClient.createBranch).toHaveBeenCalledTimes(1)
  })

  it("recovers a background regeneration without mistaking the prior child", async () => {
    const client = createClient()
    const flatClient = {
      ...client,
      loadConversationTree: () => Promise.resolve(flatTree),
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(flatClient, conversation.id)
    useConversationStore.getState().selectNode(regeneratedParent.id)
    seedHistory([
      { ...conversation, updatedAt: oldAssistantChild.createdAt },
      { ...conversationB, updatedAt: leafB.createdAt },
    ])
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return
    await loadBackgroundPeer()

    // Only the pre-run child exists: the run cannot be proven completed.
    expect(
      useConversationStore.getState().recoverGeneration(runId, flatTree),
    ).toBe(false)
    expect(isRunActive(runFor(conversation.id))).toBe(true)

    const freshChild: ConversationNodeView = {
      ...completedNode(),
      id: "fresh-assistant-child",
      parentId: regeneratedParent.id,
      createdAt: 9,
    }
    const resolved: ConversationTreeView = {
      ...flatTree,
      nodes: [...flatTree.nodes, freshChild],
      nodesById: {
        ...flatTree.nodesById,
        [regeneratedParent.id]: {
          ...flatTree.nodesById[regeneratedParent.id]!,
          childIds: [oldAssistantChild.id, freshChild.id],
        },
        [freshChild.id]: {
          id: freshChild.id,
          parentId: regeneratedParent.id,
          role: "assistant",
          preview: freshChild.content,
          childIds: [],
        },
      },
    }
    expect(
      useConversationStore.getState().recoverGeneration(runId, resolved),
    ).toBe(true)
    expect(runFor(conversation.id)).toBeUndefined()
    expect(useConversationStore.getState().conversationId).toBe(
      conversationB.id,
    )
    expect(
      useConversationStore
        .getState()
        .history.summaries.find((summary) => summary.id === conversation.id)
        ?.updatedAt,
    ).toBe(9)
  })

  it("keeps a failed record for re-entry and clears it on the next mutation", async () => {
    const client = createClient()
    const flatClient = {
      ...client,
      loadConversationTree: () => Promise.resolve(flatTree),
    } satisfies ConversationClient
    await useConversationStore
      .getState()
      .loadConversation(flatClient, conversation.id)
    useConversationStore.getState().selectNode(regeneratedParent.id)
    const runId = useConversationStore.getState().beginGeneration()
    expect(runId).not.toBeNull()
    if (runId === null) return
    expect(
      useConversationStore.getState().failGeneration(
        runId,
        {
          code: "provider_unavailable",
          message: "生成失败。",
          retryable: true,
        },
        undefined,
        "generation",
      ),
    ).toBe(true)

    // Re-entry focuses the failed run's parent and keeps the record visible.
    await useConversationStore
      .getState()
      .loadConversation(flatClient, conversation.id)
    expect(runFor(conversation.id)).toMatchObject({
      phase: "failed",
      parentNodeId: regeneratedParent.id,
    })
    expect(useConversationStore.getState().activeNodeId).toBe(
      regeneratedParent.id,
    )

    // A successful append in the same conversation supersedes the record.
    const appendClient = {
      ...flatClient,
      appendNode: vi.fn<ConversationClient["appendNode"]>(() =>
        Promise.resolve<ConversationNodeView>({
          ...leafB,
          id: "appended-user",
          parentId: assistantLeaf.id,
          conversationId: conversation.id,
          role: "user",
          createdAt: 7,
        }),
      ),
    } satisfies ConversationClient
    useConversationStore.getState().selectNode(assistantLeaf.id)
    await useConversationStore.getState().appendNode(appendClient, "NEXT")
    expect(appendClient.appendNode).toHaveBeenCalledTimes(1)
    expect(runFor(conversation.id)).toBeUndefined()
  })
})
