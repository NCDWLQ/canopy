# PRD: 允许生成时切换会话，转为后台生成

## Goal

生成进行中时允许用户在侧栏切换到其他会话（或新建会话），原会话的生成不被打断，转为后台继续运行；切回时恢复实时流式展示。用户不再被"请等待当前回复完成"锁在单个会话里。

用户价值：长回复生成期间可继续阅读、操作其他会话；可在多个会话中并行推进多轮对话。

## Background（代码勘察结论）

### 后端已具备多会话并发生成能力，本任务零 Rust 改动

- `GenerationRuntime.reserve` 按 conversation_id 加租约：同一会话同时只允许一个生成（重复返回 `GenerationAlreadyActive`），不同会话可并发（`src-tauri/src/providers/generation.rs:401` 测试锁定）。
- 生成完成后由后端持久化 assistant 节点并在 terminal DTO 返回（`generation.rs:251-293`）；前端展示状态与持久化解耦，切走不影响落库。
- 取消按 generation_id 精确执行（`cancel_generation` 命令）。

### 前端是唯一的限制来源

- `useConversationStore` 持有一个已加载会话树 + 单例 `generation` 状态（`src/features/conversations/store/index.ts:17-60`）。
- 生成期间被禁用/拦截的入口：侧栏会话按钮（`ConversationWorkspace.tsx:369-372`）与"新建会话"按钮（`:329-332`、`:506-509`）；store 守卫 `selectConversation`（store `:498-507`）、`loadConversation`（`:817`）、`selectNode`（`:808`）、`enterConversationCreation`、`createConversation`、`appendNode`、`createBranch`、`editNodeAsBranch`；`prepareMutation()` 隐式取消（controller `:237-240`）；卸载取消（`:242-249`）；归档当前会话时取消（弹窗有提示）。
- 事件守卫（`acceptGenerationStarted` / `appendGenerationDelta`）校验 `state.activeNodeId === generation.parentNodeId` 等树状态，树一旦移开即 fail-closed 取消后端运行——后台化必须把守卫重定位到 run 注册表。
- 桥接层 `generateFromActivePath`（`src/lib/tauri/provider-client.ts:119`）每次调用独立状态机，并发调用互不干扰。
- `completeGeneration` 只能把权威节点并入当前已加载树；后台完成仅能更新 summary，切回时 `loadSelectedConversation` 重载获得新节点。
- `ConversationWorkspace` 在 App 根部仅挂载一次（`App.tsx`），run 注册表挂 store 层即可跨会话存活。
- `GlobalSettingsDialog` 以 `generationActive` 禁用配置变更（全局唯一 profile）。
- 项目当前无 toast 基础设施；shadcn 生态标准为 sonner。
- `.trellis/spec/frontend/state-management.md` 记载"one loaded conversation + one transient generation lifecycle"模型，落地后需同步更新。

## Decisions（用户已确认）

1. **多路并发**：后台 run 存在期间可在其他会话正常发消息、起新生成；前端采用按 conversationId 的 run 注册表。（2026-08-16）
2. **后台终态 toast**：完成与失败均弹 toast（sonner，官方配方面包、top-right）；仅后台 run 弹（前台已有内联展示）。标题 = 本次生成的用户 prompt 预览（~60 字符截断，随 run 记录捕获），内容 = 模型输出预览（~120 字符截断）或错误信息；无按钮，点击 toast 本体跳回会话；失败详情记录在注册表，切回时内联展示完整错误。（2026-08-16；内容与交互为同日迭代定稿）
3. **切回焦点**：切回有活跃 run 的会话时，重载后 activeNodeId 强制回到 run.parentNodeId 并展开路径，保证流式气泡可见。（2026-08-16）
4. **同会话切节点解禁**：生成中的会话内允许在会话树切换查看其他分支；树变更操作（追加/分支/编辑）仍被该会话的活跃 run 拦截。（2026-08-16）
5. **不做侧栏直接取消入口**：取消需切回该会话后操作。（2026-08-16，多选未勾选）

## Requirements

1. 生成期间侧栏可切换会话、可新建会话；原会话生成转入后台继续，不取消、不中断。
2. 前端维护按 conversationId 键控的 run 注册表（runId、parentNodeId、generationId、model、累积内容、phase），每会话至多一条记录；后端租约语义照旧（同会话单 run、跨会话并发）。
3. 切回有活跃 run 的会话时重新附着：焦点回到生成路径，恢复实时流式展示（含切走期间累积的内容），可取消。
4. 多路并发：在无活跃 run 的会话中可正常发消息并起新生成；同一会话的树变更操作在其活跃 run 期间被拦截。
5. 同会话生成期间可切换节点查看其他分支；当前路径末端非生成父节点时不渲染流式气泡，Composer 保持取消入口。
6. 后台完成：弹 toast（可跳转），更新该会话 summary 的 updatedAt（历史列表重排）；切回时树重载即含新节点。
7. 后台失败：弹 toast（可跳转）；失败详情保留在注册表，切回时内联展示完整错误，随下一次动作清除。
8. 侧栏对生成中的会话显示运行指示。
9. 归档一个有活跃 run 的会话（含后台）时先取消该 run，确认弹窗提示会打断生成。
10. 任一会话有活跃 run 时，服务配置（模型/端点/API Key）编辑被禁用。

## Out of Scope

- 应用关闭后恢复生成（run 随进程终止）。
- 后端 Rust / IPC 协议改动（schema、DTO 零变化）。
- 生成排队/队列机制。
- 侧栏行内取消按钮。

## Acceptance Criteria

- [x] 会话 A 生成中切到会话 B：A 的生成继续，B 完全可用（含发消息起新生成）；侧栏 A 行显示运行指示。
- [x] A、B 两路生成并存，各自独立流式展示、独立取消。
- [x] A 后台完成：toast 出现且点击可跳回 A；A 的 summary 时间戳更新并置顶；切回 A 能看到新 assistant 节点。
- [x] A 后台失败：toast 出现且点击可跳回 A；切回 A 内联展示完整错误。
- [x] 生成中切回 A：焦点位于生成路径，流式内容（含切走期间累积部分）续显，可取消。
- [x] 同会话生成中切换节点：气泡消失、无报错；分支/编辑/追加按钮禁用。
- [x] 归档后台生成中的会话：弹窗提示打断，确认后 run 取消、无持久化错误。
- [x] 任一 run 活跃时设置对话框禁用配置编辑。
- [x] `pnpm check`（format/lint/typecheck/test/build）通过。
