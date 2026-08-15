# Technical Design: Optimize New Conversation Button Layout & Sidebar Hierarchy

## Architecture & Layout Design

### 1. Main Header Component Changes (`ConversationWorkspace.tsx`)
In the main `<header>` (left section):
```tsx
<div className="flex items-center gap-2">
  <Button
    variant="ghost"
    size="icon"
    className="size-8"
    onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
    title={isSidebarOpen ? "收起侧栏" : "展开侧栏"}
    aria-label={isSidebarOpen ? "收起侧栏" : "展开侧栏"}
    aria-expanded={isSidebarOpen}
    aria-controls="conversation-tree-sidebar"
  >
    {isSidebarOpen ? (
      <PanelLeftClose aria-hidden="true" />
    ) : (
      <PanelLeftOpen aria-hidden="true" />
    )}
  </Button>
  {!isSidebarOpen && (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="新建会话"
            disabled={
              store.status === "loading" || isGenerationActive(store.generation)
            }
            onClick={store.enterConversationCreation}
          >
            <SquarePen className="size-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>新建会话</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )}
  {!isBlankConversation && store.isArchived && (
    <Badge variant="secondary">
      <Archive data-icon="inline-start" />
      已归档 — 只读
    </Badge>
  )}
</div>
```

### 2. Sidebar Header Toolbarization & Section Headers (`ConversationWorkspace.tsx`)
In `<aside>`:
```tsx
{/* 侧栏顶部全局工具栏 */}
<div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3 text-sm font-semibold">
  <span className="font-bold tracking-tight">Canopy</span>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="新建会话"
          title="新建会话"
          disabled={
            store.status === "loading" || isGenerationActive(store.generation)
          }
          onClick={store.enterConversationCreation}
        >
          <SquarePen className="size-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>新建会话</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</div>

{/* 历史记录独立区块标题 */}
<div className="flex h-8 shrink-0 items-center px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
  历史记录
</div>
<div className="max-h-64 shrink-0 overflow-y-auto px-2 pb-2">
  ...
</div>

<Separator />

{/* 会话树独立区块标题 */}
<div className="flex h-8 shrink-0 items-center px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
  会话树
</div>
<div className="flex-1 overflow-hidden pb-2">
  ...
</div>
```

## Contracts & State Flow
- No backend/store changes required. Both entry points invoke `store.enterConversationCreation()`.
- Consistent disabling state: `store.status === "loading" || isGenerationActive(store.generation)`.
