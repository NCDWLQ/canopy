# Implement: 后台生成

## 执行顺序（小步提交，每步 `pnpm check` 可绿）

### Step 1 — 依赖与 toast 基础设施
- `pnpm add sonner`
- 新建 `src/components/ui/toaster.tsx`（薄封装，无 next-themes；样式对齐现有 CSS 变量）。
- `App.tsx` 挂 `<Toaster />`。
- 验证：`pnpm check`；无行为变化。

### Step 2 — Store：run 注册表与守卫放宽
- `GenerationState` → `GenerationRun`；新增 `generationRuns: Record<string, GenerationRun>` 顶层字段与 `selectCurrentRun` / `selectActiveRunIds` 选择器。
- 动作签名按 design.md 重定位（事件守卫对注册表；`completeGeneration` 前台/后台分路；`recoverGeneration` 拆前台/后台）。
- 守卫矩阵调整：select/load/create/enterCreation/selectNode 放行；append/branch/edit 改 per-conversation 锁；新增 `clearRunTerminal`。
- 重载后焦点覆盖：`loadSelectedConversation` 成功路径中，若该会话有 run 记录（活跃或未查看终态），`activeNodeId = run.parentNodeId`（节点须存在于树中，否则回退 newestLeaf），并展开其祖先路径。注意在 epoch 校验之后应用。
- 同步改 `store/generation.test.ts`、`store/store.test.ts`（先写失败测试再实现）。
- 风险文件：`src/features/conversations/store/index.ts`（核心，回滚点）。

### Step 3 — 控制器改造
- `useWorkspaceGenerationController.ts`：删除 `prepareMutation` 隐式取消与卸载取消；所有 run 读取改注册表；terminal 前台/后台分路；后台完成/失败触发 toast（跳转 action 用注入的 conversationClient + `selectConversation`）；`archiveConversation` 取消条件扩展到后台目标。
- `startGeneration` 删除 activeNodeId 相等校验。
- `canGenerate` / `mutationLocked` / `unavailableReason` 改 `selectCurrentRun` 派生。
- 同步改 `useWorkspaceGenerationController.test.tsx`。

### Step 4 — UI 接线
- `ConversationWorkspace.tsx`：侧栏/新建按钮解锁；会话行运行指示；`transientGeneration` 由注册表派生；气泡可见性条件（`path.at(-1)?.id === run.parentNodeId`）；`GlobalSettingsDialog.generationActive` 改任一活跃 run；归档弹窗打断提示扩展。
- `ConversationPane.tsx`：气泡渲染条件与 props 调整；Composer placeholder "回复生成中…" 分支。
- 同步改 `ConversationWorkspace.test.tsx`、`ConversationPane.test.tsx`。

### Step 5 — 收尾
- 全量 `pnpm check`。
- `trellis-update-spec`：更新 `.trellis/spec/frontend/state-management.md`（"one loaded conversation + one transient generation lifecycle" → per-conversation run 注册表模型）；如 hook 规范涉及控制器生命周期，一并更新。

## 验证命令

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 或 pnpm check
```

手动冒烟（`pnpm tauri dev`）：
1. 会话 A 生成中 → 侧栏切到 B（A 侧栏行出现指示）→ B 发消息起新生成（两路并发流式）。
2. A 后台完成 → toast 出现、A 置顶 → 点击 toast 跳回 A 看到新回复。
3. 生成中切回 A → 焦点在生成路径、流式续显 → 可取消。
4. 同会话生成中切节点：气泡消失、Composer 显示停止按钮、分支按钮禁用。
5. 归档后台生成中的会话：提示打断 → 确认后 run 取消、无持久化错误。
6. 生成中打开设置：配置编辑被禁。

## 风险与回滚

- 核心风险：Step 2 事件守卫重定位（见 design.md 风险节）。Step 2 独立成提交，可整体 revert。
- 不改任何 Rust 代码、不改 IPC 协议（schema/DTO 零变化）。
- sonner 为唯一新依赖，React 19 兼容（v2）。
