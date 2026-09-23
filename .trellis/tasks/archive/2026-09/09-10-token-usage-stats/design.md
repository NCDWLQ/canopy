# Token 用量统计 — 技术设计

## 架构与边界

新增 `usage` 后端模块（owns：usage_records 表、聚合查询），遵循 `.trellis/spec/backend/index.md` 的模块归属约定。数据流：

```
[SSE adapters] openai_compatible.rs / anthropic.rs
  → 解析 usage → GeneratedContent.usage: Option<TokenUsage>
[generation] service.rs finish_generation / title.rs
  → usage::repository::insert_usage_record
[IPC] get_usage_summary / clear_usage_records → Zod client
[UI] SettingsDialog 新增 usage 分类 + UsagePanel
```

## 数据捕获（providers 层）

- `llm/domain.rs`：新增 `TokenUsage { input_tokens: u64, output_tokens: u64, total_tokens: Option<u64> }`；`GeneratedContent` 增加 `usage: Option<TokenUsage>`。
- **OpenAI 兼容**：请求体加 `stream_options: { include_usage: true }`——注意现有代码有两处请求构造（`build_request` 与 `build_title_request`，openai_compatible.rs L114/L134），统一在 `ChatCompletionRequest` 结构体上加字段即可同时覆盖。SSE 流末尾的 usage chunk（`choices` 为空的终帧）解析出 `prompt_tokens` / `completion_tokens` / `total_tokens`。
  - **降级一（静默忽略）**：provider 不支持该参数时通常直接不返回 usage → usage 保持 `None`，不报错。
  - **降级二（严格校验 400）**：少数 provider 对未知字段返回 400。当响应为 400 且错误文本提及 `stream_options` 时，去掉该字段重试一次；仍失败才走既有错误路径。重试逻辑收在 `stream_chat_completion` 内，不扩散到调用方。
- **Anthropic**：取值规则明确为——`message_start` 事件的 `message.usage.input_tokens` 为输入终值；`message_delta` 事件的 `usage.output_tokens` 为累计值，**取最后一次出现覆盖**（不累加）。注意现有 `message_delta` 分支对未知 `stop_reason` 返回 Protocol 错误（anthropic.rs L237–244），usage 解析不得改变该控制流。
- 两个适配器的 `stream_title` 路径同样带出 usage（OpenAI 侧共享 `stream_chat_completion`，Anthropic 侧共享 `stream_body`，单点改动即可覆盖）。

## 持久化（infra + usage 模块）

新迁移 `0009_token_usage.sql`（注册进 `MIGRATION_CATALOG`）：

```sql
CREATE TABLE usage_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,              -- 标题生成也归属会话；无 FK（决策见下）
  node_id       TEXT,                -- chat 生成的 assistant 节点；title 生成为 NULL
  source        TEXT NOT NULL,       -- 'chat' | 'title'
  provider_id   TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens  INTEGER,             -- provider 报告值；缺省时 = input+output
  created_at    TEXT NOT NULL        -- RFC3339 UTC
);
CREATE INDEX idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX idx_usage_records_provider_model ON usage_records(provider_id, model);
```

关键决策：

- **独立表而非 nodes.metadata**：nodes 有不可变历史触发器（0002 L62–74）；聚合查询不应扫描全部节点；title 生成没有 assistant 节点可挂。
- **不加外键**：现有表（conversations/nodes）id 均为 TEXT 且带 FK，但 `usage_records` 有意不建 FK——删除会话后用量统计应保留（统计是账户级事实，不随对话生命周期）；这点与 0002 的 FK 风格不同，是有意为之。
- **仅在有 usage 数据时写入记录**：provider 不返回 usage 时跳过插入，避免误导性的 0。
- 写入失败不阻断生成主流程（log warn，遵循 error-handling / logging spec）。

## IPC 契约

新增命令（注册进 `lib.rs`，Zod schema 放 `src/lib/tauri/`，补 contract-fixtures）：

- `get_usage_summary()` → 无参数（窗口固定，简化契约）：
  - `totals`: { input, output, total, records }（全时段；records 表示生成记录数，不命名为 requests，避免与 HTTP 请求次数混淆）
  - `by_day`: [{ day(本地日期), input, output, total, records }]（SQL `date(created_at,'localtime')`，固定返回近 371 天；热度图用全年，按日表格前端截取近 30 天）
  - `by_model`: [{ provider_id, model, input, output, total, records }]（total 降序）
  - `by_source`: [{ source, input, output, total, records }]（source 取 `chat` / `title`；用于 UI 展示聊天回复与标题生成占比）
- `clear_usage_records()` → 清空统计（设置页"清除数据"按钮）

## 前端

- `SettingsDialog.tsx` 分类列表加 `usage`；面板组件放 `src/features/settings/components/UsagePanel.tsx`（遵循 frontend directory-structure；不新建 feature 目录，避免过度拆分）。
- 展示：顶部汇总卡片（总 token / 输入÷输出 / 今日 token / 近 7 日 token）+ 来源拆分（聊天回复 / 标题生成）+ GitHub 风格每日热度图 + 明细 tabs（按模型×Provider / 按日近 30 天）。**不引入图表库**（MVP 用表格 + Tailwind 简单条形），不新增依赖。生成记录数留在明细表。
- 面板打开时拉取一次；提供刷新按钮。

