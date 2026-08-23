# Conversation rename, delete & unarchive（对话重命名、删除与取消归档）

## Goal

用户可以在侧栏会话行通过「…」菜单重命名会话、删除会话、归档/取消归档会话（原归档单按钮并入菜单）。删除为硬删除 + AlertDialog 确认；重命名为 Dialog + 输入框；取消归档为菜单直达操作。补齐会话管理基本操作：现状标题仅由自动生成写入（`update_title` 无 IPC 暴露），会话数据无任何删除路径，归档后无法恢复。

## Background（调研事实，锚点见 research/codebase-survey.md）

- 侧栏内嵌 `ConversationWorkspace.tsx:327-434`，每行现有唯一操作是 hover 归档按钮（:416-428），已归档行无操作。
- IPC 契约冻结：新增命令须同组变更 commands.rs（`CONVERSATION_COMMAND_NAMES` :19-29 + 冻结测试 :672-677）、lib.rs 两处注册（:9-23, :25-48）、契约夹具 conversation-ipc.json、src/lib/tauri 封装（schemas/client）、前端 mock 测试样例（lib.rs:97-175）。错误码为闭合 11 值枚举（error.rs:8-20）。
- 标题：应用层校验 `validate_title`（commands.rs:395-404，trim 非空 ≤200）+ 前端 zod 镜像 `titleSchema`（schemas.ts:57-59）；`update_title` 持久层已存在（repository.rs:197-212，**不触碰 updated_at**）但未暴露 IPC。新会话初始标题由首条 prompt 派生（`deriveConversationTitle`），自动标题在「首个 user + 恰好一个 assistant」条件下于生成完成后触发并覆盖（titles.rs:40-109）。
- 归档链路完整存在，可作取消归档的对称模板：命令 commands.rs:645-654 → service.rs:385-394 → repository.rs:214-238（`UPDATE ... SET is_archived=1`，幂等：rows_affected==0 且行存在时原样返回）；前端 controller :379-392（先取消 run）→ store action store/index.ts:1352-1441（非当前=仅 history 通道错误也走 history；当前=全局状态迁移 `isArchived:true` + `removeRunRecord`）。
- 删除硬阻碍：trigger `nodes_reject_delete`（0002:87-91）ABORT 任何 `DELETE ON nodes`；nodes FK 无级联（0002:25）。事务内 DROP→删→重建 trigger 是可行路径（DDL 可事务化；运行时 DROP 先例 tree_persistence.rs:522-525）。
- 事务惯例：service `pool.begin()` → repo 静态方法 → `commit()`，早退隐式回滚；写错误走 `PersistenceError::from_write`，trigger 拒绝 marker 登记 conversations/error.rs:40-58。
- UI 模式：确认 = AlertDialog + pendingId（归档 ConversationWorkspace.tsx:164,694-738；Provider 删除 ProviderSettingsList.tsx:202-239）；表单弹窗 = Dialog+Input（ProviderSettingsEditor.tsx）；DropdownMenu 范例 ProviderSettingsList.tsx:121-165。`common.delete/cancel/save` i18n 键已存在。
- 前端状态参考：rename 更新参考 `applyTitleUpdate` 双通道（store/index.ts:605-625）；delete 参考 archive action 的 current/non-current 分支 + run 清理；落点规则参考 history 初始化（store/index.ts:653-659：最新未归档，无则 history status="empty"）。

## Decisions

| # | 决策 | 状态 |
|---|------|------|
| D1 | 删除 = 硬删除 + AlertDialog 确认；不做回收站/软删除 | 用户确认 2026-08-23 |
| D2 | 侧栏操作入口 = hover「…」按钮 → DropdownMenu（重命名/归档或取消归档/删除），取代原归档单按钮 | 用户确认 2026-08-23 |
| D3 | 重命名 = Dialog + 输入框（预填当前标题，前端即时校验） | 用户确认 2026-08-23 |
| D4 | 已归档行菜单含取消归档（菜单直达、无确认框——非破坏性可再归档自愈）；同时提供重命名/删除 | 用户确认 2026-08-23（"同时允许取消归档"） |
| D5 | 删除当前会话后落点 = 直接回到空状态（新对话），不自动切换到剩余会话；侧栏列表保留其余项 | 用户确认 2026-08-23 |
| D6 | 自动标题竞态 MVP 不根治：首回合生成完成前手动改名会被自动标题覆盖（可再次改名自愈）；根治需 `is_title_manual` 列迁移，记 out of scope | 推荐，随终审确认 |

## Requirements

