import { invoke as tauriInvoke } from "@tauri-apps/api/core"
import type { z } from "zod"

import type {
  ActivePathView,
  ConversationSummaryView,
  ConversationTreeView,
  ConversationView,
  PathMessageView,
  TreeNodeView,
} from "@/features/conversations/types"
import { t } from "@/lib/i18n"
import type { ConversationNodeView, UiError, UiErrorCode } from "./types"

import {
  activePathDtoSchema,
  appendNodeRequestSchema,
  archiveConversationRequestSchema,
  commandErrorSchema,
  conversationDtoSchema,
  conversationSummariesDtoSchema,
  conversationTreeDtoSchema,
  createBranchRequestSchema,
  createConversationRequestSchema,
  editNodeAsBranchRequestSchema,
  loadActivePathRequestSchema,
  listConversationsRequestSchema,
  loadConversationTreeRequestSchema,
  nodeDtoSchema,
  setConversationProviderRequestSchema,
  conversationProviderBindingResultSchema,
  writeExportFileRequestSchema,
  writeExportFileResultSchema,
  type ActivePathDto,
  type ConversationDto,
  type ConversationSummaryDto,
  type ConversationTreeDto,
  type NodeDto,
  type ConversationProviderBindingResultDto,
  type WriteExportFileResultDto,
} from "./schemas"

export const CONVERSATION_COMMANDS = {
  createConversation: "create_conversation",
  appendNode: "append_node",
  createBranch: "create_branch",
  editNodeAsBranch: "edit_node_as_branch",
  listConversations: "list_conversations",
  loadConversationTree: "load_conversation_tree",
  loadActivePath: "load_active_path",
  archiveConversation: "archive_conversation",
  setConversationProvider: "set_conversation_provider",
  writeExportFile: "write_export_file",
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

export const defaultTransport: InvokeTransport = {
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
export type SetConversationProviderInput = {
  conversationId: string
  binding: { providerId: string; model: string } | null
  reasoningEffort: "low" | "medium" | "high" | null
}
export type WriteExportFileInput = { path: string; content: string }
export type WriteExportFileResult = { bytesWritten: number }

export type ConversationClient = Omit<
  ReturnType<typeof createConversationClient>,
  "setConversationProvider"
> & {
  setConversationProvider?: ReturnType<
    typeof createConversationClient
  >["setConversationProvider"]
}

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

    listConversations() {
      return call(
        transport,
        CONVERSATION_COMMANDS.listConversations,
        listConversationsRequestSchema,
        {},
        conversationSummariesDtoSchema,
        (summaries) => summaries.map(mapConversationSummary),
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

    setConversationProvider(input: SetConversationProviderInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.setConversationProvider,
        setConversationProviderRequestSchema,
        {
          conversation_id: input.conversationId,
          binding:
            input.binding === null
              ? null
              : {
                  provider_id: input.binding.providerId,
                  model: input.binding.model,
                },
          reasoning_effort: input.reasoningEffort,
        },
        conversationProviderBindingResultSchema,
        mapConversationProviderBinding,
      )
    },

    writeExportFile(input: WriteExportFileInput) {
      return call(
        transport,
        CONVERSATION_COMMANDS.writeExportFile,
        writeExportFileRequestSchema,
        { path: input.path, content: input.content },
        writeExportFileResultSchema,
        mapWriteExportFileResult,
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

// Local fallback errors keep the wire contract (code/message/retryable); the
// message text is localized for debug inspection while display sites use
// commandErrorMessage(code).
function invalidInputError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "invalid_input",
    message: t("errors.invalidInput"),
    retryable: false,
  })
}

export function internalError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "internal",
    message: t("errors.internal"),
    retryable: false,
  })
}

function mapConversation(dto: ConversationDto): ConversationView {
  return {
    id: dto.id,
    title: dto.title,
    rootNodeId: dto.root_node_id,
    isArchived: dto.is_archived,
    providerId: dto.provider_id ?? null,
    model: dto.model ?? null,
    reasoningEffort: dto.reasoning_effort ?? null,
  }
}

function mapConversationSummary(
  dto: ConversationSummaryDto,
): ConversationSummaryView {
  return {
    ...mapConversation(dto),
    updatedAt: dto.updated_at,
  }
}

export function mapNode(dto: NodeDto): ConversationNodeView {
  const thinking =
    dto.role === "assistant" &&
    dto.metadata !== null &&
    !Array.isArray(dto.metadata) &&
    typeof dto.metadata === "object" &&
    typeof (dto.metadata as Readonly<Record<string, unknown>>).thinking ===
      "string"
      ? (dto.metadata as Readonly<Record<string, string>>).thinking
      : undefined
  return {
    id: dto.id,
    ...(dto.parent_id === null ? {} : { parentId: dto.parent_id }),
    conversationId: dto.conversation_id,
    role: dto.role,
    content: dto.content,
    ...(dto.model === null ? {} : { model: dto.model }),
    createdAt: dto.created_at,
    metadata: dto.metadata,
    ...(thinking === undefined ? {} : { thinking }),
  }
}

function mapConversationProviderBinding(
  dto: ConversationProviderBindingResultDto,
): Pick<ConversationView, "id" | "providerId" | "model" | "reasoningEffort"> {
  return {
    id: dto.conversation_id,
    providerId: dto.provider_id ?? null,
    model: dto.model ?? null,
    reasoningEffort: dto.reasoning_effort ?? null,
  }
}

function mapWriteExportFileResult(
  dto: WriteExportFileResultDto,
): WriteExportFileResult {
  return { bytesWritten: dto.bytes_written }
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
    ...(node.thinking === undefined ? {} : { thinking: node.thinking }),
  }))
  return {
    conversationId: dto.conversation_id,
    activeNodeId: dto.active_node_id,
    path,
  }
}
