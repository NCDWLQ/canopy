# 生成体验产品化

## Goal

将助手生成过程呈现为稳定、连续的普通消息体验，隐藏提交与数据库协调等内部工程状态；同时保持 transient generation、权威节点和自动提交的数据边界，确保生成失败、明确保存失败与保存结果不确定得到不同且真实的用户反馈。

## User Value

- 正常生成路径只呈现“正在思考 → 流式回复 → 完成”，不暴露数据库、临时消息或保存协议术语。
- 提交和恢复期间保留已经生成的内容，不因内部状态切换而改变消息位置或视觉结构。
- 失败提示和操作与后端真实能力一致，不提供无法执行的“重试保存”。

## Background and Confirmed Facts

- 前端已使用闭合 `GenerationState` 表示 `starting`、`streaming`、`committing`、`reconciling`、`completed`、`failed` 和 `cancelled`，但 `failed`/`cancelled` 当前丢弃生成内容（`src/features/conversations/store/index.ts:18-47,666-690`）。
- `ConversationWorkspace` 当前把 transient 状态映射为独立工程化视图，包含 `Not saved`、`Starting generation…`、`Saving the accepted response…` 等文案（`src/features/conversations/components/ConversationWorkspace.tsx:106-155`；`src/features/conversations/components/ConversationPane.tsx:118-172`）。
- `ready_to_commit` 已由 `useWorkspaceGenerationController` 自动确认；`commitToken` 直接从事件回调参数传给 `commitGeneration`，未进入 Zustand 或组件属性（`src/features/conversations/hooks/useWorkspaceGenerationController.ts:144-178`）。
- Rust 协议允许 `failed` 在 `ready_to_commit` 前或后到达。前端可依据失败发生时的当前 phase 区分生成失败和提交后的持久化失败，无需扩展 IPC（`src-tauri/src/providers/generation.rs:341-377`；`src-tauri/src/providers/commands.rs:108-143`）。
- `commitGeneration` 只返回 `{ accepted }`，没有对相同 token/content 的再次提交命令；一次性 token 被接受后不能重放。因此明确保存失败的真实恢复操作是重新生成，而非“重试保存”（`src-tauri/src/providers/generation.rs:117-158`）。
- 控制器已有 1,500 ms 可注入终态宽限期和 SQLite 权威重载路径，可作为恢复提示的延迟阈值；当前缺口是 commit 调用抛错时会立即进入可见 `reconciling`（`src/features/conversations/hooks/useWorkspaceGenerationController.ts:59-63,121-175`）。
- 只有 exact `completed.node` 或 `loadConversationTree` 返回的权威树会更新 `nodesById`/`fullNodes`；流式 delta 只更新 transient generation content（`.trellis/spec/frontend/state-management.md`）。

## Requirements

### R1. 隐藏内部工程状态

- `starting`：在普通助手消息中显示“正在思考”。
- `streaming`：在同一个普通助手消息气泡中流式追加内容。
- `committing`：保持完整回复，完全静默，不显示状态、Badge 或保存提示。
- `completed`：显示正常助手消息。
- `reconciling`：宽限期内保持安静；恢复耗时明显后显示“正在恢复这条回复…”。
- `failed`（生成阶段）：显示“回复失败”并提供“重新生成”，不得显示数据库或保存术语。
- `failed`（明确保存失败）：保留完整回复，显示“这条回复未能保存”，并提供“重新生成”。
- `cancelled`：保留已生成的部分文字并显示“回复已停止”。
- 正常流程移除 `Not saved`、“临时消息”、“正在保存”、“等待确认写入数据库”、“正在确认数据库提交”等工程文案。

### R2. 将 transient 内容投影为普通助手消息

- `starting` 创建普通助手占位消息。
- `streaming` 更新同一消息气泡，不创建或移动消息。
- `committing` 保持气泡内容和结构原样。
- `completed` 以数据库返回的权威节点无闪烁替换 transient 投影。
- durable 与 transient 助手回复使用同一个无持久身份的消息外壳；transient 投影不得伪造节点 ID。
- 整个成功路径不改变消息位置和视觉结构。

