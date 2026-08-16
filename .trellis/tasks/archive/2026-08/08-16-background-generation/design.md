# Design: 后台生成（多会话并发生成）

## 架构总览

后端零改动。全部工作在前端：

1. **Store 重架构**：单例 `generation` → 按 conversationId 键控的 run 注册表。
2. **控制器改造**：事件路由与守卫面向注册表而非当前可见树；移除隐式取消。
3. **UI**：侧栏解锁 + 运行指示；per-conversation 变更锁；toast（sonner）。
4. **规范同步**：更新 `.trellis/spec/frontend/state-management.md` 的状态模型描述。

## 数据模型

### GenerationRun（注册表值，store 顶层字段 `generationRuns`）

```ts
type GenerationRun =
  | { phase: "starting"; runId; conversationId; parentNodeId; generationId?; model? }
  | { phase: "streaming"; runId; conversationId; parentNodeId; generationId; model; content }
  | { phase: "cancelled"; runId; conversationId; parentNodeId; generationId?; content }
  | { phase: "failed"; runId; conversationId; parentNodeId; failureKind; error; content? }

// ConversationStore 顶层：
generationRuns: Readonly<Record<string, GenerationRun>> // key: conversationId
```

- 每会话至多一条记录（同会话二连发生成被 UI 与后端租约双重拒绝；新 run 覆盖旧终态记录）。
- 派生选择器：
  - `selectCurrentRun(state)` = `state.conversationId ? generationRuns[state.conversationId] : undefined`（前台 run；`starting|streaming` 为活跃）。
  - `selectActiveRunIds(state)`：活跃 run 的 conversationId 集合（侧栏指示、设置锁）。
- 现有 `GenerationState` 类型删除，组件统一消费派生视图。

### 记录生命周期

- `starting/streaming`：活跃。前台展示流式气泡；后台仅侧栏指示。
- `completed`（瞬态）：并入树（前台）或更新 summary（后台）→ 记录删除 → 后台时弹 toast。
- `cancelled`：保留记录；再次进入该会话时展示已取消气泡（含部分内容），随下一次动作清除。取消只能在前台发起（无侧栏取消入口），故不会出现"后台被取消"。
- `failed`：保留记录；后台时弹 toast；切回时内联展示完整错误，随下一次动作清除。

## Store 改动清单（`src/features/conversations/store/index.ts`）

### 守卫放宽（生成期间不再拦截）

| 动作 | 现状 | 新行为 |
|---|---|---|
| `selectConversation` / `loadConversation` | 生成中 no-op | 放行；重载后若该会话有 run 记录，`activeNodeId` 覆盖为 `run.parentNodeId` 并展开其路径（决策：强制回到生成路径） |
| `enterConversationCreation` | 生成中 no-op | 放行 |
| `createConversation` | 生成中 no-op | 放行（新会话与生成中的会话无关） |
| `selectNode` | 生成中 no-op | 放行（决策：同会话切节点解禁；仅查看） |
| `appendNode` / `createBranch` / `editNodeAsBranch` | 生成中 no-op | 守卫改为"**当前会话**有活跃 run 才拦截"（per-conversation 锁） |

### 事件路由守卫重定位（关键）

- `acceptGenerationStarted(runId, event)`：校验对象从"已加载树"改为"注册表记录"——记录存在、phase 匹配、runId/generationId/conversationId/parentNodeId 与 event 一致。删除 `state.activeNodeId === generation.parentNodeId`、`state.status === "ready"` 等树状态校验（后台 run 不依赖可见树）。
- `appendGenerationDelta(runId, event)`：对照注册表记录校验（现有逻辑基本保持，仅数据源换成注册表）。
- `completeGeneration(runId, generationId, node)`：
  - 前台（该会话已加载）：`addAuthoritativeAssistantNode` 放宽——不再要求 `activeNodeId === parentNodeId`；节点并入树，仅当当前 active 路径末端仍是 `parentNodeId` 时选中新节点，否则保持用户当前查看位置。
  - 后台：仅 `updateSummaryActivity`（列表按 updatedAt 重排）→ 删除记录。
  - 两种路径均更新 summary。
- `failGeneration` / `cancelGenerationRun` / `acceptGenerationCancelled` / `failGenerationRecovery`：按注册表记录路由；后台终态按生命周期章节处理。
- `recoverGeneration(runId, tree)`：当前实现绑定"已加载树"。拆分：前台沿用现有合并逻辑（去掉 activeNode 绑定校验）；后台仅做节点匹配判定（唯一新 assistant 子节点 = 完成 → summary 更新 + toast；否则按失败处理）。

### 新增

- `activeRunFor(conversationId): boolean`（或直接内联判断）供 per-conversation 锁使用。
- `clearRunTerminal(conversationId)`：清除该会话的终态记录（切回后用户下一次动作时调用；语义同现在 idle 复位）。
- summary 时间戳：后台完成/恢复同样走 `updateSummaryActivity`（已存在，无需改）。

## 控制器改动（`useWorkspaceGenerationController.ts`）

