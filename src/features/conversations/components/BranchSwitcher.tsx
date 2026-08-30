import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslation } from "@/lib/i18n"

export type BranchSwitcherProps = {
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  prevDisabled: boolean
  nextDisabled: boolean
}

export function BranchSwitcher({
  index,
  count,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: BranchSwitcherProps) {
  const { t } = useTranslation()
  const positionLabel = t("conversation.message.branchPosition", {
    index: index + 1,
    count,
  })

  return (
    <div
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
      role="group"
      aria-label={positionLabel}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            disabled={prevDisabled}
            aria-label={t("conversation.message.branchPrev")}
            onClick={onPrev}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("conversation.message.branchPrev")}</TooltipContent>
      </Tooltip>
      <span className="tabular-nums" aria-hidden="true">
        {index + 1}/{count}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            disabled={nextDisabled}
            aria-label={t("conversation.message.branchNext")}
            onClick={onNext}
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("conversation.message.branchNext")}</TooltipContent>
      </Tooltip>
    </div>
  )
}