### R3. 保持数据层边界

- 流式内容只存在于 transient generation state。
- 提交完成前不得写入 `nodesById`、`fullNodes` 或 SQLite。
- 只有数据库确认返回的权威节点可以进入正式历史。
- 不得为了消除视觉闪烁而创建虚假权威节点或提前持久化。

### R4. 保持自动提交且隔离 `commitToken`

- 前端继续自动确认 `ready_to_commit`，不向用户展示确认操作。
- `commitToken` 只允许存在于事件回调局部变量，并直接传给单次 `commitGeneration` 调用。
- `commitToken` 不得进入 Zustand、组件属性、DOM、日志或任何持久化数据。

### R5. 延迟展示恢复状态

- `committing` 阶段完全静默。
- 复用现有 1,500 ms 终态宽限期：无论 commit 已返回 accepted 但终态丢失，还是 commit 调用结果不确定，宽限期内都保持 `committing` 的静默投影并继续接受 exact terminal event。
- 宽限期结束后才进入 `reconciling`、自动重载 SQLite，并显示“正在恢复这条回复…”。
- 自动重载进行中不显示按钮；只有重载失败或仍无法确认权威节点、需要用户介入时才显示“重试恢复”。

### R6. 区分失败类型与真实恢复动作

- `failed` 转换必须根据失败发生前的 generation phase 派生 `generation` 或 `persistence` 类型，不解析错误 message。
- 生成失败不得显示数据库或保存术语；显示“回复失败”和“重新生成”。
- `committing`/`reconciling` 后的明确失败必须保留完整 content，显示“这条回复未能保存”，并提供“重新生成”。
- `accepted: false` 是明确未提交结果，按保存失败处理。
- 保存结果不确定时保留回复并自动重载 SQLite；重载仍无法确认时保持 `reconciling`，不得转成 `failed`、擅自创建节点或猜测多个候选。

## Acceptance Criteria

- [x] AC1：成功路径经过 `starting`、`streaming`、`committing`、`completed` 时，始终复用同一视觉消息位置和普通助手气泡结构；`committing` 不产生任何可见状态。
- [x] AC2：权威节点到达后替换 transient 投影时没有内容清空、重复消息、位置跳动或工程 Badge 闪现。
- [x] AC3：提交完成前，流式内容不进入 `nodesById`、`fullNodes` 或 SQLite；完成后仅数据库返回节点进入正式历史。
- [x] AC4：`ready_to_commit` 自动确认，且生产代码与测试证明 `commitToken` 未进入全局状态、组件属性、DOM、日志或持久化数据。
- [x] AC5：commit 结果不确定或终态延迟时，1,500 ms 宽限期内保持完整回复且无恢复提示/按钮；宽限期后显示“正在恢复这条回复…”并自动重载 SQLite。
- [x] AC6：自动重载成功时安装权威节点；无匹配节点或重载失败时保持回复和 `reconciling`，只在此时显示“重试恢复”。
- [x] AC7：生成阶段失败显示“回复失败”和“重新生成”；提交后明确失败保留完整内容并显示“这条回复未能保存”和“重新生成”；两者均无数据库术语。
- [x] AC8：取消生成后保留已接收的部分输出，并显示“回复已停止”。
- [x] AC9：正常流程中不存在 `Not saved`、“临时消息”及任何保存/数据库确认工程文案。
- [x] AC10：store、controller 和 component 测试覆盖阶段派生、内容保留、自动提交、宽限计时、exact terminal 竞态、SQLite 重载、用户介入门槛及权威替换。

## Out of Scope

- 修改 Rust 生成、提交、SQLite schema 或 IPC DTO 协议。
- 引入用户手动确认提交步骤。
- 新增或伪装后端不支持的“重试保存”。
- 将 transient 内容提前提升为正式历史，或为 transient 气泡伪造 durable node identity。
- 本任务之外的全局语言本地化；本任务使用需求指定的生成状态文案。