- **删除 `prepareMutation()` 的隐式取消**：变更合法性完全由 store 守卫裁决；守卫拒绝就是不执行，不再先 cancel。
- **删除卸载时取消**（`isMounted` 清理中的 cancel）：后台语义下卸载不应终止 run；App 生命周期内该组件不卸载，进程退出时 webview 随之销毁。
- `cancel()`：取消当前会话的前台 run（不变）。
- `startGeneration(expectedTarget)`：删除 `store.activeNodeId !== expectedTarget.parentNodeId` 校验（切节点已解禁），保留 conversationId 校验。
- `handleEvent` / `handleTerminal` / `recoverAmbiguousRun`：所有 `useConversationStore.getState().generation` 读取改为从 `generationRuns[run.conversationId]` 取该 run 记录；guard 失配仍 fail-closed（`requestExactCancellation`）——现在失配只意味着协议错误，而不再是"用户切走了"。
- terminal 到达时判断前台/后台：`getState().conversationId === run.conversationId`。后台终态触发 toast（见下）。
- `canGenerate` / `mutationLocked` / `unavailableReason`：从 `selectCurrentRun` 派生；`mutationLocked` 仅由当前会话活跃 run 决定。
- `archiveConversation`：取消条件从"归档当前生成中的会话"扩展为"目标会话（含后台）有活跃 run"；归档后台会话同样先取消。

## Toast 基础设施（新增依赖：sonner）

- `pnpm add sonner`；App 根挂 `<Toaster />`（自写薄封装 `src/components/ui/toaster.tsx`，不引 next-themes，主题用现有 CSS 变量对齐）。
- 官方 sonner 配方面包（CSS 变量 `--normal-*` 映射主题令牌 + lucide 图标 + `--radius`），定位 top-right。
- 触发点在控制器 terminal 处理处（唯一知道前/后台与错误详情的位置）：
  - 后台完成：`toast.success(promptPreview, { description: replyPreview, onClick: 跳转 })`
  - 后台失败：`toast.error(promptPreview, { description: 错误信息, onClick: 跳转 })`
  - 无动作按钮；点击 toast 本体即 `selectConversation(client, conversationId)` 跳转。
  - 标题 = run 记录的 `parentPreview`（beginGeneration 时从父节点内容截 ~60 字符、折叠空白）；内容 = `terminal.node.content` 截 ~120 字符（恢复路径拿不到回复全文，只给标题）。须在 store 终态转换**之前**读取 parentPreview——完成会删除记录。
  - 前台 run 不弹（已有内联展示）。取消不弹（用户自己点的）。
- 测试通过 mock/注入避免依赖 sonner DOM。

## UI 改动（`ConversationWorkspace.tsx` 等）

- 侧栏会话行：移除 `isGenerationActive` disabled；行内新增运行指示（活跃 run 时显示 animated dot/spinner，位于标题右侧，替代/复用 Badge 样式语言）。
- 两处"新建会话"按钮：移除生成 disable。
- `transientGeneration`：从当前会话 run 记录派生；**仅当 `path.at(-1)?.id === run.parentNodeId` 时渲染流式气泡**（用户切到其他节点时不显示气泡，Composer 仍显示取消按钮；placeholder 提示"回复生成中…"）。
- `canMutate` / `canAppend` / `userGenerationAction` / `assistantRegenerationTarget` 等：锁条件全部改为"当前会话活跃 run"。
- `GlobalSettingsDialog` 的 `generationActive`：改为"任一会话有活跃 run"。
- 归档确认弹窗：打断提示条件扩展到后台 run（目标会话有活跃 run 即提示）。
- `ConversationPane` 的 props/渲染逻辑按气泡可见性条件调整。

## 兼容性与风险

- **风险最高点**：事件守卫重定位。现有大量测试锁定"树状态失配 → fail-closed 取消"行为，需逐一改写为注册表语义；漏改会把后台 run 误杀。缓解：store 层单测先行李（terminal/事件路由矩阵：前台×后台 × 完成×取消×失败×恢复）。
- **行为变化**：前台失败/取消记录现在跨切换存活（切回仍可见），与旧"切走即清"不同——按已确认决策执行（失败切回展示）。
- **requestEpoch 竞态**：切回时"重载后覆盖 activeNodeId"须在 epoch 校验通过后应用，避免旧响应覆盖新会话焦点。
- 回滚点：store 重架构是单提交可整体 revert 的边界；toast 与侧栏指示是独立小提交。

## 测试策略

- `store/generation.test.ts`：重写为注册表语义的事件/终态矩阵（含后台路径）。
- `store/store.test.ts`：守卫放宽矩阵（生成中 select/load/create/selectNode 放行；同会话 append/branch 仍拦；异会话不拦）。
- `useWorkspaceGenerationController.test.tsx`：隐式取消删除、后台 terminal → toast 触发、恢复流后台路径。
- `ConversationWorkspace.test.tsx`：侧栏可用性、运行指示、气泡可见性条件、归档打断提示。
- `ConversationPane.test.tsx`：path 末端 ≠ parentNodeId 时无气泡。