### 用量热度图（GitHub 风格）

- **形态**：近一年滚动的日历热度图，列=周、行=星期（同 GitHub contributions），单元格颜色深浅对应当日 total tokens。
- **实现**：纯 Tailwind 网格（`grid grid-rows-7 grid-flow-col`），不引入图表库。色阶 5 档：0 为空底色，其余按当日值占近一年最大单日值的比例分 4 档（相对分档，避免绝对阈值过期）。
- **交互**：hover tooltip 显示「日期 + 当日 token 数」（复用现有 tooltip/sonner 模式）；MVP 不做点击下钻。
- **数据**：复用 `by_day` 聚合，IPC 固定返回近 371 天（53 周整列对齐；热度图用全年，按日表格前端截取近 30 天）。
- **配色**：跟随当前主题色（`--primary` 的透明度梯度），暗色模式自然适配；空态（无任何记录）时整个面板显示空态文案，不渲染空热度图。

### 布局线框

样式全部复用 SettingsDialog 现有模式（shadcn 卡片/表格、Tailwind 间距），无新视觉语言。

```
┌ 设置 · 用量 ────────────────────────────────────────┐
│                                          [刷新]     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
│ │ 总 Token  │ │ 输入 / 输出        │ │ 今日 Token │ │ 近 7 日 Token ││
│ │ 128,450  │ │ 85,300 / 43,100   │ │  12,300    │ │  45,200      ││
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘│
│                                                     │
│ 按来源                                              │
│ ┌──────────────────────┐ ┌──────────────────────┐  │
│ │ 聊天回复       126.7k │ │ 标题生成         1.8k │  │
│ │ 记录数 324     98.6% │ │ 记录数 18       1.4% │  │
│ └──────────────────────┘ └──────────────────────┘  │
│                                                     │
│ 每日用量（近一年）                                    │
│ ┌─────────────────────────────────────────────┐    │
│ │ □□□■■□□□…（7 行 × 53 列热度图，hover 出 tooltip）│    │
│ │ ■□□▪■□▪□□…                                   │    │
│ └─────────────────────────────────────────────┘    │
│                                                     │
│ 明细                                  [按模型][按日] │
│ 按模型                                              │
│ ┌────────────┬──────────┬───────┬───────┬───────┐  │
│ │ Provider   │ Model    │ Input │Output │ Total │记录│
│ ├────────────┼──────────┼───────┼───────┼───────┤  │
│ │ openai     │ gpt-5    │ 80.2k │ 40.1k │120.3k │300 │
│ │ anthropic  │ claude-… │  5.1k │  3.0k │  8.1k │ 42 │
│ └────────────┴──────────┴───────┴───────┴───────┘  │
│                                                     │
│ 按日（近 30 天）                                     │
│ ┌────────────┬───────┬───────┬───────┬──────────┐  │
│ │ 日期       │ Input │Output │ Total │ 记录数   │  │
│ ├────────────┼───────┼───────┼───────┼──────────┤  │
│ │ 2026-09-10 │ 10.1k │  2.2k │ 12.3k │    18    │  │
│ └────────────┴───────┴───────┴───────┴──────────┘  │
│                                                     │
│ ──────────────────────────────────────────────────  │
│ 危险区                                    [清除统计数据] │
└─────────────────────────────────────────────────────┘
```

- **汇总卡片**：4 张等宽小卡片（总 token / 输入÷输出 / 今日 token / 近 7 日 token），数字用 `Intl.NumberFormat` 千分位；大数值表格内缩写为 k/M。生成记录数不占卡位。
- **来源拆分**：显示聊天回复与标题生成的 total、records、占比；用于解释自动标题带来的额外 token 消耗。
- **明细 tabs**：按模型与按日只显示一个表，降低设置页纵向拥挤度；默认按模型。
- **按模型表**：Provider / Model / Input / Output / Total / 记录数，按 total 降序。
- **按日表**：日期（本地）/ Input / Output / Total / 记录数，日期降序，最多展示近 30 天。
- **空态**：无记录时整个面板显示「暂无用量数据」说明文案（不出现 0 值卡片）。
- **清除按钮**：放面板底部危险区，二次确认（复用现有确认交互模式），成功后回空态。
- **加载态**：拉取中卡片/表格显示 skeleton 或禁用刷新按钮（跟随设置页现有加载模式）。

## 兼容性与回滚

- 迁移纯增量，老库自动升级；失败遵循 database-guidelines 处理。
- usage 缺失时 UI 显示"暂无数据"而非 0。
- 回滚：删除 IPC/前端代码 + 迁移只增不改，表可保留。

## 权衡

- 不估算成本（用户已决策）：避免维护价格表。
- 按日聚合在 SQL 层做（`localtime`），前端不做时区换算。
- 逐条消息展示不在 MVP 内，但 `node_id` 字段已保留，未来可扩展。
