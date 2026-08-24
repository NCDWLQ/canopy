import fixture from "../../../contract-fixtures/provider-ipc.json"

import type { GenerationEventView } from "@/features/providers/types"

import {
  GenerationBridgeError,
  PROVIDER_COMMANDS,
  createProviderClient,
  type ChannelFactory,
} from "./index"
import {
  listProvidersResultSchema,
  setLanguageRequestSchema,
  setThemeRequestSchema,
} from "./provider-schemas"
import type { InvokeTransport } from "./client"

type RecordedCall = { command: string; args: Record<string, unknown> }

const generationId = fixture.successes.generation_completed.generation_id

class FakeChannelFactory implements ChannelFactory {
  onMessage?: (value: unknown) => void
  readonly channel = { fixtureChannel: true }

  create(onMessage: (value: unknown) => void) {
    this.onMessage = onMessage
    return this.channel
  }

  emit(value: unknown) {
    this.onMessage?.(value)
  }
}

function recordingTransport(
  responses: Readonly<Record<string, unknown>>,
): InvokeTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    invoke(command, args) {
      calls.push({ command, args })
      return Promise.resolve(responses[command])
    },
  }
}

describe("provider Tauri contract", () => {
  it("uses the multi-provider command list and only returns redacted providers", async () => {
    expect(Object.values(PROVIDER_COMMANDS)).toEqual(fixture.command_names)
    const transport = recordingTransport({
      list_providers: fixture.successes.providers,
      save_provider: fixture.successes.provider,
      delete_provider: fixture.successes.delete,
      set_active_provider: fixture.successes.active,
      set_auto_generate_title: { enabled: false },
      set_title_model_binding: {
        binding: {
          provider_id: "provider-fixture",
          model: "fixture-model",
        },
      },
      set_language: fixture.successes.set_language,
      set_theme: fixture.successes.set_theme,
      reveal_provider_api_key: fixture.successes.reveal_api_key,
      list_provider_models: { models: [{ id: "fixture-model" }] },
      cancel_generation: fixture.successes.cancel,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())

    await expect(client.listProviders()).resolves.toEqual({
      providers: [
        expect.objectContaining({
          id: "provider-fixture",
          name: "Fixture provider",
          protocol: "openai_compatible",
          hasApiKey: true,
        }),
      ],
      activeProviderId: "provider-fixture",
      autoGenerateTitle: true,
      titleModelBinding: null,
      language: "system",
      theme: "system",
    })
    await expect(
      client.saveProvider({
        name: "Fixture provider",
        protocol: "openai_compatible",
        baseEndpoint: "https://provider.example/v1",
        model: "fixture-model",
        models: ["fixture-model"],
        apiKey: { action: "replace", value: "TRANSIENT_TEST_VALUE" },
      }),
    ).resolves.toMatchObject({ id: "provider-fixture" })
    await expect(client.deleteProvider("provider-fixture")).resolves.toBe(true)
    await expect(client.setActiveProvider("provider-fixture")).resolves.toBe(
      "provider-fixture",
    )
    await expect(client.setAutoGenerateTitle(false)).resolves.toBe(false)
    await expect(
      client.setTitleModelBinding({
        providerId: "provider-fixture",
        model: "fixture-model",
      }),
    ).resolves.toEqual({
      providerId: "provider-fixture",
      model: "fixture-model",
    })
    await expect(client.setLanguage("zh-CN")).resolves.toBe("zh-CN")
    await expect(client.setTheme("dark")).resolves.toBe("dark")
    await expect(client.revealProviderApiKey("provider-fixture")).resolves.toBe(
      "fixture-revealed-key-sentinel",
    )
    await expect(
      client.listProviderModels({
        type: "saved",
        providerId: "provider-fixture",
      }),
    ).resolves.toEqual([{ id: "fixture-model" }])
    expect(transport.calls[1]?.args).toEqual({
      request: {
        name: "Fixture provider",
        protocol: "openai_compatible",
        base_endpoint: "https://provider.example/v1",
        model: "fixture-model",
        models: ["fixture-model"],
        api_key: { action: "replace", value: "TRANSIENT_TEST_VALUE" },
      },
    })
    expect(transport.calls[6]?.args).toEqual({
      request: { language: "zh-CN" },
    })
    expect(transport.calls[7]?.args).toEqual({
      request: { theme: "dark" },
    })
  })

  it("sends set_language as a single-field request and validates the closed language set", async () => {
    const transport = recordingTransport({
      set_language: fixture.successes.set_language,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())

    await expect(client.setLanguage("zh-CN")).resolves.toBe("zh-CN")
    expect(transport.calls[0]?.args).toEqual({ request: { language: "zh-CN" } })
    // The request schema rejects unknown locales, extra fields, and a
    // missing language before any invoke crosses the bridge.
    expect(setLanguageRequestSchema.safeParse({ language: "fr" }).success).toBe(
      false,
    )
    expect(setLanguageRequestSchema.safeParse({ language: "EN" }).success).toBe(
      false,
    )
    expect(
      setLanguageRequestSchema.safeParse({ language: "en", extra: true })
        .success,
    ).toBe(false)
    expect(setLanguageRequestSchema.safeParse({}).success).toBe(false)
  })

  it("sends set_theme as a single-field request and validates the closed theme set", async () => {
    const transport = recordingTransport({
      set_theme: fixture.successes.set_theme,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())

    await expect(client.setTheme("dark")).resolves.toBe("dark")
    expect(transport.calls[0]?.args).toEqual({ request: { theme: "dark" } })
    expect(
      setThemeRequestSchema.safeParse({ theme: "solarized" }).success,
    ).toBe(false)
    expect(setThemeRequestSchema.safeParse({ theme: "DARK" }).success).toBe(
      false,
    )
    expect(
      setThemeRequestSchema.safeParse({ theme: "light", extra: true }).success,
    ).toBe(false)
    expect(setThemeRequestSchema.safeParse({}).success).toBe(false)
  })

  it("decodes the provider list language and theme, and rejects responses without valid ones", () => {
    expect(
      listProvidersResultSchema.safeParse(fixture.successes.providers).success,
    ).toBe(true)
    expect(
      listProvidersResultSchema.safeParse({
        ...fixture.successes.providers,
        language: "fr",
      }).success,
    ).toBe(false)
    expect(
      listProvidersResultSchema.safeParse({
        ...fixture.successes.providers,
        language: undefined,
      }).success,
    ).toBe(false)
    expect(
      listProvidersResultSchema.safeParse({
        ...fixture.successes.providers,
        theme: "solarized",
      }).success,
    ).toBe(false)
    expect(
      listProvidersResultSchema.safeParse({
        ...fixture.successes.providers,
        theme: undefined,
      }).success,
    ).toBe(false)
  })

  it("streams thinking and content with independent one-MiB budgets", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          for (const event of fixture.events) factory.emit(event)
          return Promise.resolve(fixture.successes.generation_completed)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    const events: GenerationEventView[] = []
    await expect(
      createProviderClient(transport, factory).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        (event) => events.push(event),
      ),
    ).resolves.toMatchObject({ type: "completed", generationId })
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "thinking_delta",
      "delta",
    ])
    expect(calls.some((call) => call.command === "cancel_generation")).toBe(
      false,
    )
  })

  it("fails closed and cancels the exact started generation on malformed thinking", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit(fixture.malformed_events[1])
          return Promise.resolve(fixture.successes.generation_completed)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    await expect(
      createProviderClient(transport, factory).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(GenerationBridgeError)
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })
})
