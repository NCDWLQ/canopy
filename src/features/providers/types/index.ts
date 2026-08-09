import type {
  ConversationNodeView,
  UiError,
} from "@/features/conversations/types"

export type ProviderProfileView = {
  baseEndpoint: string
  model: string
  hasApiKey: boolean
  updatedAt: number
}

export type ApiKeyInputAction =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "remove" }

export type SaveProviderProfileInput = {
  baseEndpoint: string
  model: string
  apiKey: ApiKeyInputAction
}

export type GenerationStartView = { generationId: string }
export type CancelGenerationView = { accepted: boolean }
export type CommitGenerationView = { accepted: boolean }

export type GenerationEventView =
  | {
      type: "started"
      generationId: string
      conversationId: string
      activeNodeId: string
      model: string
    }
  | { type: "delta"; generationId: string; content: string }
  | {
      type: "ready_to_commit"
      generationId: string
      commitToken: string
    }
  | {
      type: "completed"
      generationId: string
      node: ConversationNodeView
    }
  | { type: "failed"; generationId?: string; error: UiError }
  | { type: "cancelled"; generationId: string }
