import { Channel } from "@tauri-apps/api/core"

import type {
  GenerationEventView,
  ProviderProfileView,
  SaveProviderProfileInput,
} from "@/features/providers/types"

import {
  ConversationCommandError,
  defaultTransport,
  internalError,
  mapNode,
  normalizeCommandError,
  type InvokeTransport,
} from "./client"
import {
  cancelGenerationRequestSchema,
  cancelGenerationResultSchema,
  commitGenerationRequestSchema,
  commitGenerationResultSchema,
  deleteProviderProfileResultSchema,
  emptyProviderRequestSchema,
  generateFromActivePathRequestSchema,
  generationEventDtoSchema,
  generationIdProbeSchema,
  generationStartResultSchema,
  providerProfileDtoSchema,
  saveProviderProfileRequestSchema,
  type GenerationEventDto,
  type ProviderProfileDto,
} from "./provider-schemas"

export const PROVIDER_COMMANDS = {
  saveProviderProfile: "save_provider_profile",
  loadProviderProfile: "load_provider_profile",
  deleteProviderProfile: "delete_provider_profile",
  generateFromActivePath: "generate_from_active_path",
  cancelGeneration: "cancel_generation",
  commitGeneration: "commit_generation",
} as const

export type ChannelLike = object

export interface ChannelFactory {
  create(onMessage: (value: unknown) => void): ChannelLike
}

const defaultChannelFactory: ChannelFactory = {
  create(onMessage) {
    return new Channel<unknown>(onMessage)
  },
}

export type ProviderClient = ReturnType<typeof createProviderClient>

const MAX_GENERATED_CONTENT_BYTES = 1024 * 1024

export function createProviderClient(
  transport: InvokeTransport = defaultTransport,
  channelFactory: ChannelFactory = defaultChannelFactory,
) {
  return {
    async saveProviderProfile(
      input: SaveProviderProfileInput,
    ): Promise<ProviderProfileView> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.saveProviderProfile,
        saveProviderProfileRequestSchema,
        {
          base_endpoint: input.baseEndpoint,
          model: input.model,
          api_key: input.apiKey,
        },
        providerProfileDtoSchema,
        mapProviderProfile,
      )
    },

    async loadProviderProfile(): Promise<ProviderProfileView> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.loadProviderProfile,
        emptyProviderRequestSchema,
        {},
        providerProfileDtoSchema,
        mapProviderProfile,
      )
    },

    async deleteProviderProfile(): Promise<boolean> {
      const result = await providerCall(
        transport,
        PROVIDER_COMMANDS.deleteProviderProfile,
        emptyProviderRequestSchema,
        {},
        deleteProviderProfileResultSchema,
        (value) => value,
      )
      return result.deleted
    },

    async generateFromActivePath(
      conversationId: string,
      activeNodeId: string,
      onEvent: (event: GenerationEventView) => void,
    ): Promise<{ generationId: string }> {
      const request = generateFromActivePathRequestSchema.safeParse({
        conversation_id: conversationId,
        active_node_id: activeNodeId,
      })
      if (!request.success) throw invalidInputError()

      let generationId: string | undefined
      let startedModel: string | undefined
      let streamedContent = ""
      let streamedBytes = 0
      let phase: "waiting" | "streaming" | "awaiting_commit" | "terminal" =
        "waiting"
      const failClosed = (value: unknown) => {
        if (phase === "terminal") return
        const rawGenerationId = readGenerationId(value)
        const cancellationId = generationId ?? rawGenerationId
        phase = "terminal"
        if (cancellationId !== undefined) {
          void requestCancellation(transport, cancellationId)
        }
        onEvent({
          type: "failed",
          ...(cancellationId === undefined
            ? {}
            : { generationId: cancellationId }),
          error: internalError(),
        })
      }
      const onMessage = (value: unknown) => {
        const parsed = generationEventDtoSchema.safeParse(value)
        if (
          !parsed.success ||
          !isValidTransition(
            parsed.data,
            phase,
            generationId,
            conversationId,
            activeNodeId,
            startedModel,
            streamedContent,
          )
        ) {
          failClosed(value)
          return
        }
        if (parsed.data.type === "started") {
          generationId = parsed.data.generation_id
          startedModel = parsed.data.model
          phase = "streaming"
        } else if (parsed.data.type === "delta") {
          const deltaBytes = new TextEncoder().encode(
            parsed.data.content,
          ).byteLength
          if (streamedBytes + deltaBytes > MAX_GENERATED_CONTENT_BYTES) {
            failClosed(value)
            return
          }
          streamedBytes += deltaBytes
          streamedContent += parsed.data.content
        } else if (parsed.data.type === "ready_to_commit") {
          phase = "awaiting_commit"
        } else if (
          parsed.data.type === "completed" ||
          parsed.data.type === "failed" ||
          parsed.data.type === "cancelled"
        ) {
          phase = "terminal"
        }
        onEvent(mapGenerationEvent(parsed.data))
      }
      const onEventChannel = channelFactory.create(onMessage)

      let value: unknown
      try {
        value = await transport.invoke(
          PROVIDER_COMMANDS.generateFromActivePath,
          {
            request: request.data,
            onEvent: onEventChannel,
          },
        )
      } catch (error: unknown) {
        if (generationId !== undefined) failClosed(error)
        throw normalizeCommandError(error)
      }
      const result = generationStartResultSchema.safeParse(value)
      if (!result.success) {
        failClosed(value)
        throw internalError()
      }
      if (
        generationId !== undefined &&
        generationId !== result.data.generation_id
      ) {
        failClosed(result.data)
        throw internalError()
      }
      generationId = result.data.generation_id
      return { generationId }
    },

    async cancelGeneration(
      generationId: string,
    ): Promise<{ accepted: boolean }> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.cancelGeneration,
        cancelGenerationRequestSchema,
        { generation_id: generationId },
        cancelGenerationResultSchema,
        (value) => value,
      )
    },

    async commitGeneration(
      generationId: string,
      commitToken: string,
    ): Promise<{ accepted: boolean }> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.commitGeneration,
        commitGenerationRequestSchema,
        { generation_id: generationId, commit_token: commitToken },
        commitGenerationResultSchema,
        (value) => value,
      )
    },
  }
}

