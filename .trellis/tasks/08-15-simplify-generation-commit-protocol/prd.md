# 简化消息生成提交协议

## Goal

将当前“流式完成后由前端自动确认、后端再提交”的两阶段协议，精简为由 Rust 后端拥有生成终态和最终持久化的单一流程，降低跨 Rust、Tauri IPC、TypeScript bridge、Zustand 和 React controller 的重复状态机复杂度，同时保留流式展示、准确取消、SQLite 权威回读和会话树安全性。

## Background

- 当前后端在 `Running`、`AwaitingCommit`、`Committing`、`Cancelling` 之间转换，并生成一次性 `commit_token`、等待最多 30 秒的前端确认。
- 当前 bridge 额外验证 `waiting`、`streaming`、`awaiting_commit`、`terminal` 事件顺序；Zustand 和 workspace controller 又分别维护 `committing`、`reconciling`、确认定时器与数据库重载。
- `ready_to_commit` 到达后，前端会立即调用 `commitGeneration`；用户没有“接受/保存回复”的显式决策，因此该握手不是用户审批机制。
- 已确认产品语义：当 provider 已经正常生成完最终内容，即使 WebView/Channel 在终态送达前断开，assistant 仍应保存，并在下次加载会话时出现。流尚未正常完成时的 Channel 失败继续视为取消，不保存 partial assistant。
- 现有产品要求仍然包括：生成 delta 只用于瞬态展示；最终历史只接收 SQLite 返回的权威 assistant 节点；同一会话至多一个活动生成；取消必须匹配 generation ID；归档、父节点角色、活动路径和树完整性必须继续校验。
- 成熟的流式聊天实现通常在服务端正常完成时保存最终消息；客户端负责展示、取消和在重连后读取权威历史，而不以自动 UI acknowledgement 作为数据库提交前置条件。

## Requirements

1. 删除作为自动内部握手存在的 `ready_to_commit`、`commit_generation` 和一次性 `commit_token`；不得用另一套等价的前端自动确认协议替代。
2. Rust 后端拥有从 provider 正常结束到最终 assistant 持久化的完整终态：在事务内重新确认会话可写、目标父节点有效且角色为 user，然后插入并返回唯一的权威节点。
3. 生成期间继续向 UI 提供 `started` 和有序 `delta`，且 delta 不进入 SQLite、正式消息树或持久化前端状态。
4. 用户仍可在生成尚未进入最终数据库提交前，使用准确 generation ID 取消当前生成；提交已经开始或完成后，取消不得伪装成回滚成功。
5. 前端只保留展示和用户操作所需的最小生成状态；移除 `committing`、`reconciling`、确认 grace timer、确认失败分类和手动 reconciliation retry。
6. 正常完成后，前端只合并 Rust 返回的权威 assistant 节点；如果终态返回丢失，重新加载会话必须能从 SQLite 恢复，不得制造或重复插入节点。
7. 保留现有 provider profile/keyring、HTTPS/loopback endpoint、SSE 语法和大小边界、活动路径隔离、单会话生成互斥、归档保护、错误脱敏与 SQLite 事务规则。
8. 保持现有对用户可见的流式 Markdown、停止、失败提示、重新生成、分支、编辑、历史恢复和归档只读行为；只允许与已决断线策略直接相关的语义变化。
9. 优先复用现有数据库 schema；除非幂等终态无法在现有约束下可靠实现，否则不增加 generation job/outbox 表或消息状态列。
10. 持久化线性化边界位于 Rust：取消在 provider 正常结束后的最终提交开始前获胜则不保存；最终提交先获胜则保存，后续取消返回未接受。WebView 是否仍连接不得改变已经开始的最终提交。

## Acceptance Criteria

- [ ] 生产代码中不再存在 `ready_to_commit` event、`commit_generation` command、`commit_token` 或 30 秒 acknowledgement timeout。
- [ ] 一次正常生成只插入一个最终 assistant 节点；`completed`/最终 command result 携带该 SQLite 权威节点。
- [ ] 流式过程中数据库和正式会话树均无 partial assistant；失败或提交前取消不会留下 assistant 节点。
- [ ] 同一会话并发生成、跨会话独立生成、取消与最终提交竞争均有确定且经过测试的结果。
- [ ] Channel 在流式阶段失败时不保存 partial assistant；provider 正常完成并进入最终提交后，即使终态传输失败也仍保存一个 assistant，重新加载可见。
- [ ] 前端不再包含 `committing`/`reconciling` 状态、自动 `commitGeneration` 调用或 reconciliation timer。
- [ ] 正常流式、停止、provider/网络/数据库失败、终态传输丢失后的重载、归档竞态和重复终态均有回归覆盖。
- [ ] 活动路径顺序与兄弟分支隔离、assistant Markdown、编辑/分支、历史恢复和 provider 设置测试继续通过。
- [ ] 前端完整质量门和 Rust fmt、Clippy、测试通过。

## Out of Scope

- 增加用户可见的“接受/保存回复”审批按钮。
- 将 partial assistant 持久化，或实现 token-by-token 断点续传。
- 引入通用任务队列、消息代理、事件溯源或跨进程 distributed transaction。
- 修改 provider HTTP/SSE 协议、会话树数据模型或现有消息内容格式。
