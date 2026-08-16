import fixture from "../../../contract-fixtures/conversation-ipc.json"

import {
  CONVERSATION_COMMANDS,
  createConversationClient,
  normalizeCommandError,
  type InvokeTransport,
} from "./index"

type RecordedCall = { command: string; args: Record<string, unknown> }

function resolvingTransport(
  responses: Readonly<Record<string, unknown>>,
): InvokeTransport & {
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  return {
    calls,
    invoke(command, args) {
      calls.push({ command, args })
      return Promise.resolve(responses[command])
    },
  }
}

function rejectingTransport(error: Error): InvokeTransport {
  return {
    invoke() {
      return Promise.reject(error)
    },
  }
}

class WireDatabaseError extends Error {
  readonly code = "database_unavailable"
  readonly retryable = true
}

describe("conversation Tauri contract", () => {
  it("uses the shared exact command list and maps all nine request shapes", async () => {
    expect(Object.values(CONVERSATION_COMMANDS)).toEqual(fixture.command_names)
    const transport = resolvingTransport({
      create_conversation: fixture.successes.conversation_tree,
      append_node: fixture.successes.right_node,
      create_branch: fixture.successes.left_node,
      edit_node_as_branch: fixture.successes.right_node,
      list_conversations: fixture.successes.conversation_summaries,
      load_conversation_tree: fixture.successes.conversation_tree,
      load_active_path: fixture.successes.active_path,
      archive_conversation: fixture.successes.archived_conversation,
      set_conversation_provider: fixture.successes.set_conversation_provider,
    })
    const client = createConversationClient(transport)

    await client.createConversation({
      title: fixture.requests.create_conversation.title,
      content: fixture.requests.create_conversation.content,
    })
    await client.appendNode({
      conversationId: fixture.requests.append_node.conversation_id,
      parentNodeId: fixture.requests.append_node.parent_node_id,
      content: fixture.requests.append_node.content,
    })
    await client.createBranch({
      conversationId: fixture.requests.create_branch.conversation_id,
      parentNodeId: fixture.requests.create_branch.parent_node_id,
      content: fixture.requests.create_branch.content,
    })
    await client.editNodeAsBranch({
      conversationId: fixture.requests.edit_node_as_branch.conversation_id,
      sourceNodeId: fixture.requests.edit_node_as_branch.source_node_id,
      content: fixture.requests.edit_node_as_branch.content,
    })
    await client.listConversations()
    await client.loadConversationTree(
      fixture.requests.load_conversation_tree.conversation_id,
    )
    await client.loadActivePath(
      fixture.requests.load_active_path.conversation_id,
      fixture.requests.load_active_path.active_node_id,
    )
    await client.archiveConversation(
      fixture.requests.archive_conversation.conversation_id,
    )
    await client.setConversationProvider({
      conversationId:
        fixture.requests.set_conversation_provider.conversation_id,
      binding: {
        providerId:
          fixture.requests.set_conversation_provider.binding.provider_id,
        model: fixture.requests.set_conversation_provider.binding.model,
      },
      reasoningEffort: fixture.requests.set_conversation_provider
        .reasoning_effort as "low" | "medium" | "high",
    })

    const requests = Object.values(fixture.requests)
    expect(transport.calls).toEqual(
      fixture.command_names.map((command, index) => ({
        command,
        args: {
          request: requests[index],
        },
      })),
    )
  })

  it("validates and projects unique conversation summaries", async () => {
    const client = createConversationClient(
      resolvingTransport({
        list_conversations: fixture.successes.conversation_summaries,
      }),
    )
    await expect(client.listConversations()).resolves.toEqual([
      {
        id: "conversation-fixture",
        title: "Fixture conversation",
        rootNodeId: "root",
        isArchived: false,
        updatedAt: 1770000002124,
        providerId: null,
        model: null,
        reasoningEffort: null,
      },
      {
        id: "conversation-archived",
        title: "Archived fixture",
        rootNodeId: "archived-root",
        isArchived: true,
        updatedAt: 1760000000000,
        providerId: null,
        model: null,
        reasoningEffort: null,
      },
    ])

    const duplicate = [
      fixture.successes.conversation_summaries[0],
      fixture.successes.conversation_summaries[0],
    ]
    const duplicateClient = createConversationClient(
      resolvingTransport({ list_conversations: duplicate }),
    )
    await expect(duplicateClient.listConversations()).rejects.toMatchObject({
      code: "internal",
      retryable: false,
    })

    const malformedClient = createConversationClient(
      resolvingTransport({
        list_conversations: [
          { ...fixture.successes.conversation_summaries[0], updated_at: null },
        ],
      }),
    )
    await expect(malformedClient.listConversations()).rejects.toMatchObject({
      code: "internal",
      retryable: false,
    })
  })

  it("projects nullability, nested metadata, normalized children, and active path order", async () => {
    const transport = resolvingTransport({
      load_conversation_tree: fixture.successes.conversation_tree,
      load_active_path: fixture.successes.active_path,
    })
    const client = createConversationClient(transport)
    const tree = await client.loadConversationTree("conversation-fixture")

    expect(tree.conversation).toEqual({
      id: "conversation-fixture",
      title: "Fixture conversation",
      rootNodeId: "root",
      isArchived: false,
      providerId: null,
      model: null,
      reasoningEffort: null,
    })
    expect(tree.nodesById.root?.childIds).toEqual(["assistant-a"])
    expect(tree.nodesById["assistant-a"]?.childIds).toEqual([
      "user-left",
      "user-right",
    ])
    expect(tree.nodes[0]).not.toHaveProperty("parentId")
    expect(tree.nodes[0]).not.toHaveProperty("model")
    expect(tree.nodes[1]?.model).toBe("fixture-model")
    expect(tree.nodes[1]?.metadata).toEqual(
      fixture.successes.assistant_node.metadata,
    )
    expect(tree.nodes[1]?.createdAt).toBe(1770000001123)

    const activePath = await client.loadActivePath(
      "conversation-fixture",
      "user-right",
    )
    expect(activePath.path.map((node) => node.id)).toEqual([
      "root",
      "assistant-a",
      "user-right",
    ])
    expect(activePath.path.map((node) => node.content)).not.toContain(
      "LEFT_BRANCH_SENTINEL",
    )
  })

  it("validates every closed command error from the shared fixture", () => {
    for (const error of fixture.errors) {
      const normalized = normalizeCommandError(error)
      expect(normalized.code).toBe(error.code)
      expect(normalized.retryable).toBe(error.retryable)
      expect(normalized.message).toBe(error.message)
      if ("details" in error) expect(normalized.details).toEqual(error.details)
    }
  })

  it("normalizes a structured transport rejection before exposing it", async () => {
    const client = createConversationClient(
      rejectingTransport(new WireDatabaseError("Database unavailable.")),
    )
    await expect(
      client.loadConversationTree("conversation-fixture"),
    ).rejects.toMatchObject({
      code: "database_unavailable",
      message: "Database unavailable.",
      retryable: true,
    })
  })

  it("normalizes malformed and unknown rejections to a safe internal error", async () => {
    for (const malformed of fixture.malformed_errors) {
      expect(normalizeCommandError(malformed)).toMatchObject({
        code: "internal",
        message: "发生意外错误。",
        retryable: false,
      })
    }

    const client = createConversationClient(
      rejectingTransport(new Error("unstructured rejection")),
    )
    await expect(
      client.loadConversationTree("conversation-fixture"),
    ).rejects.toMatchObject({
      code: "internal",
      message: "发生意外错误。",
      retryable: false,
    })
  })

  it("rejects malformed resolved payloads including a node archive leak", async () => {
    for (const malformed of fixture.malformed_successes) {
      const client = createConversationClient(
        resolvingTransport({ append_node: malformed }),
      )
      await expect(
        client.appendNode({
          conversationId: "conversation-fixture",
          parentNodeId: "assistant-a",
          content: "valid",
        }),
      ).rejects.toMatchObject({ code: "internal", retryable: false })
    }

    const malformedCommands = fixture.malformed_command_successes
    const conversationClient = createConversationClient(
      resolvingTransport({
        archive_conversation: malformedCommands.archive_conversation,
      }),
    )
    await expect(
      conversationClient.archiveConversation("conversation-fixture"),
    ).rejects.toMatchObject({ code: "internal", retryable: false })

    const treeClient = createConversationClient(
      resolvingTransport({
        load_conversation_tree: malformedCommands.load_conversation_tree,
      }),
    )
    await expect(
      treeClient.loadConversationTree("conversation-fixture"),
    ).rejects.toMatchObject({ code: "internal", retryable: false })

    const pathClient = createConversationClient(
      resolvingTransport({
        load_active_path: malformedCommands.load_active_path,
      }),
    )
    await expect(
      pathClient.loadActivePath("conversation-fixture", "user-right"),
    ).rejects.toMatchObject({ code: "internal", retryable: false })
  })

  it("rejects structurally malformed tree and path projections", async () => {
    const duplicateRootTree = {
      ...fixture.successes.conversation_tree,
      nodes: [
        ...fixture.successes.conversation_tree.nodes,
        {
          ...fixture.successes.root_node,
          id: "second-root",
          content: "SECOND_ROOT_SENTINEL",
        },
      ],
    }
    const treeClient = createConversationClient(
      resolvingTransport({ load_conversation_tree: duplicateRootTree }),
    )
    await expect(
      treeClient.loadConversationTree("conversation-fixture"),
    ).rejects.toMatchObject({ code: "internal" })

    const disconnectedCycleTree = {
      ...fixture.successes.conversation_tree,
      nodes: [
        fixture.successes.root_node,
        {
          ...fixture.successes.left_node,
          parent_id: "user-right",
        },
        {
          ...fixture.successes.right_node,
          parent_id: "user-left",
        },
      ],
    }
    const cycleClient = createConversationClient(
      resolvingTransport({
        load_conversation_tree: disconnectedCycleTree,
      }),
    )
    await expect(
      cycleClient.loadConversationTree("conversation-fixture"),
    ).rejects.toMatchObject({ code: "internal" })

    const duplicatePath = {
      ...fixture.successes.active_path,
      nodes: [
        ...fixture.successes.active_path.nodes,
        {
          ...fixture.successes.right_node,
          parent_id: "user-right",
        },
      ],
    }
    const pathClient = createConversationClient(
      resolvingTransport({ load_active_path: duplicatePath }),
    )
    await expect(
      pathClient.loadActivePath("conversation-fixture", "user-right"),
    ).rejects.toMatchObject({ code: "internal" })
  })

  it("normalizes all opaque node IDs without object-prototype collisions", async () => {
    const opaqueIdTree = {
      conversation: {
        ...fixture.successes.conversation,
        root_node_id: "constructor",
      },
      nodes: [
        {
          ...fixture.successes.root_node,
          id: "constructor",
        },
        {
          ...fixture.successes.assistant_node,
          id: "toString",
          parent_id: "constructor",
        },
      ],
    }
    const client = createConversationClient(
      resolvingTransport({ load_conversation_tree: opaqueIdTree }),
    )

    const tree = await client.loadConversationTree("conversation-fixture")
    const rootId: string = opaqueIdTree.conversation.root_node_id
    const childId: string = opaqueIdTree.nodes[1]?.id ?? ""

    expect(tree.rootNodeId).toBe("constructor")
    expect(tree.nodesById[rootId]?.childIds).toEqual(["toString"])
    expect(tree.nodesById[childId]?.parentId).toBe("constructor")

    const ordinaryTree = await createConversationClient(
      resolvingTransport({
        load_conversation_tree: fixture.successes.conversation_tree,
      }),
    ).loadConversationTree("conversation-fixture")
    expect(ordinaryTree.nodesById[rootId]).toBeUndefined()
  })

  it("validates titles and content locally while preserving accepted content bytes", async () => {
    const transport = resolvingTransport({
      create_conversation: fixture.successes.conversation_tree,
    })
    const client = createConversationClient(transport)
    const preserved = "  code block\n    indented\n"
    await client.createConversation({
      title: "  Trim me  ",
      content: preserved,
    })
    expect(transport.calls[0]?.args).toEqual({
      request: { title: "Trim me", content: preserved },
    })

    await expect(
      client.createConversation({ title: " ", content: "valid" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "界".repeat(201), content: "valid" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "valid", content: " \n\t" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "valid", content: "\u0085" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "\u0085", content: "valid" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "valid", content: "\ud800" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({ title: "\udc00", content: "valid" }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.createConversation({
        title: "valid",
        content: "a".repeat(1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })

    await client.createConversation({
      title: "\u0085  Rust whitespace  \u0085",
      content: "\ufeff",
    })
    expect(transport.calls.at(-1)?.args).toEqual({
      request: { title: "Rust whitespace", content: "\ufeff" },
    })
  })
})
