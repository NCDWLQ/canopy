import { invoke as tauriInvoke } from "@tauri-apps/api/core"
import type { z } from "zod"

import type {
  ActivePathView,
  ConversationNodeView,
  ConversationTreeView,
  ConversationView,
  PathMessageView,
  TreeNodeView,
  UiError,
  UiErrorCode,
} from "@/features/conversations/types"

import {
  activePathDtoSchema,
  appendNodeRequestSchema,
  archiveConversationRequestSchema,
  commandErrorSchema,
  conversationDtoSchema,
  conversationTreeDtoSchema,
  createBranchRequestSchema,
  createConversationRequestSchema,
  editNodeAsBranchRequestSchema,
  loadActivePathRequestSchema,
  loadConversationTreeRequestSchema,
  nodeDtoSchema,
  type ActivePathDto,
  type ConversationDto,
  type ConversationTreeDto,
  type NodeDto,
} from "./schemas"

export const CONVERSATION_COMMANDS = {
  createConversation: "create_conversation",
  appendNode: "append_node",
  createBranch: "create_branch",
  editNodeAsBranch: "edit_node_as_branch",
  loadConversationTree: "load_conversation_tree",
  loadActivePath: "load_active_path",
  archiveConversation: "archive_conversation",
} as const

export interface InvokeTransport {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>
}

export class ConversationCommandError extends Error implements UiError {
  readonly code: UiErrorCode
  readonly retryable: boolean
  readonly details?: UiError["details"]

  constructor(error: UiError) {
    super(error.message)
    this.name = "ConversationCommandError"
    this.code = error.code
    this.retryable = error.retryable
    if (error.details !== undefined) this.details = error.details
  }
}

const defaultTransport: InvokeTransport = {
  invoke(command, args) {
    return tauriInvoke<unknown>(command, args)
  },
}

export type CreateConversationInput = { title: string; content: string }
export type AppendNodeInput = {
  conversationId: string
  parentNodeId: string
  content: string
}
export type CreateBranchInput = AppendNodeInput
export type EditNodeAsBranchInput = {
  conversationId: string
  sourceNodeId: string
  content: string
}

export type ConversationClient = ReturnType<typeof createConversationClient>

export function createConversationClient(
  transport: InvokeTransport = defaultTransport,
) {
  return {
    createConversation(input: CreateConversationInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.createConversation,
        createConversationRequestSchema,
        { title: input.title, content: input.content },
        conversationTreeDtoSchema,
        mapConversationTree,
      )
    },

    appendNode(input: AppendNodeInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.appendNode,
        appendNodeRequestSchema,
        {
          conversation_id: input.conversationId,
          parent_node_id: input.parentNodeId,
          content: input.content,
        },
        nodeDtoSchema,
        mapNode,
      )
    },

    createBranch(input: CreateBranchInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.createBranch,
        createBranchRequestSchema,
        {
          conversation_id: input.conversationId,
          parent_node_id: input.parentNodeId,
          content: input.content,
        },
        nodeDtoSchema,
        mapNode,
      )
    },

    editNodeAsBranch(input: EditNodeAsBranchInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.editNodeAsBranch,
        editNodeAsBranchRequestSchema,
        {
          conversation_id: input.conversationId,
          source_node_id: input.sourceNodeId,
          content: input.content,
        },
        nodeDtoSchema,
        mapNode,
      )
    },

    loadConversationTree(conversationId: string) {
      return call(
        transport,
        CONVERSATION_COMMANDS.loadConversationTree,
        loadConversationTreeRequestSchema,
        { conversation_id: conversationId },
        conversationTreeDtoSchema,
        mapConversationTree,
      )
    },

    loadActivePath(conversationId: string, activeNodeId: string) {
      return call(
        transport,
        CONVERSATION_COMMANDS.loadActivePath,
        loadActivePathRequestSchema,
        { conversation_id: conversationId, active_node_id: activeNodeId },
        activePathDtoSchema,
        mapActivePath,
      )
    },

    archiveConversation(conversationId: string) {
      return call(
        transport,
        CONVERSATION_COMMANDS.archiveConversation,
        archiveConversationRequestSchema,
        { conversation_id: conversationId },
        conversationDtoSchema,
        mapConversation,
      )
    },
  }
}

