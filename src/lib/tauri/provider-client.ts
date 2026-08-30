import { Channel } from "@tauri-apps/api/core"

import { t, type LocalePreference } from "@/lib/i18n"
import type { ThemePreference } from "@/lib/theme"
import type {
  GenerationEventView,
  GenerationTerminalView,
  ListProvidersView,
  ModelListSource,
  ModelSummaryView,
  ProviderView,
  SaveProviderInput,
  TitleModelBinding,
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
  deleteProviderRequestSchema,
  deleteProviderResultSchema,
  emptyProviderRequestSchema,
  generateFromActivePathRequestSchema,
  generationEventDtoSchema,
  generationIdProbeSchema,
  generationTerminalDtoSchema,
  listProviderModelsRequestSchema,
  listProviderModelsResultSchema,
  listProvidersResultSchema,
  providerDtoSchema,
  revealProviderApiKeyRequestSchema,
  revealProviderApiKeyResultSchema,
  saveProviderRequestSchema,
  setActiveProviderRequestSchema,
  setActiveProviderResultSchema,
  setAutoGenerateTitleRequestSchema,
  setAutoGenerateTitleResultSchema,
  setLanguageRequestSchema,
  setLanguageResultSchema,
  setDefaultSystemPromptRequestSchema,
  setDefaultSystemPromptResultSchema,
  setThemeRequestSchema,
  setThemeResultSchema,
  setTitleModelBindingRequestSchema,
  setTitleModelBindingResultSchema,
  type GenerationEventDto,
  type GenerationTerminalDto,
  type ListProvidersResultDto,
  type ModelSummaryDto,
  type ProviderDto,
} from "./provider-schemas"