- **R1 重命名命令**：新增 `rename_conversation`；请求 `{ conversation_id, title }`；校验 id（同 archive 的 `validate_id`）+ title（复用 `validate_title`：trim 非空、≤200 字符，非法 → `invalid_input`）；会话不存在 → `not_found`；返回更新后的 Conversation DTO。不触碰 `updated_at`（不打乱侧栏排序）。
- **R2 删除命令**：新增 `delete_conversation`；请求 `{ conversation_id }`；硬删除 conversations 行及其全部 nodes，单事务内完成（含 `nodes_reject_delete` trigger 的 DROP/重建，方案见 design.md）；会话不存在 → `not_found`；返回轻量确认 DTO。事务完成后 trigger 保护必须仍然完整（直接 DELETE nodes 依旧被拒）。
- **R3 取消归档命令**：新增 `unarchive_conversation`；请求 `{ conversation_id }`；SQL/错误语义与 archive_conversation 严格对称（`SET is_archived = 0 WHERE is_archived = 1`；rows_affected==0 时重查，行存在则原样返回、不存在 → `not_found`）；返回 Conversation DTO。
- **R4 侧栏操作菜单**：会话行 hover 浮现「…」按钮（沿用 group-hover 模式）→ DropdownMenu：
  - 未归档行：重命名 / 归档 / 分隔线 / 删除（destructive 样式）
  - 已归档行：重命名 / 取消归档 / 分隔线 / 删除（destructive 样式）

  键盘可达，aria-label 走 i18n。原归档单按钮移除。归档保持现有确认框（会中断生成）；取消归档菜单直达、无确认框。
- **R5 重命名 Dialog**：预填当前标题；前端即时校验（非空 trim、≤200，非法时禁用保存并提示）；确认后调命令；成功后当前会话标题与 history 摘要双通道更新；命令错误按既有错误展示契约显示本地化文案。
- **R6 删除确认与落点**：AlertDialog 确认（含不可恢复警示；该会话生成运行中时提示会中断）；确认后若该会话有活跃 run 先取消（同归档链路）；删除当前会话 → 直接回到空状态（无选中会话，等价于应用初始「新对话」态；全局会话状态重置，history 保留剩余摘要，无剩余则 history 空态）；删除非当前会话 → 仅从列表移除；run 记录同步清理。
- **R7 取消归档前端行为**：非当前会话 = 仅更新 history 摘要 `isArchived:false`（错误走 history 通道）；当前会话 = 清除只读态（`isArchived:false`）+ 摘要同步，恢复可编辑。不涉及 run 处理（归档时已清理）、不改变当前选中与排序。
- **R8 契约与 i18n 同步**：命令名 9→12（冻结断言、client.test 计数文案同步）、契约夹具（command_names/requests/successes）、双端 zod/DTO schema、mock IPC 样例、zh-CN/en 词典同步新增；不新增错误码。

## Acceptance Criteria

- [ ] AC1 重命名生效且持久：改名后侧栏摘要与当前会话标题即时更新，重启应用后仍为新标题；重命名不改变会话在侧栏的排序位置。
- [ ] AC2 重命名校验：空白/超 200 字符标题被拒（前端禁用保存 + 后端 `invalid_input` 双保险）；错误显示本地化文案；不存在的会话 → `not_found`。
- [ ] AC3 删除生效且持久：确认后会话从侧栏消失，重启后不存在；conversations 与 nodes 行均被删除（DB 级验证）。
- [ ] AC4 trigger 保护完整：删除事务完成后，对 nodes 的直接 DELETE 仍被 `nodes_reject_delete` ABORT（tree_persistence 级测试）。
- [ ] AC5 落点与运行中会话：删除当前会话后回到空状态（无选中会话，不自动切换到其他会话；剩余项仍在侧栏列表，全空时 history 空态）；删除正在生成的会话时 run 先被取消、无残留 run 记录；删除非当前会话仅移除列表项。
- [ ] AC6 取消归档：已归档行菜单出现「取消归档」且点击直达（无确认框）；取消归档后 Badge 消失、当前会话恢复可编辑、重启后仍为未归档；对已是未归档状态的会话调用后端命令无副作用（幂等）；不存在的会话 → `not_found`。
- [ ] AC7 入口完整：未归档行菜单 = 重命名/归档/删除；已归档行菜单 = 重命名/取消归档/删除；菜单与对话框键盘可达；i18n 双语无缺键。
- [ ] AC8 质量门：`cargo test`、`cargo clippy -D warnings`、`pnpm check` 全绿；契约夹具双端往返测试覆盖三个新命令；无新增错误码。

## Out of Scope

- 回收站 / 软删除 / 恢复已删除会话。
- 批量操作（多选删除等）。
- 自动标题覆盖竞态的根治（`is_title_manual` 之类标记迁移）——已知限制见 D6。
- 侧栏整体迁移到 shadcn 官方 Sidebar 组件（独立待办）。

## Artifacts

- `research/codebase-survey.md` — 代码事实全集（file:line 锚点）。
- `design.md` — 技术设计（DTO/SQL/trigger 方案/前端流程/测试矩阵）。
- `implement.md` — 执行清单与验证命令。
