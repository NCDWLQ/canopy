import {
  Archive,
  EllipsisVertical,
  Pencil,
  Trash2,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { formatRelativeUpdatedAt } from "@/lib/format-relative-time"
import type { UiError } from "@/lib/tauri/types"
import { commandErrorMessage, useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type ArchivedConversationItem = {
  id: string
  title: string
  updatedAt: number
  isCurrent: boolean
}

export type ArchivedConversationsPanelStatus =
  "loading" | "ready" | "empty" | "error"

export type ArchivedConversationsPanelProps = {
  status: ArchivedConversationsPanelStatus
  items: readonly ArchivedConversationItem[]
  error: UiError | null
  disabled: boolean
  onSelect: (id: string) => void
  onRename: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
  onRetry: () => void
}

export function ArchivedConversationsPanel({
  status,
  items,
  error,
  disabled,
  onSelect,
  onRename,
  onUnarchive,
  onDelete,
  onRetry,
}: ArchivedConversationsPanelProps) {
  const { t, locale } = useTranslation()
  const showList = items.length > 0
  const showLoading = !showList && status === "loading"
  const showEmpty = !showList && status === "empty"
  const showError = status === "error" && error !== null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 pr-12">
        <Breadcrumb aria-label={t("common.breadcrumb")}>
          <BreadcrumbList>
            <BreadcrumbItem>
              <span>{t("common.settings")}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t("settings.archived.title")}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {showLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner
              className="size-4"
              aria-label={t("settings.archived.loading")}
            />
            <span>{t("settings.archived.loading")}</span>
          </div>
        )}
        {showEmpty && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Archive aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("settings.archived.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("settings.archived.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {showList && (
          <ul
            aria-label={t("settings.archived.listLabel")}
            className="flex flex-col"
          >
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 border-b py-2 last:border-b-0"
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 justify-start px-0 py-0 hover:bg-transparent"
                  aria-label={t("settings.archived.openAria", {
                    title: item.title,
                  })}
                  aria-current={item.isCurrent ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left">
                    <span
                      className={cn(
                        "w-full truncate text-sm",
                        item.isCurrent && "font-medium",
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="w-full truncate text-xs font-normal text-muted-foreground">
                      {formatRelativeUpdatedAt(item.updatedAt, locale)}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  aria-label={t("settings.archived.unarchiveAria", {
                    title: item.title,
                  })}
                  disabled={disabled}
                  onClick={() => onUnarchive(item.id)}
                >
                  {t("settings.archived.unarchive")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={t("settings.archived.menuAria", {
                        title: item.title,
                      })}
                      disabled={disabled}
                    >
                      <EllipsisVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-40">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => onRename(item.id)}>
                        <Pencil />
                        {t("settings.archived.rename")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onDelete(item.id)}
                      >
                        <Trash2 />
                        {t("settings.archived.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        {showError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription className="flex flex-col gap-2">
              <p>{commandErrorMessage(error.code)}</p>
              {error.retryable && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {t("conversation.workspace.retryHistory")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
