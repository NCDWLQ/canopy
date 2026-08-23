# Design: 会话全文搜索（search_conversations）

依据：`prd.md`（决策 D1–D4）、`research/codebase-survey.md`（全部 file:line 证据）。

## 1. 总体架构

只读特性，零 schema 迁移。新增 1 个 Tauri 命令 `search_conversations`（conversation 命令从 9 → 10），前端新增侧栏搜索按钮 + `SearchDialog` 弹窗 + store 定位动作 + 面板滚动/高亮渲染。数据流：

```
SearchDialog (输入, 300ms 防抖)
  → client.searchConversations(query)            [src/lib/tauri, zod 双校验]
  → invoke("search_conversations", { request })  [严格 snake_case DTO]
  → ConversationCommandService::search_conversations   [校验 + 事务 + 错误映射]
  → repository::search_conversations             [参数化 SQL, LIKE 子串, SQL 内截 snippet]
  → Vec<ConversationSearchResultDto>
  → SearchDialog 按会话分组渲染（标题/归档 Badge/命中片段）
点击结果
  → store.revealSearchHit(client, conversationId, nodeId, query)
     → (跨会话时) loadSelectedConversation 复用（requestEpoch 防过期）
     → newestLeafDescendant(nodeId)（纯函数，镜像 loadedTreeState 的确定性最新叶子算法）
     → selectActivePath(该叶子)  ⇒ 视图= root→…→命中→…→最新回复（命中分支完整可见）
     → store.reveal = { nodeId, query }
  → ConversationPane 渲染后 scrollIntoView(命中节点锚点) + 命中消息内 <mark> 高亮
```

## 2. 后端

### 2.1 DTO（commands.rs，serde snake_case + deny_unknown_fields）

```rust
SearchConversationsRequest { query: String }        // trim 后非空且 ≤200 字符，否则 invalid_input（details.field="query"）
ConversationSearchResultDto {
    conversation_id, title, is_archived, title_matched: bool,
    updated_at: i64,                                 // MAX(nodes.created_at) 派生，与 list_conversations 一致
    hits: Vec<SearchHitDto>,                         // 可为空（纯标题命中）
}
SearchHitDto { node_id, role, created_at, snippet }  // snippet 为单行化纯文本
```

不返回全文（内容单条 ≤1MiB），snippet 在 SQL 内 `substr` 生成。

### 2.2 SQL（repository.rs，参数化，转义 `%`/`_`/`\` 后 `LIKE … ESCAPE '\'`，ASCII 大小写不敏感用 `lower()` 双侧；CJK 精确子串天然成立）

- 消息命中（单条）：
  ```sql
  SELECT n.conversation_id, n.id AS node_id, n.role, n.created_at,
         instr(lower(n.content), lower(?1)) AS pos,   -- 首次命中位置
         substr(n.content, max(1, pos-30), length(?1)+90) AS snippet
  FROM nodes n
  WHERE n.role IN ('user','assistant')
    AND length(?1) <= length(n.content)
    AND lower(n.content) LIKE ?2 ESCAPE '\'
  ORDER BY n.conversation_id, n.created_at ASC, n.id ASC
  ```
  说明：`instr` 大小写敏感不一致问题实现时以同一 lower 形式计算；snippet 上下文 30/90 为设计默认。排除 `system`/`tool` 角色（工具 JSON 噪声；后续可配置扩展）。
- 会话级：标题命中集 ∪ 消息命中所属会话集；每会话 `updated_at` 复用 list_conversations 的 `MAX(n.created_at)` 派生；会话按 `updated_at DESC, id ASC` 排序（与侧栏一致）；Rust 侧组装分组。
- 上限（桌面单用户体量下的防失控默认）：最多 50 个会话、每会话最多 5 条消息命中；超出丢弃（不指示截断，MVP 简化）。

### 2.3 服务与注册

- `service.rs::search_conversations`：事务包裹只读查询（与 list_conversations 同模式）；错误映射复用闭合枚举——`invalid_input`（空/超长 query）、`database_unavailable`（BUSY/LOCKED）。**不新增错误码**。
- `commands.rs`：`CONVERSATION_COMMAND_NAMES` 增至 10（更新冻结断言测试）；`#[tauri::command]` 薄封装。
- `lib.rs` `register_commands` 加入；capabilities 不变（webview 仍无 SQL 权限）。

### 2.4 契约夹具（共享，双端消费）

`contract-fixtures/conversation-ipc.json` 增补：`command_names`（10 名）、`requests.search_conversations`（含 CJK query 样例）、`successes`（含 snippet/空 hits 纯标题命中样例）、`errors`（invalid_input）。Rust `command_boundary.rs` 与 TS 契约测试同时消费。

## 3. 前端

### 3.1 IPC 层（type-safety.md 场景照搬）

