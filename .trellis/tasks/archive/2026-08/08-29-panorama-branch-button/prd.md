# 全景图节点增加从此处创建分支按钮

## Goal

在全景视图（ConversationPanorama）的节点卡片上提供与普通对话视图（MessageNode）一致的"从此处创建分支"入口，使分支操作不依赖切回对话视图才能发起。

## Background

- 对话视图中，`canBranch` 的助手消息（role=assistant 且有子节点）工具栏上有 GitBranch 图标按钮，点击后进入分支编辑模式：`handleStartBranch` 设置 `branchComposerTarget`、聚焦 Composer，路径在分支起点截断并显示"由此处创建分支"分隔标记，提交后调用 `controller.createBranch(parentNodeId, content)`。
- 全景视图打开时整个替换对话窗格，Composer 不在渲染树中，因此分支目标设置后需要关闭全景视图回到对话视图完成输入。

## Requirements

1. 全景图节点卡片对"可分支"节点（与对话视图同规则：`role === "assistant"` 且 `childCount > 0`，且当前允许变更 canMutate）渲染"从此处创建分支"按钮，复用现有 i18n key `conversation.message.branchFromHere`（GitBranch 图标 + Tooltip）。按钮以悬浮操作条形式置于卡片下方——与消息气泡操作栏一致（悬停或键盘聚焦时以透明度过渡显现），绝对定位、不改变卡片固定尺寸（2026-08-29 用户调整：由卡片头部行内改为卡片下方悬浮；同日曾改为右键菜单，实机对比后按用户要求回退悬浮操作条）。
2. 点击卡片上的分支按钮：
   - 选中该节点（`selectNode`），使对话窗格的活动路径经过分支起点；
   - 复用 `handleStartBranch` 的守卫与 `branchComposerTarget` 设置逻辑；
   - 关闭全景视图回到对话视图；
   - 全景关闭、Composer 挂载后自动聚焦输入框。
3. 点击分支按钮不得触发卡片单击选中（onSelect）或双击打开对话（onOpenInConversation）。
4. 不可变更状态（生成运行中、已归档、加载中等，即 canMutate=false）下不渲染该按钮。

## Acceptance Criteria

- [x] 全景图上有子节点的助手卡片显示"从此处创建分支"按钮；用户卡片、无子节点的助手卡片不显示。
- [x] canMutate 为 false 时不渲染该按钮。
- [x] 点击按钮后：onSelect / onOpenInConversation 未被触发；全景视图关闭；对话窗格显示到分支起点为止的消息并出现"由此处创建分支"分隔标记；Composer 处于分支占位文案且已聚焦。
- [x] 在 Composer 输入并提交后走既有 createBranch 流程（不改变 store/client 契约）。
- [x] ConversationPanorama 单元测试覆盖按钮渲染条件与回调；ConversationWorkspace 集成测试覆盖"全景点击分支 → 返回对话 → 提交建分支"链路。
- [x] pnpm test / lint / typecheck 全绿，改动文件通过 Prettier。

## Notes

- 轻量任务：PRD-only。技术方案已探索明确：`PanoramaNodeData` 注入 `onCreateBranch` 回调（null 表示隐藏），工作区提供稳定 `useCallback` 处理器并用 ref+effect 在全景关闭后聚焦 Composer。
- 工作树：`~/Code/canopy-panorama-branch`（分支 `feat/panorama-branch-button`），任务产物与实现均留在工作树内。
