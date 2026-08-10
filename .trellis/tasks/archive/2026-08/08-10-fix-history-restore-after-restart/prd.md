# 修复重启后历史对话无法加载

## Goal

修复桌面软件重启后无法加载既有历史对话的问题，确保已持久化的对话能在重新启动后自动恢复并正常展示。

## Background

- 用户报告：软件重启后无法加载历史对话。
- 生产数据库 `/home/jwh/.config/app.canopy.desktop/canopy.db` 中现有 5 个对话和 21 个节点，证明数据已经落盘且在进程退出后仍存在；未读取消息正文。
- 根因是恢复链路缺失，而非数据库清空：后端只有按已知 ID 加载树的命令（`src-tauri/src/conversations/commands.rs:18`），前端重启后从空 Zustand 状态开始（`src/features/conversations/store/index.ts:167`），且工作区启动时只加载 provider profile（`src/features/conversations/components/ConversationWorkspace.tsx:75`）。
- SQLite 是唯一持久化真源，禁止用浏览器存储或 Zustand persist 绕过恢复链路（`.trellis/spec/frontend/state-management.md:63`）。

## Requirements

- 找到重启后历史对话丢失或不可见的根因，并保留可验证的代码证据。
- 新增 SQLite 支持的对话发现接口，返回全部对话的窄摘要；列表包含归档对话并按最近节点活动时间降序、对话 ID 升序稳定排列。
- 在工作区启动时自动发现历史；优先打开最近活动的未归档对话，如果只有归档对话则打开最近活动的归档对话。
- 加载一个历史对话时，选中按节点时间和 ID 稳定确定的最近叶节点，使根到该叶的完整活动路径可见；不承诺恢复退出前手动选择的旧分支。
- 提供历史列表供用户切换对话；归档对话继续可读且不可修改。
- 明确区分历史发现的加载中、空列表和失败状态，并防止 React StrictMode 或竞态中的旧响应覆盖更新的用户选择。
- 修复历史对话恢复链路，不破坏当前会话内的新建、发送、归档和展示行为；新建或归档后列表必须同步刷新。
- 对既有已持久化数据保持兼容；不得要求用户手工清理数据才能恢复。
- 为根因补充自动化回归测试。

## Acceptance Criteria

- [x] 软件进程完全退出并重新启动后，已有历史对话会被自动发现并加载。
- [x] 历史列表展示全部未归档与归档对话，按最近活动稳定排序；启动时按约定自动选择对话。
- [x] 自动加载和手动切换均展示所选对话最近叶节点的完整根到叶路径，无重复、串话、兄弟分支泄漏或明显顺序错误。
- [x] 空数据库继续显示新建对话表单；发现失败显示可重试错误，不伪装成空数据库。
- [x] 归档历史可读且所有修改入口保持禁用。
- [x] 当前会话的新建与消息发送行为继续正常工作。
- [x] 文件型 SQLite 数据库经关闭并重新连接后，可以列举并加载原有对话与节点。
- [x] 覆盖启动恢复、列表切换、空/错状态和 IPC 合同的自动化测试在修复前能暴露问题、修复后通过。
- [x] 相关 lint、类型检查和测试通过。

## Out of Scope

- 与本缺陷无关的对话 UI 重设计。
- 新增云同步或跨设备同步能力。
- 精确恢复退出前选中的对话与分支；当前数据模型没有持久化该游标。
- 为对话新增时间戳迁移；最近活动时间从现有节点数据兼容推导。

## Technical Notes

- 新命令沿用现有 Rust repository/service/command、共享 IPC fixture、Zod 校验和 typed client 边界。
- 对话摘要至少包含 `id`、`title`、`rootNodeId`、`isArchived` 和由 `MAX(nodes.created_at)` 推导的 `updatedAt`。
- 调查证据位于 `research/backend-persistence.md`、`research/frontend-restore.md` 和 `research/regression-history.md`。
