import { ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Spinner } from "@/components/ui/spinner"

export type ThinkingBlockProps = {
  thinking: string
  streaming: boolean
}

export function ThinkingBlock({ thinking, streaming }: ThinkingBlockProps) {
  if (thinking.length === 0) return null

  if (streaming) {
    return (
      <div className="mb-3 rounded-lg border bg-muted/30 p-3">
        <Marker role="status" aria-live="polite">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent className="shimmer">思考中…</MarkerContent>
        </Marker>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {thinking}
        </p>
      </div>
    )
  }

  return (
    <Collapsible className="mb-3 rounded-lg border bg-muted/30 px-3">
      <CollapsibleTrigger className="flex w-full items-center py-2 text-left">
        <Marker>
          <MarkerContent>思考过程</MarkerContent>
          <ChevronDown
            className="ml-auto size-3.5 transition-transform [[data-state=open]_&]:rotate-180"
            aria-hidden="true"
          />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="border-t py-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {thinking}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
