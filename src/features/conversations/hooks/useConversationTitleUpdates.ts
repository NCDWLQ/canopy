import * as React from "react"

import { useConversationStore } from "../store"
import { listenForConversationTitleUpdates } from "@/lib/tauri/title-events"

export function useConversationTitleUpdates() {
  const applyTitleUpdate = useConversationStore(
    (state) => state.applyTitleUpdate,
  )

  React.useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenForConversationTitleUpdates(applyTitleUpdate).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyTitleUpdate])
}
