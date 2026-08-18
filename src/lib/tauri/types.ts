export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type NodeRole = "system" | "user" | "assistant" | "tool"

export type ConversationNodeView = {
  id: string
  parentId?: string
  conversationId: string
  role: NodeRole
  content: string
  model?: string
  createdAt: number
  metadata: JsonValue
  thinking?: string
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
