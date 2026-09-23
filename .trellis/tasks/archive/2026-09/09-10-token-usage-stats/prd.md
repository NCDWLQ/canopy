# token用量统计功能

## Goal

为 Canopy（本地优先 Tauri 桌面聊天应用）增加 LLM token 用量统计：从流式响应捕获 usage、持久化到独立表，并在设置页提供聚合视图，让用户了解自己的 token 消耗。

## Background / Confirmed Facts

- 栈：React 19 + TS（`src/`），Rust + Tauri 2（`src-tauri/`），SQLite（`src-tauri/migrations/0001`–`0008`，注册于 `src-tauri/src/infra/database.rs` L21–62）。
- LLM 流量全部走 Rust 流式 HTTP，协议：`openai_compatible`（`src-tauri/src/llm/adapters/openai_compatible.rs`）与 `anthropic`（`src-tauri/src/llm/adapters/anthropic.rs`），调度点 `src-tauri/src/generation/service.rs` L165–174。
- 当前完全丢弃 usage：OpenAI 适配器无 `stream_options.include_usage` 且 `StreamChunk` 无 usage 字段（openai_compatible.rs L240–246）；Anthropic 适配器忽略 `message_start`/`message_delta` 的 usage（anthropic.rs L157–261）；`GeneratedContent` 仅 content+thinking（`src-tauri/src/llm/domain.rs` L87–91）。
- 落库点：`finish_generation`（service.rs ~L219–241）；nodes 表有不可变历史触发器（`0002_conversation_tree.sql` L62–74）。
- 标题生成是第二个 token 来源：`src-tauri/src/generation/title.rs` ~L73–77。
- 前端无仪表盘；Settings 是对话框，分类 `general|appearance|providers|conversation|archived`（`src/features/settings/components/SettingsDialog.tsx` L44–45, L162–191）。
- 全库无任何 token/usage/cost 追踪。

## Requirements

- R1（捕获）：OpenAI 兼容协议通过 `stream_options.include_usage` 获取终帧 usage；Anthropic 协议从 `message_start`/`message_delta` 提取 usage。provider 不返回时优雅降级（usage 为空，不影响生成）。
- R2（持久化）：新建 `usage_records` 表（迁移 0009），记录 conversation_id、node_id、source（chat|title）、provider_id、model、input/output/total tokens、created_at；仅在有 usage 数据时写入；写入失败不阻断生成主流程。
- R3（覆盖范围）：聊天生成（含重新生成）和标题自动生成都纳入统计。
- R4（IPC）：`get_usage_summary` 返回总计、按日（本地时区）、按模型×Provider、按来源的聚合；`clear_usage_records` 清空统计。
- R5（UI）：SettingsDialog 新增「用量」分类：汇总卡片（总 token/输入÷输出/今日 token/近 7 日 token）、来源拆分（聊天回复/标题生成的 token、记录数、占比）、GitHub 风格按日热度图（近一年滚动，Tailwind 网格实现，hover tooltip 显示日期+当日 token）、明细 tabs（按模型×Provider / 按日近 30 天）、刷新与清除按钮；无数据时显示空态；不新增图表库依赖。生成记录数只出现在明细表，不占汇总卡位。

## Acceptance Criteria

- [ ] AC1：用 OpenAI 兼容 provider 完成一次聊天生成后，`usage_records` 出现一行 source='chat' 且 token 数 >0 的记录（provider 支持 include_usage 时）。
- [ ] AC2：用 Anthropic provider 完成一次聊天生成后，同样产生正确记录。
- [ ] AC3：触发自动标题生成后，产生一行 source='title' 的记录。
- [ ] AC4：provider 不返回 usage 时生成流程正常完成，无报错、无 0 值记录。
- [ ] AC5：设置页「用量」分类展示总计、按来源、按日、按模型聚合，与 `usage_records` 表数据一致；计数字段统一呈现为生成记录数/记录数。
- [ ] AC6：热度图渲染近一年按日数据，单元格色阶随当日 token 数变化，hover 显示日期与数值；暗色模式下配色正常。
- [ ] AC7：「清除数据」按钮清空统计且 UI 回到空态。
- [ ] AC8：适配器 usage 解析与聚合查询有确定性单元测试（fixture SSE 流 + 显式时间戳）；既有迁移 fixture 升级测试（v0.4.0 库前向升级）在加入 0009 后仍通过。
- [ ] AC9：`cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings` 与 `pnpm check` 全绿。

## Out of Scope

- 成本估算 / 价格表维护
- 逐条消息的 token 展示（`node_id` 字段已保留，未来可扩展）
- 图表库类可视化（折线/柱状/饼图等；按日热度图为 MVP 内既定范围，不属此类）
- 配额、告警、导出

## Key Decisions

- 独立 `usage_records` 表而非 nodes.metadata：nodes 不可变触发器 + 聚合查询不应扫节点表 + title 生成无节点可挂。
- 统计范围 = 设置页聚合（用户选定）；标题生成纳入（用户选定）；不做成本估算（用户选定）。
- 聚合在 SQL 层按 `date(created_at,'localtime')` 完成。

## Risks / Deferred

- 部分 OpenAI 兼容 provider 忽略 `include_usage` → 该 provider 无统计数据（可接受，降级而非报错）。
- 严格校验请求体的 provider 可能对未知字段 `stream_options` 返回 400 → 需实现"400 且报错提及 stream_options 时去掉该字段重试一次"的兜底（见 design.md）。
- 流中断/取消时 usage 可能缺失或不完整 → 以最终成功落库的记录为准。
- Anthropic 的 cache 相关 token（cache_read/cache_creation）不单独统计，仅计入 input/output（如 provider 报告）。