async function providerCall<TWire, TResponse, TResult>(
  transport: InvokeTransport,
  command: string,
  requestSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TWire } | { success: false }
  },
  request: unknown,
  responseSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TResponse } | { success: false }
  },
  project: (value: TResponse) => TResult,
): Promise<TResult> {
  const parsedRequest = requestSchema.safeParse(request)
  if (!parsedRequest.success) throw invalidInputError()
  let value: unknown
  try {
    value = await transport.invoke(command, { request: parsedRequest.data })
  } catch (error: unknown) {
    throw normalizeCommandError(error)
  }
  const parsedResponse = responseSchema.safeParse(value)
  if (!parsedResponse.success) throw internalError()
  return project(parsedResponse.data)
}

async function requestCancellation(
  transport: InvokeTransport,
  generationId: string,
): Promise<void> {
  try {
    await transport.invoke(PROVIDER_COMMANDS.cancelGeneration, {
      request: { generation_id: generationId },
    })
  } catch {
    // The malformed event is already represented by one local terminal failure.
  }
}

function isValidTransition(
  event: GenerationEventDto,
  phase: "waiting" | "streaming" | "awaiting_commit" | "terminal",
  generationId: string | undefined,
  conversationId: string,
  activeNodeId: string,
  startedModel: string | undefined,
  streamedContent: string,
): boolean {
  if (phase === "terminal") return false
  if (event.type === "started") {
    return (
      phase === "waiting" &&
      (generationId === undefined || event.generation_id === generationId) &&
      event.conversation_id === conversationId &&
      event.active_node_id === activeNodeId
    )
  }
  if (
    (phase !== "streaming" && phase !== "awaiting_commit") ||
    event.generation_id !== generationId
  ) {
    return false
  }
  switch (event.type) {
    case "delta":
    case "ready_to_commit":
      return phase === "streaming"
    case "completed":
      return (
        phase === "awaiting_commit" &&
        event.node.conversation_id === conversationId &&
        event.node.parent_id === activeNodeId &&
        event.node.role === "assistant" &&
        event.node.model === startedModel &&
        event.node.content === streamedContent
      )
    case "failed":
    case "cancelled":
      return true
  }
}

function readGenerationId(value: unknown): string | undefined {
  const parsed = generationIdProbeSchema.safeParse(value)
  return parsed.success ? parsed.data.generation_id : undefined
}

function mapProviderProfile(dto: ProviderProfileDto): ProviderProfileView {
  return {
    baseEndpoint: dto.base_endpoint,
    model: dto.model,
    hasApiKey: dto.has_api_key,
    updatedAt: dto.updated_at,
  }
}

function mapGenerationEvent(dto: GenerationEventDto): GenerationEventView {
  switch (dto.type) {
    case "started":
      return {
        type: "started",
        generationId: dto.generation_id,
        conversationId: dto.conversation_id,
        activeNodeId: dto.active_node_id,
        model: dto.model,
      }
    case "delta":
      return {
        type: "delta",
        generationId: dto.generation_id,
        content: dto.content,
      }
    case "ready_to_commit":
      return {
        type: "ready_to_commit",
        generationId: dto.generation_id,
        commitToken: dto.commit_token,
      }
    case "completed":
      return {
        type: "completed",
        generationId: dto.generation_id,
        node: mapNode(dto.node),
      }
    case "failed":
      return {
        type: "failed",
        generationId: dto.generation_id,
        error: new ConversationCommandError(dto.error),
      }
    case "cancelled":
      return { type: "cancelled", generationId: dto.generation_id }
  }
}

function invalidInputError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "invalid_input",
    message: "The request contains invalid input.",
    retryable: false,
  })
}
