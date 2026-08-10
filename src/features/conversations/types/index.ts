export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type NodeRole = "system" | "user" | "assistant" | "tool"

export type ConversationView = {
  id: string
  title: string
  rootNodeId: string
  isArchived: boolean
}

export type ConversationSummaryView = ConversationView & {
  updatedAt: number
}

export type ConversationNodeView = {
  id: string
  parentId?: string
  conversationId: string
  role: NodeRole
  content: string
  model?: string
  createdAt: number
  metadata: JsonValue
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
}

export type ActivePathView = {
  conversationId: string
  activeNodeId: string
  path: readonly PathMessageView[]
}

export type UiErrorCode =
  | "invalid_input"
  | "not_found"
  | "tree_integrity"
  | "database_unavailable"
  | "migration_failure"
  | "provider_authentication"
  | "rate_limited"
  | "provider_unavailable"
  | "network_failure"
  | "cancelled"
  | "internal"

export type UiError = {
  code: UiErrorCode
  message: string
  retryable: boolean
  details?: Readonly<Record<string, JsonValue>>
}
