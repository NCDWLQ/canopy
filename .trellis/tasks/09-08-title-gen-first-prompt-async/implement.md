# 执行计划：标题生成仅用首条用户提示词并异步执行

> 前置：`prd.md`、`design.md`、`research/title-generation-practices.md` 已经评审。实现阶段通过 `trellis-implement` 子代理执行，检查通过 `trellis-check`。

## 实施顺序

### 1. 后端：上下文与 CAS 写入

- [ ] `conversations/repository.rs`：新增 `update_title_if_current(id, expected, new) -> Result<bool>`（`UPDATE ... WHERE title = ?expected`，返回影响行数 > 0）。
- [ ] `conversations/service.rs`：改造/新增标题上下文加载——返回首条 user 消息内容 + 会话当前标题 + provider/model 绑定；**移除**“恰好一条 assistant”门控；保留无 user 时返回 `None`。
- [ ] `service.rs` 暴露 CAS 版 `update_title_if_current`。

验证：`cargo test -p <backend>` 中 conversations 相关测试。

### 2. 后端：提示词改写

- [ ] `generation/title_prompt.rs`：`build_title_prompt(user)` 单参；重写 `TITLE_SYSTEM_INSTRUCTION`（仅标题、无引号/前缀/解释、≤50 字符、跟随用户语言、容忍截断输入）；user 载荷改为 `<user_message>` 包裹；保留转义与 2000 字符截断。
- [ ] 更新 `title_prompt.rs` 内单元测试（不含 assistant、转义、截断）。

### 3. 后端：编排与触发前移

- [ ] `generation/title.rs`：`spawn_auto_title` 在 spawn 前读取当前标题作为 `expected`；生成成功后走 CAS 写入，失败（影响行数 0）记日志且不 emit 事件。
- [ ] `generation/commands.rs`：触发点从 post-`Completed` 前移到 prepare 成功之后、流式开始之前（与回复并行）；`Completed` 分支不再 spawn。
- [ ] 更新 `title.rs` 测试：并行触发、CAS 防手动改名覆盖、重试不重复标题、配置绑定缺失仍硬跳过。

验证：`cargo test`（generation + conversations）。

### 4. 前端：文案

- [ ] i18n（en/zh）`autoGenerateTitleDescription` 改为“首条消息发送时…”表述；确认 `ConversationSettingsPanel.tsx` 无需结构改动。
- [ ] 如存在文案快照测试，一并更新。

### 5. 规格同步（Phase 3 由 trellis-update-spec 完成，此处列出范围）

- [ ] `.trellis/spec/backend/provider-guidelines.md`：auto-title 触发时机、上下文（仅首条 user）、prompt 形状、CAS 语义；修正“binding miss fall through”过时描述为硬跳过。
- [ ] `.trellis/spec/backend/database-guidelines.md`：`update_title_if_current` CAS 行为。
- [ ] `.trellis/spec/frontend/state-management.md` / `type-safety.md`：事件中途到达的说明（协议不变）。
- [ ] `.trellis/spec/guides/cross-layer-thinking-guide.md`：并行触发 + CAS 防覆盖条目。

## 验证命令

```bash
# 后端
cd src-tauri && cargo fmt --check && cargo clippy --all-targets && cargo test
# 前端
pnpm lint && pnpm type-check && pnpm test
```

## 评审门

1. 步骤 1–3 完成后跑 `trellis-check`（全量：spec 合规、lint、type-check、测试、跨层数据流）。
2. 人工确认 AC1–AC8 后进入 Phase 3（spec 更新 + 提交）。

## 回滚点

- 每个步骤独立提交可行；整体回滚 = revert 分支，无 migration。
