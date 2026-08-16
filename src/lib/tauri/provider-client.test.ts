import fixture from "../../../contract-fixtures/provider-ipc.json"

import type { GenerationEventView } from "@/features/providers/types"

import {
  GenerationBridgeError,
  PROVIDER_COMMANDS,
  createProviderClient,
  type ChannelFactory,
} from "./index"
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