async function call<TWire, TResponse, TResult>(
  transport: InvokeTransport,
  command: string,
  requestSchema: z.ZodType<TWire>,
  request: unknown,
  responseSchema: z.ZodType<TResponse>,
  project: (value: TResponse) => TResult,
): Promise<TResult> {
  const parsedRequest = requestSchema.safeParse(request)
  if (!parsedRequest.success) {
    throw invalidInputError()
  }

  let value: unknown
  try {
    value = await transport.invoke(command, { request: parsedRequest.data })
  } catch (error: unknown) {
    throw normalizeCommandError(error)
  }

  const parsedResponse = responseSchema.safeParse(value)
  if (!parsedResponse.success) {
    throw internalError()
  }

  try {
    return project(parsedResponse.data)
  } catch {
    throw internalError()
  }
}

export function normalizeCommandError(
  value: unknown,
): ConversationCommandError {
  const parsed = commandErrorSchema.safeParse(value)
  if (!parsed.success) {
    return internalError()
  }
  return new ConversationCommandError({
    code: parsed.data.code,
    message: parsed.data.message,
    retryable: parsed.data.retryable,
    ...(parsed.data.details === undefined
      ? {}
      : { details: parsed.data.details }),
  })
}

function invalidInputError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "invalid_input",
    message: "The request contains invalid input.",
    retryable: false,
  })
}

function internalError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "internal",
    message: "An unexpected error occurred.",
    retryable: false,
  })
}

function mapConversation(dto: ConversationDto): ConversationView {
  return {
    id: dto.id,
    title: dto.title,
    rootNodeId: dto.root_node_id,
    isArchived: dto.is_archived,
  }
}

function mapNode(dto: NodeDto): ConversationNodeView {
  return {
    id: dto.id,
    ...(dto.parent_id === null ? {} : { parentId: dto.parent_id }),
    conversationId: dto.conversation_id,
    role: dto.role,
    content: dto.content,
    ...(dto.model === null ? {} : { model: dto.model }),
    createdAt: dto.created_at,
    metadata: dto.metadata,
  }
}

function mapConversationTree(dto: ConversationTreeDto): ConversationTreeView {
  const conversation = mapConversation(dto.conversation)
  const nodes = dto.nodes.map(mapNode)
  const nodesById = new Map<string, TreeNodeView>()

  for (const node of nodes) {
    if (node.conversationId !== conversation.id || nodesById.has(node.id)) {
      throw new Error("invalid conversation tree")
    }
    nodesById.set(node.id, {
      id: node.id,
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
      role: node.role,
      preview: node.content,
      childIds: [],
    })
  }

  for (const node of nodes) {
    if (node.parentId === undefined) continue
    const parent = nodesById.get(node.parentId)
    if (parent === undefined) throw new Error("missing parent")
    nodesById.set(parent.id, {
      ...parent,
      childIds: [...parent.childIds, node.id],
    })
  }

  const root = nodesById.get(conversation.rootNodeId)
  const structuralRootCount = nodes.filter(
    (node) => node.parentId === undefined,
  ).length
  if (
    root === undefined ||
    root.parentId !== undefined ||
    structuralRootCount !== 1
  ) {
    throw new Error("missing root")
  }

  const reachableIds = new Set<string>()
  const pendingIds = [root.id]
  while (pendingIds.length > 0) {
    const nodeId = pendingIds.pop()
    if (nodeId === undefined || reachableIds.has(nodeId)) {
      throw new Error("invalid conversation tree")
    }
    const node = nodesById.get(nodeId)
    if (node === undefined) throw new Error("missing node")
    reachableIds.add(nodeId)
    pendingIds.push(...node.childIds)
  }
  if (reachableIds.size !== nodesById.size) {
    throw new Error("disconnected conversation tree")
  }
  const normalizedNodesById = Object.fromEntries(nodesById)
  Object.setPrototypeOf(normalizedNodesById, null)

  return {
    conversation,
    rootNodeId: conversation.rootNodeId,
    nodesById: normalizedNodesById,
    nodes,
  }
}

function mapActivePath(dto: ActivePathDto): ActivePathView {
  const nodes = dto.nodes.map(mapNode)
  if (
    nodes.length === 0 ||
    new Set(nodes.map((node) => node.id)).size !== nodes.length ||
    nodes.some((node) => node.conversationId !== dto.conversation_id) ||
    nodes.at(-1)?.id !== dto.active_node_id ||
    nodes.some((node, index) =>
      index === 0
        ? node.parentId !== undefined
        : node.parentId !== nodes[index - 1]?.id,
    )
  ) {
    throw new Error("invalid active path")
  }

  const path: PathMessageView[] = nodes.map((node) => ({
    id: node.id,
    role: node.role,
    content: node.content,
    ...(node.model === undefined ? {} : { model: node.model }),
    createdAt: node.createdAt,
    metadata: node.metadata,
  }))
  return {
    conversationId: dto.conversation_id,
    activeNodeId: dto.active_node_id,
    path,
  }
}
