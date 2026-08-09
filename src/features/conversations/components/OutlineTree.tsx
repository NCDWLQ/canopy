import * as React from "react"
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react"

import type { TreeNodeView } from "../types"

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
  const rows = projectVisibleRows(rootNodeId, nodesById, expandedIds)
  const [focusedNodeId, setFocusedNodeId] = React.useState(activeNodeId)
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>())

  if (rows === null) {
    return (
      <div className="p-4 text-sm text-destructive" role="alert">
        The conversation tree could not be displayed safely.
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
      className="h-full w-full overflow-y-auto p-1"
      role="tree"
      aria-label="Conversation outline"
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
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? "bg-accent font-medium text-accent-foreground"
                : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${(row.level - 1) * 16 + 8}px` }}
            onClick={() => onSelect(node.id)}
            onFocus={() => setFocusedNodeId(node.id)}
            onKeyDown={(event) => handleKeyDown(event, rowIndex)}
          >
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-background disabled:opacity-50"
              onClick={(event) => {
                event.stopPropagation()
                if (hasChildren) onToggle(node.id)
              }}
              disabled={!hasChildren}
              tabIndex={-1}
              aria-label={
                hasChildren
                  ? `${isExpanded ? "Collapse" : "Expand"} ${node.preview || "message"}`
                  : "Message has no replies"
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
                <span className="italic text-muted-foreground">Empty</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
