import fixture from "../../../contract-fixtures/provider-ipc.json"

import type { GenerationEventView } from "@/features/providers/types"

import {
  PROVIDER_COMMANDS,
  createProviderClient,
  type ChannelFactory,
  type InvokeTransport,
} from "./index"

type RecordedCall = { command: string; args: Record<string, unknown> }

const generationId = fixture.successes.generation_start.generation_id
const commitToken = fixture.requests.commit_generation.commit_token

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
  it("uses the shared exact command list and redacted profile shapes", async () => {
    expect(Object.values(PROVIDER_COMMANDS)).toEqual(fixture.command_names)
    const transport = recordingTransport({
      save_provider_profile: fixture.successes.profile_without_key,
      load_provider_profile: fixture.successes.profile_with_key,
      delete_provider_profile: fixture.successes.delete,
      cancel_generation: fixture.successes.cancel,
      commit_generation: fixture.successes.commit_rejected,
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
    await expect(
      client.commitGeneration(generationId, commitToken),
    ).resolves.toEqual({ accepted: false })

    expect(transport.calls).toEqual([
      {
        command: "save_provider_profile",
        args: { request: fixture.requests.save_provider_profile },
      },
      {
        command: "load_provider_profile",
        args: { request: fixture.requests.load_provider_profile },
      },
      {
        command: "delete_provider_profile",
        args: { request: fixture.requests.delete_provider_profile },
      },
      {
        command: "cancel_generation",
        args: { request: fixture.requests.cancel_generation },
      },
      {
        command: "commit_generation",
        args: { request: fixture.requests.commit_generation },
      },
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

  it("constructs one channel, validates ordered events, and projects the committed node", async () => {
    expect(fixture.channel_argument).toBe("onEvent")
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          for (const event of fixture.events) factory.emit(event)
          return Promise.resolve(fixture.successes.generation_start)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    const events: GenerationEventView[] = []
    const client = createProviderClient(transport, factory)

    await expect(
      client.generateFromActivePath(
        "conversation-fixture",
        "user-right",
        (event) => events.push(event),
      ),
    ).resolves.toEqual({ generationId })

    expect(calls).toEqual([
      {
        command: "generate_from_active_path",
        args: {
          request: fixture.requests.generate_from_active_path,
          onEvent: factory.channel,
        },
      },
    ])
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "delta",
      "ready_to_commit",
      "completed",
    ])
    const completed = events.at(-1)
    expect(completed).toMatchObject({
      type: "completed",
      generationId,
      node: {
        id: "assistant-generated",
        parentId: "user-right",
        content: "Generated answer",
        model: "fixture-model",
      },
    })
    expect(events.at(-2)).toEqual({
      type: "ready_to_commit",
      generationId,
      commitToken,
    })
    expect(calls.some((call) => call.command === "commit_generation")).toBe(
      false,
    )
  })

  it("turns malformed or out-of-order events into one safe failure and exact cancellation", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          factory.emit(fixture.malformed_events[1])
          factory.emit(fixture.events[1])
          return Promise.resolve(fixture.successes.generation_start)
        }
        return Promise.resolve({ accepted: true })
      },
    }
    const events: GenerationEventView[] = []
    const client = createProviderClient(transport, factory)
    await client.generateFromActivePath(
      "conversation-fixture",
      "user-right",
      (event) => events.push(event),
    )
    await Promise.resolve()

    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe("started")
    expect(events[1]).toMatchObject({
      type: "failed",
      generationId,
      error: { code: "internal", retryable: false },
    })
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it("cancels the exact generation when invoke rejects after started", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
      invoke(command, args) {
        calls.push({ command, args })
        if (command === "generate_from_active_path") {
          factory.emit(fixture.events[0])
          return Promise.reject(new Error("ambiguous transport failure"))
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
    ).rejects.toMatchObject({ code: "internal", retryable: false })
    await Promise.resolve()

    expect(events.map((event) => event.type)).toEqual(["started", "failed"])
    expect(events.at(-1)).toMatchObject({
      generationId,
      error: { code: "internal", retryable: false },
    })
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it("rejects invalid local endpoint and generation identifiers without invoke", async () => {
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
    await expect(
      client.commitGeneration(generationId, "not-a-uuid"),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(transport.calls).toEqual([])
  })

  it("rejects completion before readiness and deltas after readiness", async () => {
    const illegalSequences = [
      [fixture.events[0], fixture.events[1], fixture.events[4]],
      [
        fixture.events[0],
        fixture.events[1],
        fixture.events[3],
        fixture.events[2],
      ],
    ]

    for (const sequence of illegalSequences) {
      const factory = new FakeChannelFactory()
      const calls: RecordedCall[] = []
      const transport: InvokeTransport = {
        invoke(command, args) {
          calls.push({ command, args })
          if (command === "generate_from_active_path") {
            for (const event of sequence) factory.emit(event)
            return Promise.resolve(fixture.successes.generation_start)
          }
          return Promise.resolve(fixture.successes.cancel)
        },
      }
      const events: GenerationEventView[] = []
      await createProviderClient(transport, factory).generateFromActivePath(
        "conversation-fixture",
        "user-right",
        (event) => events.push(event),
      )
      await Promise.resolve()

      expect(events.at(-1)).toMatchObject({
        type: "failed",
        generationId,
        error: { code: "internal" },
      })
      expect(calls.at(-1)).toEqual({
        command: "cancel_generation",
        args: { request: { generation_id: generationId } },
      })
    }
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

  it("fails closed when started identity or committed node parity drifts", async () => {
    const startedFactory = new FakeChannelFactory()
    const startedTransport = recordingTransport({
      generate_from_active_path: fixture.successes.generation_start,
      cancel_generation: fixture.successes.cancel,
    })
    const startedEvents: GenerationEventView[] = []
    const startedClient = createProviderClient(startedTransport, startedFactory)
    await startedClient.generateFromActivePath(
      "conversation-fixture",
      "user-right",
      (event) => startedEvents.push(event),
    )
    startedFactory.emit({
      ...fixture.events[0],
      generation_id: "33333333-3333-4333-8333-333333333333",
    })
    await Promise.resolve()
    expect(startedEvents).toHaveLength(1)
    expect(startedEvents[0]).toMatchObject({
      type: "failed",
      generationId,
      error: { code: "internal" },
    })
    expect(startedTransport.calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })

    const completedFactory = new FakeChannelFactory()
    const completedCalls: RecordedCall[] = []
    const completedTransport: InvokeTransport = {
      invoke(command, args) {
        completedCalls.push({ command, args })
        if (command === "generate_from_active_path") {
          completedFactory.emit(fixture.events[0])
          completedFactory.emit(fixture.events[1])
          completedFactory.emit(fixture.events[2])
          completedFactory.emit(fixture.events[3])
          completedFactory.emit({
            ...fixture.events[4],
            node: { ...fixture.successes.assistant_node, parent_id: "wrong" },
          })
          return Promise.resolve(fixture.successes.generation_start)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    const completedEvents: GenerationEventView[] = []
    await createProviderClient(
      completedTransport,
      completedFactory,
    ).generateFromActivePath("conversation-fixture", "user-right", (event) =>
      completedEvents.push(event),
    )
    await Promise.resolve()
    expect(completedEvents.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "delta",
      "ready_to_commit",
      "failed",
    ])
    expect(completedCalls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })

  it("bounds cumulative channel deltas and requests exact cancellation", async () => {
    const factory = new FakeChannelFactory()
    const calls: RecordedCall[] = []
    const transport: InvokeTransport = {
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
            type: "delta",
            generation_id: generationId,
            content: "y",
          })
          return Promise.resolve(fixture.successes.generation_start)
        }
        return Promise.resolve(fixture.successes.cancel)
      },
    }
    const events: GenerationEventView[] = []
    await createProviderClient(transport, factory).generateFromActivePath(
      "conversation-fixture",
      "user-right",
      (event) => events.push(event),
    )
    await Promise.resolve()
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "delta",
      "failed",
    ])
    expect(calls.at(-1)).toEqual({
      command: "cancel_generation",
      args: { request: { generation_id: generationId } },
    })
  })
})
