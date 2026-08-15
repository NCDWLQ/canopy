import { Channel } from "@tauri-apps/api/core"

import type {
  GenerationEventView,
  GenerationTerminalView,
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
  deleteProviderProfileResultSchema,
  emptyProviderRequestSchema,
  generateFromActivePathRequestSchema,
  generationEventDtoSchema,
  generationIdProbeSchema,
  generationTerminalDtoSchema,
  providerProfileDtoSchema,
  saveProviderProfileRequestSchema,
  type GenerationEventDto,
  type GenerationTerminalDto,
  type ProviderProfileDto,
} from "./provider-schemas"

export const PROVIDER_COMMANDS = {
  saveProviderProfile: "save_provider_profile",
  loadProviderProfile: "load_provider_profile",
  deleteProviderProfile: "delete_provider_profile",
  generateFromActivePath: "generate_from_active_path",
  cancelGeneration: "cancel_generation",
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

export class GenerationBridgeError extends ConversationCommandError {
  readonly generationId: string

  constructor(generationId: string) {
    super(internalError())
    this.name = "GenerationBridgeError"
    this.generationId = generationId
  }
}

export function generationIdFromBridgeError(
  error: unknown,
): string | undefined {
  return error instanceof GenerationBridgeError ? error.generationId : undefined
}

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
    ): Promise<GenerationTerminalView> {
      const request = generateFromActivePathRequestSchema.safeParse({
        conversation_id: conversationId,
        active_node_id: activeNodeId,
      })
      if (!request.success) throw invalidInputError()

      let generationId: string | undefined
      let startedModel: string | undefined
      let streamedBytes = 0
      let phase: "waiting" | "streaming" | "terminal" = "waiting"
      let channelFailure: ConversationCommandError | undefined
      let cancellationRequested = false

      const cancelKnownGeneration = (candidate?: string) => {
        const cancellationId = generationId ?? candidate
        if (cancellationId === undefined || cancellationRequested) return
        cancellationRequested = true
        void requestCancellation(transport, cancellationId)
      }

      const failClosed = (candidate?: string) => {
        if (phase === "terminal") return
        const failureGenerationId = generationId ?? candidate
        phase = "terminal"
        channelFailure =
          failureGenerationId === undefined
            ? internalError()
            : new GenerationBridgeError(failureGenerationId)
        cancelKnownGeneration(candidate)
      }

      const onMessage = (value: unknown) => {
        if (phase === "terminal") return
        const parsed = generationEventDtoSchema.safeParse(value)
        if (
          !parsed.success ||
          !isValidEventTransition(
            parsed.data,
            phase,
            generationId,
            conversationId,
            activeNodeId,
          )
        ) {
          failClosed(parsed.success ? parsed.data.generation_id : undefined)
          return
        }
        if (parsed.data.type === "started") {
          generationId = parsed.data.generation_id
          startedModel = parsed.data.model
          phase = "streaming"
        } else {
          const deltaBytes = new TextEncoder().encode(
            parsed.data.content,
          ).byteLength
          if (streamedBytes + deltaBytes > MAX_GENERATED_CONTENT_BYTES) {
            failClosed()
            return
          }
          streamedBytes += deltaBytes
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
        phase = "terminal"
        cancelKnownGeneration()
        throw channelFailure ?? normalizeCommandError(error)
      }

      if (channelFailure !== undefined) throw channelFailure
      const result = generationTerminalDtoSchema.safeParse(value)
      if (
        !result.success ||
        !isValidTerminal(
          result.data,
          generationId,
          conversationId,
          activeNodeId,
          startedModel,
        )
      ) {
        failClosed(
          result.success ? result.data.generation_id : readGenerationId(value),
        )
        throw channelFailure ?? internalError()
      }

      phase = "terminal"
      return mapGenerationTerminal(result.data)
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
    // The original protocol failure is already represented by the rejected call.
  }
}

function isValidEventTransition(
  event: GenerationEventDto,
  phase: "waiting" | "streaming" | "terminal",
  generationId: string | undefined,
  conversationId: string,
  activeNodeId: string,
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
  return phase === "streaming" && event.generation_id === generationId
}

function isValidTerminal(
  terminal: GenerationTerminalDto,
  generationId: string | undefined,
  conversationId: string,
  activeNodeId: string,
  startedModel: string | undefined,
): boolean {
  if (generationId !== undefined && terminal.generation_id !== generationId) {
    return false
  }
  if (terminal.type !== "completed") return true

  const node = terminal.node
  return (
    node.conversation_id === conversationId &&
    node.parent_id === activeNodeId &&
    (startedModel === undefined || node.model === startedModel) &&
    new TextEncoder().encode(node.content).byteLength <=
      MAX_GENERATED_CONTENT_BYTES
  )
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
  }
}

function mapGenerationTerminal(
  dto: GenerationTerminalDto,
): GenerationTerminalView {
  switch (dto.type) {
    case "completed":
      return {
        type: "completed",
        generationId: dto.generation_id,
        node: mapNode(dto.node),
      }
    case "cancelled":
      return { type: "cancelled", generationId: dto.generation_id }
    case "failed":
      return {
        type: "failed",
        generationId: dto.generation_id,
        stage: dto.stage,
        error: new ConversationCommandError(dto.error),
      }
  }
}

function invalidInputError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "invalid_input",
    message: "请求包含无效输入。",
    retryable: false,
  })
}
