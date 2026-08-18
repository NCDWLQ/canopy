export type {
  ConversationNodeView,
  JsonValue,
  NodeRole,
  UiError,
  UiErrorCode,
} from "@/lib/tauri/types"

import type {
  ConversationNodeView,
  JsonValue,
  NodeRole,
} from "@/lib/tauri/types"

export type ConversationView = {
  id: string
  title: string
  rootNodeId: string
  isArchived: boolean
  providerId?: string | null
  model?: string | null
  reasoningEffort?: "low" | "medium" | "high" | null
}

export type ConversationSummaryView = ConversationView & {
  updatedAt: number
}

export type TreeNodeView = {
  id: string
  parentId?: string
  role: NodeRole
  preview: string
  childIds: readonly string[]
}

export type ConversationTreeView = {
  conversation: ConversationView
  rootNodeId: string
  nodesById: Readonly<Record<string, TreeNodeView>>
  nodes: readonly ConversationNodeView[]
}

export type PathMessageView = {
  id: string
  role: NodeRole
  content: string
  model?: string
  createdAt: number
  metadata: JsonValue
  thinking?: string
}

export type ActivePathView = {
  conversationId: string
  activeNodeId: string
  path: readonly PathMessageView[]
}
