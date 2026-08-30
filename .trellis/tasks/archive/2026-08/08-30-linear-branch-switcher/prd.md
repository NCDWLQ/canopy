# 线性视图分支切换器（‹ 1/2 ›）

## Goal

在线性消息视图（ConversationPane）中，当一条消息存在兄弟分支（重新生成
的助手回复、编辑另存的用户消息）时，在消息气泡上常驻显示 ‹ 1/2 › 分页
切换器，使用户不离开线性视图即可发现并切换兄弟分支。目前分支结构只能
通过侧栏 OutlineTree 或 Panorama 画布感知与切换，线性视图内无法察觉
"这里还有别的分支"。

## Background / Confirmed Facts

- 兄弟信息前端已完备：`TreeNodeView.childIds` / `parentId`
  （`src/features/conversations/types/index.ts:29-35`），无需后端改动。
- store 已有 `selectBranchAtNode(nodeId)`：激活穿过该节点的分支，路径延
  伸到子树最新叶子（`newestLeafDescendant`），并设置无查询 reveal 使
  ConversationPane 滚动到该节点
  （`src/features/conversations/store/index.ts:1221-1234`）。
- `ConversationWorkspace` 已订阅 `selectBranchAtNode` 并向
  `ConversationPane` 传递回调（`ConversationWorkspace.tsx:189-191,1031`），
  切换器沿用同一 wiring 模式（`canBranch(nodeId)` 等回调先例）。
- 兄弟顺序即创建顺序：后端 `ORDER BY created_at ASC, id ASC`
  （`src-tauri/src/conversations/repository.rs:121`），`childIds` 稳定升序。
- 用户消息操作栏 hover 才显示（`MessageBubble.tsx:50-54` 的
  `opacity-0 group-hover:opacity-100`），助手消息操作栏常驻
  （`MessageBubble.tsx:72-76`）——切换器必须独立于 hover 门控。

## Requirements

- R1：active path 上任一消息，若其父节点的 `childIds` 长度 ≥ 2，则在该
  消息气泡上渲染分页切换器，显示 `‹ i/n ›`（i 为当前消息在兄弟中的
  1-based 序号，按 `childIds` 顺序）。
- R2：‹ / › 分别切换到前一个 / 后一个兄弟，调用
  `selectBranchAtNode(siblingId)`；切换后 active path 延伸到该兄弟子树的
  最新叶子，且视图滚动到被切换的消息（reveal 既有行为）。
- R3：切换器对 user 与 assistant 消息一视同仁，且常驻可见（不受用户消
  息操作栏的 hover 门控影响）。
- R4：首尾兄弟处对应按钮禁用（不循环）；消息处于编辑态（isEditing）时
  隐藏切换器。
- R5：根消息（无 parentId）与无兄弟消息不渲染切换器。
- R6：按钮带 i18n 的 aria-label / tooltip（en + zh-CN），可 Tab 聚焦、
  Enter/Space 触发。

## Acceptance Criteria

- [ ] AC1：`pnpm check`（format、lint、typecheck、test、build）通过。
- [ ] AC2：构造含兄弟分支的会话（重新生成或编辑另存），线性视图中对应
      消息显示 `‹ 1/2 ›`；点击 › 后消息列表切换为分支 2 的完整最新路
      径，且视图滚动定位到被切换的消息。
- [ ] AC3：无兄弟消息与根消息不显示切换器；首/尾兄弟处 ‹ / › 禁用。
- [ ] AC4：用户消息（hover 操作栏）上的切换器无需 hover 即可见。
- [ ] AC5：现有 MessageNode / ConversationPane / ConversationWorkspace 测
      试无回归。

## Out of Scope

- 后端改动（数据已齐备）。
- 键盘左右方向键全局切换（2026-08-30 用户确认不纳入 MVP；焦点作用域复
  杂，OutlineTree 仍是键盘导航表面）。
- 分支的增删改（重新生成 / 编辑另存已有入口）。
- 兄弟分支的预览 tooltip、缩略内容对比。

## Key Decisions

- **切换语义**：复用 `selectBranchAtNode(siblingId)`，延伸到子树最新叶
  子，与 Panorama 单击语义一致。（2026-08-30 用户确认）
- **出现范围**：所有 siblings ≥ 2 的消息，user / assistant 一视同仁。
  （2026-08-30 用户确认）
- **位置形态**：常驻独立分页器，位于消息内容下方、操作栏旁；不进 hover
  门控的操作栏。（2026-08-30 用户确认）
- **键盘切换**：不纳入 MVP。（2026-08-30 用户确认）
