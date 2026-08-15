import fixture from "../../../contract-fixtures/provider-ipc.json"

import type { GenerationEventView } from "@/features/providers/types"

import {
  GenerationBridgeError,
  PROVIDER_COMMANDS,
  createProviderClient,
  type ChannelFactory,
  type InvokeTransport,
} from "./index"

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
  it("uses the reduced command list and redacted profile shapes", async () => {
    expect(Object.values(PROVIDER_COMMANDS)).toEqual(fixture.command_names)
    const transport = recordingTransport({
      save_provider_profile: fixture.successes.profile_without_key,
      load_provider_profile: fixture.successes.profile_with_key,
      delete_provider_profile: fixture.successes.delete,
      cancel_generation: fixture.successes.cancel,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())

    await expect(
      client.saveProviderProfile({
        baseEndpoint: fixture.requests.save_provider_profile.base_endpoint,
        model: fixture.requests.save_provider_profile.model,
        apiKey: { action: "keep" },
      }),
    ).resolves.toEqual({
      baseEndpoint: "https://provider.example/v1",
      model: "fixture-model",
      hasApiKey: false,
      updatedAt: 1770000001123,
    })
    await client.loadProviderProfile()
    await expect(client.deleteProviderProfile()).resolves.toBe(true)
    await expect(client.cancelGeneration(generationId)).resolves.toEqual({
      accepted: true,
    })
    expect(transport.calls.map((call) => call.command)).toEqual([
      "save_provider_profile",
      "load_provider_profile",
      "delete_provider_profile",
      "cancel_generation",
    ])
  })

  it("sends a replacement key only in the one-way request and rejects an echo", async () => {
    const transport = recordingTransport({
      save_provider_profile: fixture.successes.profile_with_key,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())
    await client.saveProviderProfile({
      baseEndpoint: "https://provider.example/v1",
      model: "fixture-model",
      apiKey: { action: "replace", value: "TRANSIENT_TEST_VALUE" },
    })
    expect(transport.calls[0]?.args).toEqual({
      request: {
        base_endpoint: "https://provider.example/v1",
        model: "fixture-model",
        api_key: { action: "replace", value: "TRANSIENT_TEST_VALUE" },
      },
    })

    const echoing = createProviderClient(
      recordingTransport({
        save_provider_profile: {
          ...fixture.successes.profile_with_key,
          api_key: "TRANSIENT_TEST_VALUE",
        },
      }),
      new FakeChannelFactory(),
    )
    await expect(
      echoing.saveProviderProfile({
        baseEndpoint: "https://provider.example/v1",
        model: "fixture-model",
        apiKey: { action: "keep" },
      }),
    ).rejects.toMatchObject({ code: "internal", retryable: false })
  })

  it("streams started and deltas, then returns one authoritative terminal result", async () => {
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
    const result = await createProviderClient(
      transport,
      factory,
    ).generateFromActivePath("conversation-fixture", "user-right", (event) =>
      events.push(event),
    )

    expect(result).toMatchObject({ type: "completed", generationId })
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "delta",
    ])
    expect(result).toMatchObject({
      node: {
        id: "assistant-generated",
        parentId: "user-right",
        content: "Generated answer",
        model: "fixture-model",
      },
    })
    expect(calls.some((call) => call.command === "cancel_generation")).toBe(
      false,
    )
  })

  it("accepts a result before delayed channel callbacks and ignores later values", async () => {
    const factory = new FakeChannelFactory()
    const client = createProviderClient(
      recordingTransport({
        generate_from_active_path: fixture.successes.generation_completed,
      }),
      factory,
    )
    const events: GenerationEventView[] = []
    await expect(
      client.generateFromActivePath(
        "conversation-fixture",
        "user-right",
        (event) => events.push(event),
      ),
    ).resolves.toMatchObject({ type: "completed", generationId })

    factory.emit(fixture.events[0])
    factory.emit(fixture.events[1])
    expect(events).toEqual([])
  })

  it("fails closed on malformed channel data and cancels only the known generation", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit(fixture.malformed_events[0])
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
    ).rejects.toMatchObject({
      code: "internal",
      retryable: false,
      generationId,
    })
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
    await expect(
      createProviderClient(
        recordingTransport({
          generate_from_active_path: {
            ...fixture.successes.generation_completed,
            node: {
              ...fixture.successes.generation_completed.node,
              parent_id: "other-parent",
            },
          },
        }),
        new FakeChannelFactory(),
      ).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(GenerationBridgeError)
  })

  it("preserves a channel protocol failure when invoke later rejects", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit(fixture.malformed_events[0])
          return Promise.reject(new Error("wrong failure"))
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
    ).rejects.toMatchObject({ code: "internal", retryable: false })
    await Promise.resolve()
    expect(
      calls.filter((call) => call.command === "cancel_generation"),
    ).toEqual([
      {
        command: "cancel_generation",
        args: { request: { generation_id: generationId } },
      },
    ])
  })

  it("fails closed on a mismatched started event", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit(fixture.mismatched_events[0])
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
    ).rejects.toMatchObject({ code: "internal", retryable: false })
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it("maps terminal failure stage and cancels an ambiguous invoke rejection", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          return Promise.reject(new Error("ambiguous delivery"))
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
    ).rejects.toMatchObject({ code: "internal" })
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })

    const failedClient = createProviderClient(
      recordingTransport({
        generate_from_active_path: fixture.terminal_results.persistence_failed,
      }),
      new FakeChannelFactory(),
    )
    await expect(
      failedClient.generateFromActivePath(
        "conversation-fixture",
        "user-right",
        () => undefined,
      ),
    ).resolves.toMatchObject({
      type: "failed",
      stage: "persistence",
      error: { code: "database_unavailable" },
    })
  })

  it("cancels the exact result generation when terminal identity is malformed", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          return Promise.resolve({
            ...fixture.successes.generation_completed,
            node: {
              ...fixture.successes.generation_completed.node,
              conversation_id: "other-conversation",
            },
          })
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
    ).rejects.toMatchObject({ code: "internal", retryable: false })
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it.each([
    ["missing model", { model: null }],
    ["wrong role", { role: "user" }],
    ["missing parent", { parent_id: null }],
    ["blank content", { content: " \n" }],
    ["invalid content Unicode", { content: "\ud800" }],
    ["invalid model Unicode", { model: "\ud800" }],
  ])("rejects completed assistant drift: %s", async (_name, nodeDrift) => {
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          return Promise.resolve({
            ...fixture.successes.generation_completed,
            node: {
              ...fixture.successes.generation_completed.node,
              ...nodeDrift,
            },
          })
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }

    await expect(
      createProviderClient(
        transport,
        new FakeChannelFactory(),
      ).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "internal", retryable: false })
    await Promise.resolve()
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it("rejects invalid local inputs, node drift, and cumulative overflow", async () => {
    const transport = recordingTransport({})
    const client = createProviderClient(transport, new FakeChannelFactory())
    for (const baseEndpoint of [
      "http://provider.example/v1",
      "http://localhost.example/v1",
      "http://127.1/v1",
      "http://2130706433/v1",
    ]) {
      await expect(
        client.saveProviderProfile({
          baseEndpoint,
          model: "model",
          apiKey: { action: "keep" },
        }),
      ).rejects.toMatchObject({ code: "invalid_input" })
    }
    await expect(
      client.generateFromActivePath(" ", "active", () => undefined),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(client.cancelGeneration("not-a-uuid")).rejects.toMatchObject({
      code: "invalid_input",
    })
    expect(transport.calls).toEqual([])

    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const driftTransport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit({
            type: "delta",
            generation_id: generationId,
            content: "x".repeat(1024 * 1024),
          })
          factory.emit({
            ...fixture.events[1],
            content: "y",
          })
          return Promise.resolve(fixture.successes.generation_completed)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    await expect(
      createProviderClient(driftTransport, factory).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "internal" })
    await Promise.resolve()
    expect(calls.at(-1)?.command).toBe("cancel_generation")
  })

  it("matches Rust whitespace rules for model and replacement secrets", async () => {
    const transport = recordingTransport({
      save_provider_profile: fixture.successes.profile_with_key,
    })
    const client = createProviderClient(transport, new FakeChannelFactory())

    await expect(
      client.saveProviderProfile({
        baseEndpoint: "https://provider.example/v1",
        model: "\u0085",
        apiKey: { action: "keep" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.saveProviderProfile({
        baseEndpoint: "https://provider.example/v1",
        model: "model",
        apiKey: { action: "replace", value: "\u0085" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })

    await client.saveProviderProfile({
      baseEndpoint: "https://provider.example/v1",
      model: "\u0085 model \u0085",
      apiKey: { action: "replace", value: "\ufeff" },
    })
    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]?.args).toEqual({
      request: {
        base_endpoint: "https://provider.example/v1",
        model: "model",
        api_key: { action: "replace", value: "\ufeff" },
      },
    })
  })
})