`schemas.ts` 增 request/response zod strict schema；`client.ts` `CONVERSATION_COMMANDS` + `searchConversations()`；DTO→view 映射（`features/conversations/types/index.ts` 增 `ConversationSearchResultView`/`SearchHitView`）。

### 3.2 SearchDialog（features/conversations/components/SearchDialog.tsx，shadcn Dialog）

- 顶部输入框（autofocus、清空按钮）、300ms 防抖、trim 后非空才发请求；模块级 queryEpoch 计数防过期响应（state-management.md:79-81 同款）。
- 状态机：idle / searching / ready(结果|空) / error——错误为弹窗内局部状态，渲染 `commandErrorMessage(code)`，不进全局/history 状态。
- 结果分组渲染：会话标题行（归档 Badge 复用侧栏样式；`title_matched` 且无消息命中时显示"标题匹配"标记）+ 命中片段列表（角色名 + snippet，关键词客户端就地重查找高亮）。每条可点击（键盘可达，Enter 触发）。
- 点击 → `store.revealSearchHit(...)` → 关闭弹窗。

### 3.3 侧栏入口（ConversationWorkspace.tsx aside 头部）

Search 图标按钮（lucide `Search`），aria-label 走 i18n；无全局快捷键（D3）。按钮状态与 `history` 加载态无耦合。

### 3.4 定位与高亮（store + ConversationPane）

- 纯函数 `newestLeafDescendant(nodes, rootId)`：沿子树按 `created_at DESC, id ASC` 选确定性最新叶子（镜像 `store/index.ts:309-323` 的既有算法），放 store 模块内并单测。
- store 新增 `reveal: { conversationId, nodeId, query } | null` 与动作 `revealSearchHit`：跨会话时复用 `loadSelectedConversation`（epoch 防过期、树完整性校验不变），成功后 `selectActivePath(newestLeafDescendant(命中节点))` 并写 `reveal`。`selectConversation`/`selectActivePath` 的既有路径置 `reveal = null`（一次性语义：下次导航即清除）。
- `ConversationPane`：`MessageNode` 包裹元素加 `data-node-id` 锚点；`reveal` 存在且节点在当前 path 时，渲染后 `scrollIntoView({ block: "center" })`（原生 API，不引虚拟化——quality-guidelines.md:16-50 滚动约束不破坏）。
- 高亮工具 `highlightText(children, query)`：递归遍历 React 渲染结果的文本节点，将不区分大小写的命中片段包进 `<mark>`（Tailwind 样式，浅/深色两套）；仅应用于 reveal 命中的那条消息（控制 DOM 成本；markdown 经 AssistantMarkdown 渲染后仍是 React 文本节点，可穿透）。

### 3.5 i18n

zh-CN.ts 增 `search.*` 键（占位、标题、无结果、搜索中、错误兜底、打开按钮 aria、标题匹配标记、角色名如复用现有则不新增），en.ts 同步 `satisfies Dictionary`。snippet/标题/查询词不翻译（i18n-guidelines.md:20）。

## 4. 测试

- Rust 单测（commands.rs 内联）：query 校验（空/空白/超长 → invalid_input + details.field）。
- Rust 集成：
  - `command_boundary.rs`：夹具往返（新命令名、请求、成功、错误）+ 10 名冻结断言。
  - 新 `tests/search.rs`（复用 `migrated_pool()`）：多分支树种子 + CJK 命中 + ASCII 大小写不敏感 + `%`/`_`/`\` 转义 + 归档会话纳入且 `is_archived=true` + `tool`/`system` 角色不命中 + 纯标题命中（hits 空、title_matched）+ 每会话 5 条/总量 50 会话上限 + 排序（updated_at DESC）。
- 前端（Vitest+RTL，props 注入 fake client）：
  - `SearchDialog.test.tsx`：防抖触发、空态/错误态（commandErrorMessage 文案）、归档 Badge、纯标题命中标记、点击结果调用 store 动作并关窗、键盘可达、过期响应丢弃。
  - `store.test.ts`：`revealSearchHit` 跨会话加载+定位叶子、同会话仅切路径、reveal 一次性清除、epoch 过期拒绝。
  - 高亮工具单测：大小写不敏感、多命中、嵌套 React 结构穿透、无命中原样返回。
  - `ConversationPane.test.tsx` 增：reveal 时滚动调用与 mark 渲染、非命中消息不高亮。

## 5. 兼容 / 回滚

- 零迁移、只读 SQL、capabilities 不变；旧库直接可用。
- 回滚 = revert 分支；命令清单回缩即恢复 9 名冻结。
- 风险与缓解：
  - `LIKE` 全表扫描：单用户桌面体量可接受；FTS5（已编译可用）留作未来优化，中文需 trigram/自定义分词——明确不做。
  - markdown 渲染后文本节点结构假设失效 → 高亮工具仅处理字符串子节点，遇未知结构原样返回（fail-open 不抛错）。
  - 1MiB 单条内容的 snippet 均在 SQL 内完成，不整列传输。
