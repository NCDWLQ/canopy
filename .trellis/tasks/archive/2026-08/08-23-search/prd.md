# Conversation search（会话全文搜索）

## Goal

用户可以按关键词检索全部会话的消息内容与会话标题，在搜索弹窗中按会话分组浏览命中片段，点击结果切到命中消息所在分支、滚动定位到该消息并高亮匹配文本——解决"找不回某段对话"的问题。

## Background（调研事实，锚点见 research/codebase-survey.md）

- 存储：sqlx + SQLite；`nodes.content`（≤1MiB/条）、`conversations.title`（≤200 字符）无索引无 FTS；单用户桌面体量，无分页全量是现状。
- 消息为树节点，面板只渲染 active path（一条 root→active 路径）；`selectActivePath` 可切换路径；面板现有唯一滚动机制是自动滚底；无单消息锚点/高亮。
- IPC 为冻结契约：新增命令须五处同组变更（commands.rs / error.rs / contract-fixtures/conversation-ipc.json / src/lib/tauri/ / 前端 types）；错误码为闭合枚举；i18n 双语词典。
- bundled SQLite 已编译启用 FTS5，但 unicode61 分词不适合中文。

## Decisions（用户已确认）

- **D1 范围与形态**：全文搜索（消息内容 + 标题）+ 搜索弹窗；子串匹配路线（非 FTS）。
- **D2 归档会话**：纳入搜索，结果中带"已归档"标记（与侧栏一致）。
- **D3 入口**：仅侧栏搜索按钮；不加全局快捷键。
- **D4 跳转行为**：切到命中消息的分支（视图含命中及其后续回复）、滚动定位到命中消息、高亮匹配文本。
- **D5 高亮与滚动精化（2026-08-23 GUI 反馈）**：命中消息整体不做气泡特效（无背景/描边环）；仅高亮被点击的那次匹配（后端 snippet 锚定的首个匹配），同消息内其余匹配不高亮；跳转时侧栏历史列表同步滚动到该会话行（block:"nearest"）。

## Requirements

- **R1 搜索命令**：新增 `search_conversations` IPC 命令；请求 `{ query }`（trim 非空、≤200 字符，否则 `invalid_input`）；子串匹配大小写不敏感（ASCII lower 两侧，CJK 精确子串），LIKE 通配符（`%`/`_`/`\`）按字面处理；匹配范围 = `user`/`assistant` 角色消息内容 + 会话标题；含已归档会话。
- **R2 结果结构**：按会话分组，会话按 `updated_at DESC, id ASC`（与侧栏排序一致，`updated_at` 派生口径同 `list_conversations`）；每会话含标题、归档标记、`title_matched`、消息命中列表（节点 id、角色、时间、上下文 snippet——SQL 内生成，不传输全文）；上限 50 会话 × 每会话 5 条命中。
- **R3 搜索弹窗**：侧栏 Search 按钮打开；输入 300ms 防抖触发；状态 idle/searching/ready(结果|空)/error，错误为弹窗局部状态并按 `commandErrorMessage(code)` 显示文案；结果分组渲染（归档 Badge、纯标题命中时"标题匹配"标记、snippet 内关键词高亮）；键盘可达。
- **R4 定位与高亮**：点击结果 → 打开目标会话（跨会话时完整加载，requestEpoch 防过期）→ 视图切为命中消息所在分支（active = 命中节点子树的确定性最新叶子，命中及其后续回复均可见）→ `scrollIntoView` 居中命中消息 → 命中消息内不区分大小写高亮匹配片段；reveal 状态一次性（下次导航清除）。
- **R5 i18n**：新增 `search.*` 文案 zh-CN/en 双侧添加；不翻译用户内容。
- **R6 契约同步**：命令名列表（9→10）、共享夹具、双端校验 schema、冻结断言测试作为单一变更组交付。

## Acceptance Criteria

- [ ] AC1 输入中/英文关键词，弹窗列出命中会话与片段；大小写不敏感；`%`/`_` 作为字面字符可被搜到。
- [ ] AC2 仅标题命中的会话出现且带"标题匹配"标记（hits 为空）；已归档会话出现且带归档标记。
- [ ] AC3 tool/system 角色内容不产生命中；结果排序与侧栏一致（最近活跃在前）。
- [ ] AC4 点击消息命中：目标会话打开、命中分支完整可见（含后续回复）、命中消息滚入视口居中、匹配片段以高亮样式呈现；再次导航后高亮消失。
- [ ] AC5 空关键词/超长关键词被拒（`invalid_input`）；数据库错误映射为既有码且 UI 显示本地化文案。
- [ ] AC6 `cargo test`、`cargo clippy -D warnings`、`pnpm check` 全绿；契约夹具双端往返测试覆盖新命令；无新增错误码、无迁移、无 capabilities 变更。

## Out of Scope

- FTS5 全文索引与中文分词（数据量不需要；unicode61 不适配中文）。
- 全局快捷键（Cmd/Ctrl+K）、正则/多词组合查询、搜索结果分页、命中数提示/截断指示。
- system/tool 角色内容、正文替换预览以外的高级渲染。

## Artifacts

- `research/codebase-survey.md` — 代码事实全集（file:line 锚点）。
- `design.md` — 技术设计（DTO/SQL/前端流程/测试矩阵/回滚）。
- `implement.md` — 16 步执行清单与验证命令。
