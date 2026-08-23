# Implement: 会话全文搜索

前置：`design.md` 定稿、任务 `in_progress`。全部工作在 worktree `canopy-search`（分支 `feat/search`）。

## 执行顺序（每步可独立验证）

### 后端（Rust）

- [ ] 1. DTO 与校验：`commands.rs` 增 `SearchConversationsRequest`/`ConversationSearchResultDto`/`SearchHitDto` + query 校验单测（空/空白/超长 → `invalid_input`）。
- [ ] 2. 仓储 SQL：`repository.rs::search_conversations`（LIKE 转义、lower 双侧、SQL 内 snippet、角色过滤、50 会话×5 命中上限、updated_at DESC 排序）。
- [ ] 3. 服务层：`service.rs` 事务封装 + 错误映射（复用闭合枚举，不新增码）。
- [ ] 4. 命令注册：`commands.rs` 命令名列表 9→10（更新冻结断言）+ `#[tauri::command]` 薄封装 + `lib.rs` 注册。
- [ ] 5. 契约夹具：`contract-fixtures/conversation-ipc.json` 增补（command_names/requests/successes/errors，含 CJK 与纯标题命中样例）。
- [ ] 6. Rust 集成测试：`command_boundary.rs` 往返断言；新 `tests/search.rs`（迁移库种子：多分支/CJK/大小写/转义/归档/角色排除/上限/排序）。

验证：`cargo test`（全绿）、`cargo clippy --all-targets -- -D warnings`；`cargo fmt` 仅对本次触碰文件保持干净（main 存在历史 fmt 漂移，勿全局格式化）。

### 前端（TS/React）

- [ ] 7. IPC 层：`schemas.ts` zod schema → `client.ts` 命令与方法 → `types/index.ts` view 类型与映射；TS 契约测试同步夹具。
- [ ] 8. store：纯函数 `newestLeafDescendant` + `reveal` 状态 + `revealSearchHit` 动作（复用 `loadSelectedConversation`，epoch 防过期；导航即清除 reveal）；`store.test.ts` 用例。
- [ ] 9. 高亮工具 `highlightText`（React 文本节点递归包裹 `<mark>`，fail-open）+ 单测。
- [ ] 10. `SearchDialog.tsx`（shadcn Dialog、300ms 防抖、queryEpoch、局部错误态、分组结果、归档 Badge、标题匹配标记、键盘可达）+ 组件测试。
- [ ] 11. 侧栏入口：`ConversationWorkspace.tsx` aside 头部 Search 按钮（aria-label i18n）。
- [ ] 12. 面板定位：`MessageNode` `data-node-id` 锚点 + `ConversationPane` reveal 时 `scrollIntoView(center)` + 命中消息高亮；`ConversationPane.test.tsx` 增用例。
- [ ] 13. i18n：`zh-CN.ts` 增 `search.*` 键，`en.ts` 同步；不翻译用户内容。

验证：`pnpm check`（format+lint+typecheck+test+build 全绿）。

### 收尾

- [ ] 14. 跨层复查：guides 跨层清单（新增 RPC payload 触发项）逐条核对；`trellis-check` 全量质量检查（用户规则：提交前必须自跑，不以子代理结果为准）。
- [ ] 15. GUI 手动验收（用户侧）：真实数据搜索中文/英文、点击跳转+定位+高亮、归档会话、空态/错误态。
- [ ] 16. spec 沉淀（如有新约定）→ commit → PR 到 main。

## 风险文件与回滚点

- 触碰冻结契约的文件（`commands.rs` 命令表、`conversation-ipc.json`、`schemas.ts`）是最大风险面：步骤 1–7 必须原子成组提交（单一 commit），避免中间态破坏双端契约测试。
- `ConversationWorkspace.tsx`/`ConversationPane.tsx`/`store/index.ts` 为共享热区，改动保持最小侵入；store 新逻辑尽量放独立纯函数模块。
- 回滚：单分支单 PR，revert 即净；无迁移、无 capabilities 变更。

## task.py start 前检查

- [ ] prd.md 收敛完毕（无阻塞 Open Questions）
- [ ] design.md / implement.md 就绪
- [ ] implement.jsonl / check.jsonl 已含真实条目（非 `_example`）
- [ ] 用户已明确批准最终规划摘要
