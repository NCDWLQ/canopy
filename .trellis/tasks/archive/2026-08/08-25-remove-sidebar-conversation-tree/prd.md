# 移除侧栏会话树，改由思维导图入口查看

## Goal

简化会话工作区的侧栏，将会话树的唯一可视化入口收敛到思维导图按钮，减少同一树形结构在两个位置重复展示，同时保留会话历史和现有会话操作。

## Background and confirmed facts

- `ConversationWorkspace` 的侧栏当前同时渲染历史记录和 `OutlineTree`（`src/features/conversations/components/ConversationWorkspace.tsx:523-745`）。
- 顶部思维导图按钮切换 `MindMapCanvas`（`src/features/conversations/components/ConversationWorkspace.tsx:870-892,962-974`）。
- 后端已注册并实现 `load_conversation_tree`（`src-tauri/src/lib.rs:30-38`、`src-tauri/src/conversations/commands.rs:807-816`），前端客户端也已有对应调用（`src/lib/tauri/client.ts:200-208`）。
- 侧栏历史记录使用独立的 `list_conversations` 数据，不应因移除树形区块而删除。

## Requirements

- 从会话工作区侧栏移除 `OutlineTree` 及其“会话树”区块。
- 保留侧栏中的历史记录列表、搜索、新建会话、设置、归档/重命名/删除等既有能力。
- 保留顶部思维导图入口；打开后继续展示当前会话的完整树形结构，并支持现有节点选择和返回会话视图行为。
- 保留后端 `load_conversation_tree` 命令及其数据契约，不新增或修改后端入口。
- 更新受影响的工作区测试，使测试验证新的入口约束，而不是依赖侧栏树存在。

## Acceptance Criteria

- [x] 打开会话工作区时，侧栏不再显示“会话树”标题、`OutlineTree` 节点或对应的树形操作。
- [x] 历史记录仍可显示并可切换会话；搜索、新建会话、设置及会话管理操作不受影响。
- [x] 点击思维导图入口后，当前会话的树仍可见；节点选择和“在会话中打开”仍正常工作。
- [x] 现有会话树加载、后端 IPC 契约及相关数据校验测试保持通过。
- [x] 前端类型检查、相关单元/组件测试和项目质量检查通过。

## Out of scope

- 不删除或重命名后端 `load_conversation_tree`、`list_conversations` 等命令。
- 不改变会话树数据模型、持久化、分支逻辑或思维导图布局。
- 不移除整个侧栏，也不改变历史记录的交互设计。

## Open questions

无。当前需求与代码证据已足以确定 MVP 范围。