export const PROVIDER_COMMANDS = {
  listProviders: "list_providers",
  saveProvider: "save_provider",
  deleteProvider: "delete_provider",
  setActiveProvider: "set_active_provider",
  setAutoGenerateTitle: "set_auto_generate_title",
  setTitleModelBinding: "set_title_model_binding",
  setLanguage: "set_language",
  setTheme: "set_theme",
  setDefaultSystemPrompt: "set_default_system_prompt",
  revealProviderApiKey: "reveal_provider_api_key",
  listProviderModels: "list_provider_models",
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
    async listProviders(): Promise<ListProvidersView> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.listProviders,
        emptyProviderRequestSchema,
        {},
        listProvidersResultSchema,
        mapListProviders,
      )
    },

    async saveProvider(input: SaveProviderInput): Promise<ProviderView> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.saveProvider,
        saveProviderRequestSchema,
        {
          ...(input.id === undefined ? {} : { id: input.id }),
          name: input.name,
          protocol: input.protocol,
          base_endpoint: input.baseEndpoint,
          model: input.model,
          models: input.models,
          api_key: input.apiKey,
        },
        // Save results must remain redacted as well.
        // A separate schema keeps an accidental API-key echo fail-closed.
        // The provider DTO is the complete authoritative result.
        providerDtoSchema,
        mapProvider,
      )
    },

    async deleteProvider(providerId: string): Promise<boolean> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.deleteProvider,
        deleteProviderRequestSchema,
        { provider_id: providerId },
        deleteProviderResultSchema,
        (value) => value.deleted,
      )
    },

    async setActiveProvider(providerId: string): Promise<string> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setActiveProvider,
        setActiveProviderRequestSchema,
        { provider_id: providerId },
        setActiveProviderResultSchema,
        (value) => value.active_provider_id,
      )
    },

    async setAutoGenerateTitle(enabled: boolean): Promise<boolean> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setAutoGenerateTitle,
        setAutoGenerateTitleRequestSchema,
        { enabled },
        setAutoGenerateTitleResultSchema,
        (value) => value.enabled,
      )
    },

    async setTitleModelBinding(
      binding: TitleModelBinding | null,
    ): Promise<TitleModelBinding | null> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setTitleModelBinding,
        setTitleModelBindingRequestSchema,
        {
          binding:
            binding === null
              ? null
              : {
                  provider_id: binding.providerId,
                  model: binding.model,
                },
        },
        setTitleModelBindingResultSchema,
        (value) =>
          value.binding === null
            ? null
            : {
                providerId: value.binding.provider_id,
                model: value.binding.model,
              },
      )
    },

    async setLanguage(language: LocalePreference): Promise<LocalePreference> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setLanguage,
        setLanguageRequestSchema,
        { language },
        setLanguageResultSchema,
        (value) => value.language,
      )
    },

    async setTheme(theme: ThemePreference): Promise<ThemePreference> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setTheme,
        setThemeRequestSchema,
        { theme },
        setThemeResultSchema,
        (value) => value.theme,
      )
    },

    async setDefaultSystemPrompt(
      prompt: string | null,
    ): Promise<string | null> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.setDefaultSystemPrompt,
        setDefaultSystemPromptRequestSchema,
        { prompt },
        setDefaultSystemPromptResultSchema,
        (value) => value.prompt,
      )
    },

    async revealProviderApiKey(providerId: string): Promise<string | null> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.revealProviderApiKey,
        revealProviderApiKeyRequestSchema,
        { provider_id: providerId },
        revealProviderApiKeyResultSchema,
        (value) => value.api_key,
      )
    },

    async listProviderModels(
      source: ModelListSource,
    ): Promise<readonly ModelSummaryView[]> {
      return providerCall(
        transport,
        PROVIDER_COMMANDS.listProviderModels,
        listProviderModelsRequestSchema,
        {
          source:
            source.type === "saved"
              ? { type: "saved", provider_id: source.providerId }
              : {
                  type: "draft",
                  protocol: source.protocol,
                  base_endpoint: source.baseEndpoint,
                  api_key: source.apiKey ?? null,
                },
        },
        listProviderModelsResultSchema,
        (value) => value.models.map(mapModelSummary),
      )
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
      let streamedThinkingBytes = 0
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
          const previousBytes =
            parsed.data.type === "thinking_delta"
              ? streamedThinkingBytes
              : streamedBytes
          if (previousBytes + deltaBytes > MAX_GENERATED_CONTENT_BYTES) {
            failClosed()
            return
          }
          if (parsed.data.type === "thinking_delta") {
            streamedThinkingBytes += deltaBytes
          } else {
            streamedBytes += deltaBytes
          }
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

function mapProvider(dto: ProviderDto): ProviderView {
  return {
    id: dto.id,
    name: dto.name,
    protocol: dto.protocol,
    baseEndpoint: dto.base_endpoint,
    model: dto.model,
    models: dto.models,
    hasApiKey: dto.has_api_key,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  }
}

function mapListProviders(dto: ListProvidersResultDto): ListProvidersView {
  return {
    providers: dto.providers.map(mapProvider),
    activeProviderId: dto.active_provider_id ?? null,
    autoGenerateTitle: dto.auto_generate_title,
    titleModelBinding:
      dto.title_model_binding === null
        ? null
        : {
            providerId: dto.title_model_binding.provider_id,
            model: dto.title_model_binding.model,
          },
    language: dto.language,
    theme: dto.theme,
    defaultSystemPrompt: dto.default_system_prompt,
  }
}

function mapModelSummary(dto: ModelSummaryDto): ModelSummaryView {
  return {
    id: dto.id,
    ...(dto.display_name === undefined
      ? {}
      : { displayName: dto.display_name }),
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
    case "thinking_delta":
      return {
        type: "thinking_delta",
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

// Local fallback error; display sites render it through
// commandErrorMessage(code), the message text serves wire/debug inspection.
function invalidInputError(): ConversationCommandError {
  return new ConversationCommandError({
    code: "invalid_input",
    message: t("errors.invalidInput"),
    retryable: false,
  })
}
