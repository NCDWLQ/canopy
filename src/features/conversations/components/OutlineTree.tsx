import * as React from "react"
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react"

import type { TreeNodeView } from "../types"
import { useTranslation } from "@/lib/i18n"

export type OutlineTreeProps = {
  rootNodeId: string
  activeNodeId: string
  nodesById: Readonly<Record<string, TreeNodeView>>
  expandedIds: ReadonlySet<string>
  onToggle: (nodeId: string) => void
  onSelect: (nodeId: string) => void
}

type VisibleTreeRow = {
  node: TreeNodeView
  level: number
  position: number
  siblingCount: number
}

function projectVisibleRows(
  rootNodeId: string,
  nodesById: Readonly<Record<string, TreeNodeView>>,
  expandedIds: ReadonlySet<string>,
): readonly VisibleTreeRow[] | null {
  const root = nodesById[rootNodeId]
  if (root === undefined || root.parentId !== undefined) return null

  const rows: VisibleTreeRow[] = []
  const visited = new Set<string>()
  const pending: Array<{
    id: string
    parentId: string | undefined
    level: number
    visible: boolean
    position: number
    siblingCount: number
  }> = [
    {
      id: rootNodeId,
      parentId: undefined,
      level: 1,
      visible: true,
      position: 1,
      siblingCount: 1,
    },
  ]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current.id)) return null

    const node = nodesById[current.id]
    if (
      node === undefined ||
      node.id !== current.id ||
      node.parentId !== current.parentId
    ) {
      return null
    }
    visited.add(current.id)
    if (current.visible) {
      rows.push({
        node,
        level: current.level,
        position: current.position,
        siblingCount: current.siblingCount,
      })
    }

    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = node.childIds[index]
      if (childId === undefined) return null
      pending.push({
        id: childId,
        parentId: node.id,
        level: current.level + 1,
        visible: current.visible && expandedIds.has(node.id),
        position: index + 1,
        siblingCount: node.childIds.length,
      })
    }
  }

  return visited.size === Object.keys(nodesById).length ? rows : null
}

export function OutlineTree({
  rootNodeId,
  activeNodeId,
  nodesById,
  expandedIds,
  onToggle,
  onSelect,
}: OutlineTreeProps) {
  const { t } = useTranslation()
  const rows = projectVisibleRows(rootNodeId, nodesById, expandedIds)
  const [focusedNodeId, setFocusedNodeId] = React.useState(activeNodeId)
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>())

  if (rows === null) {
    return (
      <div className="px-2.5 py-3 text-sm text-destructive" role="alert">
        {t("errors.unsafeTreeProjection")}
      </div>
    )
  }

  const effectiveFocusedNodeId = rows.some(
    ({ node }) => node.id === focusedNodeId,
  )
    ? focusedNodeId
    : rows.some(({ node }) => node.id === activeNodeId)
      ? activeNodeId
      : rows[0]?.node.id

  const focusNode = (nodeId: string) => {
    setFocusedNodeId(nodeId)
    itemRefs.current.get(nodeId)?.focus()
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    rowIndex: number,
  ) => {
    const row = rows[rowIndex]
    if (row === undefined) return

    const { node } = row
    const hasChildren = node.childIds.length > 0
    const isExpanded = expandedIds.has(node.id)
    let focusTarget: string | undefined

    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault()
        onSelect(node.id)
        return
      case "ArrowDown":
        focusTarget = rows[rowIndex + 1]?.node.id
        break
      case "ArrowUp":
        focusTarget = rows[rowIndex - 1]?.node.id
        break
      case "Home":
        focusTarget = rows[0]?.node.id
        break
      case "End":
        focusTarget = rows.at(-1)?.node.id
        break
      case "ArrowRight":
        if (hasChildren && !isExpanded) {
          event.preventDefault()
          onToggle(node.id)
          return
        }
        if (hasChildren && isExpanded) focusTarget = node.childIds[0]
        break
      case "ArrowLeft":
        if (hasChildren && isExpanded) {
          event.preventDefault()
          onToggle(node.id)
          return
        }
        focusTarget = node.parentId
        break
      default:
        return
    }

    if (focusTarget !== undefined) {
      event.preventDefault()
      focusNode(focusTarget)
    }
  }

  return (
    <div
      className="flex w-full flex-col gap-1 py-1"
      role="tree"
      aria-label={t("conversation.outline.tree")}
    >
      {rows.map((row, rowIndex) => {
        const { node } = row
        const hasChildren = node.childIds.length > 0
        const isExpanded = expandedIds.has(node.id)
        const isActive = activeNodeId === node.id
        const isFocused = effectiveFocusedNodeId === node.id

        return (
          <div
            key={node.id}
            ref={(element) => {
              if (element === null) itemRefs.current.delete(node.id)
              else itemRefs.current.set(node.id, element)
            }}
            role="treeitem"
            aria-level={row.level}
            aria-posinset={row.position}
            aria-setsize={row.siblingCount}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isActive}
            tabIndex={isFocused ? 0 : -1}
            className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-lg pr-2.5 text-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? "bg-sidebar-accent font-medium"
                : "hover:bg-sidebar-accent"
            }`}
            style={{ paddingLeft: `${(row.level - 1) * 16 + 10}px` }}
            onClick={() => onSelect(node.id)}
            onFocus={() => setFocusedNodeId(node.id)}
            onKeyDown={(event) => handleKeyDown(event, rowIndex)}
          >
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-muted/50 [&_svg]:size-4"
              onClick={(event) => {
                event.stopPropagation()
                if (hasChildren) onToggle(node.id)
              }}
              disabled={!hasChildren}
              tabIndex={-1}
              aria-label={
                hasChildren
                  ? t("conversation.outline.togglePreview", {
                      expanded: isExpanded,
                      label:
                        node.preview ||
                        t("conversation.outline.messageFallback"),
                    })
                  : t("conversation.outline.noReplies")
              }
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )
              ) : (
                <MessageSquare aria-hidden="true" />
              )}
            </button>
            <span className="flex-1 truncate" title={node.preview}>
              {node.preview || (
                <span className="italic text-muted-foreground">
                  {t("conversation.outline.emptyContent")}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
