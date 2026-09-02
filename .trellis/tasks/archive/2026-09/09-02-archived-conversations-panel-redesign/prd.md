# Redesign archived conversations panel layout

## Goal

将设置 → **已归档对话** 面板的列表布局，对齐 [canopy-settings-prototype.canvas.tsx](/home/jwh/.cursor/projects/home-jwh-Code-canopy/canvases/canopy-settings-prototype.canvas.tsx) 中的 **ArchivedPanel** 原型：开放行、底部分割线、右侧露出「取消归档」操作，提升扫读效率。

## Background

- 当前实现（`ArchivedConversationsPanel.tsx`）使用带圆角边框的列表容器；每行通过整行 ghost 按钮打开对话，**取消归档 / 重命名 / 删除** 均藏在 `⋯` 菜单里。
- 近期已具备：相对更新时间（`formatRelativeUpdatedAt`）、当前打开归档对话的 `font-medium` 高亮。
- 本任务为 **PRD-only 轻量任务**，无需 `design.md` / `implement.md`。

## Decisions

| 问题 | 决定 |
|------|------|
| 重命名 / 删除放哪 | 保留在 `⋯` 溢出菜单；仅「取消归档」提升为行内可见按钮 |
| 当前打开行样式 | 去掉 `bg-muted` 行背景，仅保留标题 `font-medium` |

## Requirements

### 布局（对齐原型）

- 去掉列表外层的 `rounded-lg border p-1` 容器，改为**开放行列表**。
- 每行：`py-2` + `border-b` 底部分割线（最后一行可无底线），行内 `flex items-center gap-*`。
- 左侧：标题（`text-sm`，可截断）+ 相对更新时间（`text-xs text-muted-foreground`），纵向堆叠。
- 右侧：独立的 **取消归档** ghost 按钮（文案沿用 i18n `settings.archived.unarchive`）。

### 保留的现有行为

- 点击标题区域 → 只读打开归档对话（`onSelect`）。
- 当前打开的归档对话：标题 `font-medium`（无行背景高亮）。
- 空状态、加载中、可重试错误态逻辑不变。
- Breadcrumb 与面板整体结构不变。
- **重命名**、**删除** 留在 `⋯` 菜单；**取消归档** 从菜单移出。

### 无障碍

- 标题打开按钮继续用 `settings.archived.openAria`。
- 取消归档按钮使用 `settings.archived.unarchiveAria`（含对话标题）。
- `⋯` 菜单保留 `settings.archived.menuAria`。

### 非目标

- 不改归档数据模型、Tauri 命令或 `ConversationWorkspace` 的归档流程。
- 不改设置对话框导航结构或其他设置面板。
- 不新增批量操作、搜索、排序。

## Acceptance Criteria

- [ ] 有数据时，列表无外框容器，每行为底部分割的开放行布局。
- [ ] 每行左侧显示标题 + 相对更新时间；右侧有可见的「取消归档」按钮，点击触发 `onUnarchive(id)`。
- [ ] 点击标题区域仍可打开归档对话（`onSelect`）。
- [ ] 当前打开的归档对话标题为 `font-medium`，无 `bg-muted` 行背景。
- [ ] 重命名、删除仅在 `⋯` 菜单中；菜单中不再包含取消归档。
- [ ] 空 / 加载 / 错误态与改前行为一致。
- [ ] `ArchivedConversationsPanel` 单测与相关设置对话框测试通过。
- [ ] 中英文文案通过 i18n 键维护，无硬编码。

## Notes

- 参考原型：`ArchivedPanel`（Canvas 设置页原型）。
- 实现文件：`src/features/settings/components/ArchivedConversationsPanel.tsx` 及对应测试、i18n。
