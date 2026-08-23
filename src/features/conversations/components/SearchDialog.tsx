import * as React from "react"

import type { ConversationSearchResultView, SearchHitView } from "../types"
import { normalizeUiError } from "../store"
import { HighlightedText } from "./HighlightedText"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { UiError } from "@/lib/tauri/types"
import type { ConversationClient } from "@/lib/tauri"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const DEBOUNCE_MS = 300

type SearchStatus = "idle" | "searching" | "ready" | "error"

export type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: ConversationClient
  onReveal: (
    conversationId: string,
    nodeId: string | null,
    query: string,
  ) => void
}

function roleLabelKey(role: SearchHitView["role"]) {
  switch (role) {
    case "system":
      return "conversation.messageBubble.roleSystem" as const
    case "user":
      return "conversation.messageBubble.roleUser" as const
    case "assistant":
      return "conversation.messageBubble.roleAssistant" as const
    case "tool":
      return "conversation.messageBubble.roleTool" as const
  }
}

export function SearchDialog({
  open,
  onOpenChange,
  client,
  onReveal,
}: SearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState<SearchStatus>("idle")
  const [results, setResults] = React.useState<
    readonly ConversationSearchResultView[]
  >([])
  const [error, setError] = React.useState<UiError | null>(null)
  const searchEpochRef = React.useRef(0)

  React.useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      // Invalidate any in-flight response without touching state; the blank
      // input is rendered as idle via the derived status below.
      searchEpochRef.current += 1
      return
    }

    const epoch = ++searchEpochRef.current
    const timer = setTimeout(() => {
      setStatus((previous) =>
        epoch === searchEpochRef.current ? "searching" : previous,
      )
      void client
        .searchConversations(trimmed)
        .then((found) => {
          if (epoch !== searchEpochRef.current) return
          setResults(found)
          setStatus("ready")
        })
        .catch((failure: unknown) => {
          if (epoch !== searchEpochRef.current) return
          setError(normalizeUiError(failure))
          setStatus("error")
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, client])

  const trimmedQuery = query.trim()
  const visibleStatus: SearchStatus =
    trimmedQuery.length === 0 ? "idle" : status
  const reveal = (conversationId: string, nodeId: string | null) => {
    onReveal(conversationId, nodeId, trimmedQuery)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(32rem,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{t("search.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("search.description")}
          </DialogDescription>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="mt-1"
          />
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          role="region"
          aria-label={t("search.resultsRegion")}
        >
          {visibleStatus === "idle" && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("search.hint")}
            </p>
          )}
          {visibleStatus === "searching" && (
            <p className="flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              <Spinner className="size-4" aria-hidden="true" />
              {t("search.searching")}
            </p>
          )}
          {visibleStatus === "error" && error !== null && (
            <div
              className="px-2 py-6 text-center text-sm text-destructive"
              role="alert"
            >
              {commandErrorMessage(error.code)}
            </div>
          )}
          {visibleStatus === "ready" && results.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("search.noResults")}
            </p>
          )}
          {visibleStatus === "ready" &&
            results.map((result) => (
              <section
                key={result.conversationId}
                aria-label={result.title}
                className="mb-2"
              >
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => reveal(result.conversationId, null)}
                  >
                    {result.title}
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {result.isArchived && (
                      <Badge variant="secondary">
                        {t("conversation.workspace.archivedBadge")}
                      </Badge>
                    )}
                    {result.titleMatched && result.hits.length === 0 && (
                      <Badge variant="outline">
                        {t("search.titleMatched")}
                      </Badge>
                    )}
                  </span>
                </div>
                {result.hits.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {result.hits.map((hit) => (
                      <li key={hit.nodeId}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm",
                            "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                          onClick={() =>
                            reveal(result.conversationId, hit.nodeId)
                          }
                        >
                          <span className="text-xs text-muted-foreground">
                            {t(roleLabelKey(hit.role))}
                          </span>
                          <span className="line-clamp-2 text-sm text-foreground">
                            <HighlightedText
                              text={hit.snippet}
                              query={trimmedQuery}
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
        </div>
        <div className="flex shrink-0 items-center justify-end border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
