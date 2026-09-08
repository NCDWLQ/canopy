# 技术设计：标题生成仅用首条用户提示词并异步执行

## 现状（代码调研摘要）

- 触发点：`src-tauri/src/generation/commands.rs` ~199–204，`generate_from_active_path` 返回 `Completed` 后调用 `spawn_auto_title` —— 与回复**串行**。
- 上下文门控：`conversations/service.rs` `load_auto_title_context`（~381–410）要求**恰好一条** assistant 节点，返回首条 user + 该 assistant。
- 提示词：`generation/title_prompt.rs`，system 指令以“assistant 为辅助上下文”为前提；user 载荷为 `<conversation><user>…</user><assistant>…</assistant></conversation>`，各截断 2000 字符并转义。
- 执行：`generation/title.rs` `tauri::async_runtime::spawn` fire-and-forget，独立 `CancellationToken`，不经 `GenerationRuntime`；模型解析顺序：设置绑定 → 会话绑定 → 活动 provider。
- 落库与通知：`update_title`（不 bump `updated_at`）+ 全局事件 `conversation://title-updated`；前端 `applyTitleUpdate` 就地更新。
- 占位标题：前端 `deriveConversationTitle.ts`（40 字符截断），创建会话时写入。

## 变更总览

| 组件 | 文件 | 变更 |
|---|---|---|
| 触发点 | `generation/commands.rs` | 从 post-`Completed` 前移到生成启动处（prepare 成功、首条 user 节点已入库后），与回复流并行 spawn |
| 上下文 | `conversations/service.rs` | 新增/改造上下文加载：只需首条 user 消息 + 当前标题（占位值），去掉“恰好一条 assistant”门控 |
| 防覆盖 | `conversations/repository.rs` / `service.rs` | `update_title` 增加 CAS 变体：`WHERE title = ?expected`，仅当标题仍是触发时观察到的值才写入 |
| 提示词 | `generation/title_prompt.rs` | 重写 system 指令与 user 载荷：仅 `<user_message>`，无 assistant 块 |
| 编排 | `generation/title.rs` | `spawn_auto_title` 在触发时记录当前标题作为 CAS 期望值；其余（模型解析、HTTP、清洗、emit）不变 |
| 文案 | `src/lib/i18n`（en/zh）、`ConversationSettingsPanel.tsx` | “After the first exchange…” → “When the first message is sent…” 类表述 |
| 规格 | `.trellis/spec/backend/provider-guidelines.md` 等 | 更新 auto-title 契约（触发、上下文、prompt、CAS）；顺带修正其中“binding miss 会 fall through”的过时描述（代码实为硬跳过） |

## 关键设计决策

### D1 触发点：生成启动时，而非会话创建时

在 `generate_from_active_path` 内、prepare 完成之后 spawn。理由：

- 覆盖“已存在但从未发过消息的空会话”场景（创建时触发覆盖不到）；
- 此时首条 user 节点已持久化，且会话的 provider 绑定在 create 流程中先于 `startGeneration` 写入，模型解析无竞态（实现时验证此顺序）；
- 首条回复失败/取消后重试时会再次走到这里 → 配合 D2 的 CAS/占位检查保证只生效一次。

### D2 幂等与防覆盖：占位比较 + CAS 写入

- **触发条件**：会话当前标题等于触发时读取到的值，且该值是“占位标题”（即与首条消息派生的占位一致或尚未被 LLM 标题替换）。简化实现：spawn 时读取当前标题 `t0` 并随任务携带；标题生成完成后执行 `UPDATE conversations SET title = ?new WHERE id = ?id AND title = ?t0`，影响行数为 0 则丢弃结果不发事件。
- 这同时解决两个问题：用户手动改名不被覆盖；回复失败重试/重复触发只生效一次（第一次成功后标题 ≠ `t0`）。
- 备选方案（不采纳）：新增 `auto_titled_at` 列。需要 migration，且仍解决不了手动改名竞态，CAS 已足够。

### D3 提示词改写（R4）

参照调研共识（OpenHands / multica / claude-live-title）：

- system：明确“根据用户的首条消息生成简短标题”；规则包括：只输出标题文本、无引号/无前缀（如 `Title:`/`标题:`）/无解释、长度上限（沿用 `MAX_TITLE_CHARS=200` 的解析上限，提示词层面要求 ≤50 字符左右）、**使用用户消息的语言**、消息被截断时基于可见内容。
- user 载荷：`<user_message>\n…\n</user_message>`，保留现有转义与 2000 字符截断。
- 保留 `clean_title` 后处理与 `max_tokens=256`、低推理档位——与主流一致，无需改 LLM 适配层。

### D4 并发与生命周期

- 标题 HTTP 继续绕开 `GenerationRuntime` 与 generation Channel（规格要求），使用独立 `CancellationToken`；回复取消不取消标题（输入不依赖回复，符合 R7）。
- 与同一 provider 可能出现两个并发请求（回复 + 标题），主流产品同样如此，无需串行化。
- 事件 `conversation://title-updated` 可能在回复流式中途到达；前端 `applyTitleUpdate` 只 patch 标题、不触碰节点/生成状态，现有实现已安全。

### D5 失败语义

标题任务任何一步失败：记 `log::warn!`（沿用现有 `title_generation_skipped` 风格），不重试、不通知前端。占位标题保留，体验与今天失败时一致。

## 数据流（变更后）

```
用户发送首条消息
  → createConversation（占位标题入库）
  → startGeneration → prepare（user 节点入库）
      ├─ spawn_auto_title（读取 t0 标题；load 首条 user；prompt；HTTP；CAS 写入；emit 事件）
      └─ 回复流式生成（并行，互不等待）
  → 前端在流式中途收到 title-updated → 就地替换占位标题
```

## 兼容与回滚

- 无 schema migration；事件协议形状不变；设置键不变。
- 回滚 = revert 本分支提交即可，无数据迁移风险。

## 实现时需验证的假设

1. create 流程中 provider 绑定写入早于 `startGeneration`（否则标题模型解析可能落到活动 provider）——读 `useWorkspaceGenerationController.createConversation` 确认。
2. “占位标题”判定不依赖前端派生函数在后端重实现：CAS 用 `t0` 现值即可，无需后端知道占位算法。
3. 手动改名路径（rename）与 CAS 的交互：rename 直写新标题，CAS 的 `WHERE title = t0` 自然失效，无额外改动。
