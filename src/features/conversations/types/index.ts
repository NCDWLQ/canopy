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

export type SearchHitView = {
  nodeId: string
  role: NodeRole
  createdAt: number
  snippet: string
}

export type ConversationSearchResultView = {
  conversationId: string
  title: string
  isArchived: boolean
  titleMatched: boolean
  updatedAt: number
  hits: readonly SearchHitView[]
}

// One-shot reveal request produced by picking a search result or a mind-map
// node: the pane switches to the hit's branch, scrolls to the message, and
// highlights matches until the next navigation clears it. Mind-map clicks
// pass an empty query (scroll positioning only, no highlighting).
export type SearchReveal = {
  conversationId: string
  nodeId: string | null
  query: string
}
