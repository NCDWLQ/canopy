import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { z } from "zod"

import {
  idSchema,
  trimRustWhitespace,
  unicodeScalarStringSchema,
} from "./schemas"

export const CONVERSATION_TITLE_UPDATED_EVENT =
  "conversation://title-updated" as const

const titleUpdatedPayloadSchema = z
  .object({
    conversation_id: idSchema,
    title: unicodeScalarStringSchema.refine(
      (value) =>
        trimRustWhitespace(value).length > 0 && [...value].length <= 200,
    ),
  })
  .strict()

export type ConversationTitleUpdate = {
  conversationId: string
  title: string
}

export function decodeConversationTitleUpdate(
  value: unknown,
): ConversationTitleUpdate | null {
  const parsed = titleUpdatedPayloadSchema.safeParse(value)
  if (!parsed.success) return null
  return {
    conversationId: parsed.data.conversation_id,
    title: parsed.data.title,
  }
}

export async function listenForConversationTitleUpdates(
  onUpdate: (update: ConversationTitleUpdate) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(CONVERSATION_TITLE_UPDATED_EVENT, (event) => {
    const update = decodeConversationTitleUpdate(event.payload)
    if (update !== null) onUpdate(update)
  })
}
