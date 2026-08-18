import { describe, expect, it } from "vitest"

import { decodeConversationTitleUpdate } from "./title-events"

describe("conversation title event contract", () => {
  it("decodes the exact snake-case payload", () => {
    expect(
      decodeConversationTitleUpdate({
        conversation_id: "conversation-1",
        title: "生成的标题",
      }),
    ).toEqual({
      conversationId: "conversation-1",
      title: "生成的标题",
    })
  })

  it("rejects malformed or unknown payload fields", () => {
    expect(decodeConversationTitleUpdate({ title: "缺少 ID" })).toBeNull()
    expect(
      decodeConversationTitleUpdate({
        conversation_id: "conversation-1",
        title: "",
      }),
    ).toBeNull()
    expect(
      decodeConversationTitleUpdate({
        conversation_id: "conversation-1",
        title: "标题",
        extra: true,
      }),
    ).toBeNull()
  })
})
