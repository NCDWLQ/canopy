# 消息删除功能：全景视图用户节点删除按钮

## Goal

在全景视图（ConversationPanorama）的用户消息节点卡片上提供删除入口：点击后弹出确认框，确认后永久删除该节点及其全部子孙节点，并保持前端选中状态与树结构一致。

## Background / Confirmed Facts

- 全景视图组件：`src/features/conversations/components/ConversationPanorama.tsx`，节点卡片为 `PanoramaNodeCard`；宿主 wiring 在 `ConversationWorkspace.tsx`（~990-1006 传入 `rootNodeId` / `nodesById` / handlers）。
- 现有 hover 操作栏只在 assistant 卡片上显示（`role === "assistant" && childCount > 0`），分支按钮文案为 `conversation.message.branchFromHere`（zh-CN: "从此处创建分支"），见 ConversationPanorama.tsx:71-202。本功能需要为用户节点新增操作栏/删除按钮。
- 当前无任何节点级删除能力：
  - Tauri 命令层（`src/lib/tauri/client.ts` 的 `CONVERSATION_COMMANDS`）没有 delete_node 类命令。
  - SQLite 有 `nodes_reject_delete` 触发器禁止删除节点（`src-tauri/migrations/0002_conversation_tree.sql:87-91`）；会话级删除通过临时摘除触发器实现（`src-tauri/src/conversations/repository.rs` ~295-337），可复用该模式。
  - 集成测试断言直接 DELETE 节点失败（`src-tauri/tests/tree_persistence.rs` ~980-983），该保护须保留。
- 前端 zustand store：`src/features/conversations/store/index.ts`，持有 `rootNodeId` / `activeNodeId` / `nodesById` / `fullNodes`；`hasValidTreeShape`（~1936-1955）要求 `activeNodeId` 存在于 `nodesById`，否则路径投影报 `TREE_INTEGRITY_ERROR`。
- 确认框：共享组件 `src/components/ui/confirm-dialog.tsx`（包装 shadcn AlertDialog，支持 `destructive`）。
- i18n：`src/lib/i18n/locales/zh-CN.ts` 与 `en.ts`，新增 key 放在 `conversation.panorama.*` 或 `conversation.message.*` 下；测试固定 zh-CN（`src/test/setup.ts`）。
- 相关测试：`ConversationPanorama.test.tsx`、`ConversationWorkspace.test.tsx`、`store/store.test.ts`、`src-tauri/tests/tree_persistence.rs`。

## Requirements

- R1: 全景视图中，**用户角色（user）且非根节点**的卡片在 hover 操作栏中显示删除按钮（图标按钮，与分支按钮同风格）；根节点与 assistant 节点不显示删除入口。
- R2: 点击删除按钮弹出确认框（`ConfirmDialog`，destructive 样式），文案说明将删除该消息及其全部分支后代；取消不触发任何变更。
- R3: 确认后调用新的 Tauri 命令，在单个事务中物理删除该节点及其全部子孙节点（复用"临时摘除 `nodes_reject_delete` 触发器"的既有模式）；触发器在操作后必须恢复。
- R4: 后端校验：目标节点必须存在、属于当前会话、role 为 user、且不是根节点（parent_id 非空），否则返回错误。
- R5: 删除成功后前端 store 同步移除子树（`nodesById` / `fullNodes` / 父节点 `childIds`），若 `activeNodeId` 在被删子树内，则重定向到被删节点的父节点；清理关联的 `generationRuns` 记录。
- R6: 会话有正在进行的生成（同分支按钮的 `canMutate` 门控）时不允许删除。
- R7: 新增 i18n 文案，zh-CN 与 en 双语。

## Key Decisions

- D1: 删除入口只在**用户节点**上（用户明确要求；为 user 卡片新增操作栏显示条件）。
- D2: **物理删除**子树（硬删除、不可恢复），不改软删除；`nodes_reject_delete` 触发器保留，仅在新命令事务内临时摘除。
- D3: 删除活动路径上的节点后，`activeNodeId` 重定向到**被删节点的父节点**。
- D4: 根节点不显示删除按钮；删除整个会话仍走现有会话级删除入口。

## Acceptance Criteria

- [ ] AC1: 全景视图中 hover 任一非根用户节点，操作栏出现删除按钮；hover 根节点或 assistant 节点不出现。
- [ ] AC2: 点击删除按钮弹出确认框；点击取消后树结构、选中状态不变，未发出任何删除 IPC。
- [ ] AC3: 确认后，该用户节点及其全部子孙从全景视图与会话面板中消失；父节点的子节点列表不再包含它。
- [ ] AC4: 若删除前选中了子树内节点，删除后选中节点变为被删节点的父节点，会话面板正常显示对应路径（无 TREE_INTEGRITY_ERROR）。
- [ ] AC5: 删除后 SQLite 中子树节点不存在，且 `nodes_reject_delete` 触发器仍然存在（直接 DELETE 单节点仍报错）。
- [ ] AC6: 对根节点、assistant 节点、不存在/跨会话节点调用删除命令返回错误。
- [ ] AC7: 生成进行中删除入口不可用。
- [ ] AC8: `pnpm test`、`pnpm typecheck`、`pnpm lint`、`cargo test`（src-tauri）全部通过，含新增测试。

## Out of Scope

- 会话面板（MessageNode）中的删除入口（本期只做全景视图）。
- 软删除 / 回收站 / 撤销删除。
- assistant 节点的删除。

## Risks / Deferred

- 物理删除不可恢复：确认框文案须明确"不可恢复"。
- 生成进行中删除会导致 finalize 写入失败：通过 R6 门控规避，不做运行中取消逻辑。
