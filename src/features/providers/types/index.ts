import type {
  ConversationNodeView,
  UiError,
} from "@/features/conversations/types"

export type ProviderProtocol = "openai_compatible" | "anthropic"

export type ProviderView = {
  id: string
  name: string
  protocol: ProviderProtocol
  baseEndpoint: string
  model: string
  models: readonly string[]
  hasApiKey: boolean
  createdAt: number
  updatedAt: number
}

export type TitleModelBinding = {
  providerId: string
  model: string
}

export type ApiKeyInputAction =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "remove" }

export type SaveProviderInput = {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseEndpoint: string
  model: string
  models: readonly string[]
  apiKey: ApiKeyInputAction
}

export type ListProvidersView = {
  providers: readonly ProviderView[]
  activeProviderId: string | null
  autoGenerateTitle: boolean
  titleModelBinding: TitleModelBinding | null
}

export type ModelSummaryView = {
  id: string
  displayName?: string
}

export type ModelListSource =
  | { type: "saved"; providerId: string }
  | {
      type: "draft"
      protocol: ProviderProtocol
      baseEndpoint: string
      apiKey?: string
    }

export type ReasoningEffort = "low" | "medium" | "high"

export type CancelGenerationView = { accepted: boolean }

export type GenerationEventView =
  | {
      type: "started"
      generationId: string
      conversationId: string
      activeNodeId: string
      model: string
    }
  | { type: "delta"; generationId: string; content: string }
  | { type: "thinking_delta"; generationId: string; content: string }

export type GenerationTerminalView =
  | {
      type: "completed"
      generationId: string
      node: ConversationNodeView
    }
  | { type: "cancelled"; generationId: string }
  | {
      type: "failed"
      generationId: string
      stage: "generation" | "persistence"
      error: UiError
    }
