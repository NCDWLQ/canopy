# 执行计划：多 Provider 支持

依赖工件：`prd.md`（需求与验收）、`design.md`（架构与数据模型）。
工作树：`../canopy-multi-provider`（分支 `feat/multi-provider`）。以下路径均相对仓库根；后端命令在 `src-tauri/` 下执行。

## 实施顺序

依赖关系：迁移 → 领域/仓库 → 服务 → 协议 → 生成/命令 → 前端契约 → 前端 UI。每阶段附带验证点，绿的才进下一阶段。

### Phase A：数据层（迁移 + 领域 + 仓库）

- [ ] A1 新增 `src-tauri/migrations/0005_multi_provider.sql`（design §2 全文）并登记 `database.rs` `MIGRATION_CATALOG`。
- [ ] A2 `providers/domain.rs`：`Protocol` enum（DB 文本互转）、`Provider`/`RedactedProvider`/`ProviderInput`、`validate_name`；`ValidatedEndpoint` 改按协议派生 URL（anthropic 的 `/v1` 去重规则），校验规则测试全数保留并新增 anthropic 用例。
- [ ] A3 `providers/repository.rs`：providers 表 CRUD（list/get by id/upsert/delete）、操作日志表带 `provider_id`、`app_settings` get/set/delete。
- [ ] A4 迁移测试：旧 schema 种子（含 pending 操作行 + 带 credential_ref 的 default 行）→ 跑 0005 → 断言 providers 行、操作行归属、app_settings、conversations 新列（provider_id/model/reasoning_effert）存在；空库迁移（无 default 行）不产生激活位。
- [ ] 验证：`cargo test --lib providers::` 全绿（含既有 endpoint 校验测试迁移后仍绿）。

### Phase B：服务层（CRUD + 激活 + 删除级联）

- [ ] B1 `providers/service.rs` 重构为 `ProviderService`：`list_providers`（含激活位）、`save`（无 id 创建/有 id 更新；名称唯一校验；凭据三态 + 操作日志 + reconcile 按既有模式扩展 provider 维度）、`delete`（reconcile → 删行 → 清激活位）、`set_active`、`load_by_id`、`load_active`。
- [ ] B2 服务测试：CRUD 往返、名称冲突、keep/replace/remove 凭据路径、删除激活 provider 后激活位为空且绑定会话 provider_id 为 NULL（FK 级联断言）、pending 操作回放归属正确 provider。
- [ ] 验证：`cargo test --lib providers::service`。

### Phase C：协议层

- [ ] C1 `openai_compatible.rs` → `protocols/openai.rs` 平移，抽出共用件：HTTP client 单例、传输/状态错误映射、路径校验 helper（终止 user 角色、空内容、tool 拒绝）。流式回调拆双通道（正文 `on_delta` / 思考 `on_thinking`，返回 `GeneratedContent`）；delta 捕获 `reasoning_content`（优先）/`reasoning`（design §4.1）；请求体 `reasoning_effort` 按需携带（未选不发）。新增 `list_models`。
- [ ] C2 新增 `protocols/anthropic.rs`：请求构造（system 提取合并、effort→budget/max_tokens 档位表 design §4.2、未选默认档）、SSE 状态机（content_block_start 登记 index→类型、content_block_delta 按 index 路由 thinking/text、signature 等忽略、message_delta/message_stop/error，design §4.2）、`list_models`。
- [ ] C3 新增 `providers/model_list.rs`：saved/draft 两种 source 解析凭据 → 按协议分发 → 排序、上限 500。
- [ ] C4 测试：anthropic build_request 快照（system 提取/角色映射/thinking 字段/effort 档位四组）；anthropic SSE 正常流（end_turn）、思考+正文混合流（block 路由）、max_tokens 截断流、错误事件流、提前断流；openai thinking 捕获（reasoning_content/reasoning/皆无）与 reasoning_effort 携带/省略；两协议 list_models 解析（正常/空/畸形/超限）。格式样本见 `research/thinking-formats.md`。
- [ ] 验证：`cargo test --lib providers::protocols`。

### Phase D：生成流程 + 命令面

- [ ] D1 `conversations/`：repository 读写绑定列与 `reasoning_effort`；`load_generation_context` 返回绑定 + effort；会话列表/详情 DTO 加 `provider_id`/`model`/`reasoning_effort`；新增 `set_conversation_provider` 校验（provider 存在、model 合法、绑定同置同清、effort ∈ {low,medium,high} 且与绑定独立）。
- [ ] D2 `providers/generation.rs`：`prepare_generation` 按 design §5 解析 effective provider/model/effort + 协议分发（effort 进快照、按协议注入请求）；流式事件新增 `thinking_delta`（双通道回调）；`finish_generation` 持久化 `metadata.thinking`（思考非空时）；既有生成测试改造为参数化 provider（覆盖：绑定覆盖全局、无绑定回退全局、绑定 model 缺省用 provider 默认、effort 各档位/未选；thinking 持久化/为空不写字段）。
- [ ] D3 `providers/commands.rs`：新命令面（design §6 表），移除 `load_provider_profile`/`delete_provider_profile`，`lib.rs` 注册表更新。
- [ ] D4 集成级测试：set_conversation_provider → generate 解析正确；生成中修改绑定/编辑/删除在途 provider 不影响在途生成（快照隔离断言）。
- [ ] 验证：`cargo test`（全量）+ `cargo clippy -- -D warnings`。

### Phase E：前端契约层

- [ ] E1 `lib/tauri/provider-schemas.ts`：新 DTO schema（providers 列表、save/delete/active/models 请求响应、会话绑定字段、`thinking_delta` 事件、node 透出 `thinking`）；删除旧 profile schema。
- [ ] E2 `lib/tauri/provider-client.ts`：新命令方法；事件机（`generateFromActivePath` 校验逻辑）扩展 `thinking_delta` 转移规则与思考独立 1MB 预算（design §7.5）。
- [ ] E3 `contract-fixtures/provider-ipc.json` 更新为新契约（含 thinking 事件与 node thinking 字段）；`contract-fixtures/conversation-ipc.json` 同步会话 DTO 新字段（provider_id/model/reasoning_effort）；相关 schema 测试同步。
- [ ] 验证：`pnpm typecheck && pnpm test`。

### Phase F：前端 store + UI

- [ ] F1 `features/providers/types` + `store`：多 provider 状态与 actions（design §7.2），替换单 profile store；既有 store 测试重写。
- [ ] F2 `GlobalSettingsDialog.tsx` 重构（列表 + 编辑表单 + 获取模型列表按钮 + 激活单选 + 删除确认），**移除 `generationActive` 门禁**（保留 readOnly 保护，design §7.3）；同步更新传入该 prop 的调用点（ConversationWorkspace 等，typecheck 会强制暴露），测试更新。
- [ ] F3 新组件 `ConversationProviderPicker`（会话头部、effective 展示、provider/model 两级选择、跟随全局、管理入口、effort 选择组——默认/低/中/高，独立提交），挂接 `ConversationWorkspace`；会话类型/store 增加绑定与 effort 支持；测试覆盖 design §7.4 场景。
- [ ] F4 `MessageNode`（assistant）thinking 展示：安装 `marker` + `collapsible` + `shimmer`（`pnpm dlx shadcn@latest add marker collapsible shimmer`；本机 pnpm dlx 偶发 zod 解析错误，失败时改用 `npx shadcn@latest add`）。流式思考 = Marker(role=status + MarkerIcon(Spinner) + shimmer 内容)，完成后折叠进 Collapsible，历史默认折叠（design §7.5），测试更新。
- [ ] F5 `App.tsx` 引用点适配（providers store 加载时机）。
- [ ] 验证：`pnpm check`（format:check + lint + typecheck + test + build）。

### Phase G：收尾

- [ ] G1 全量验证：`cargo test`、`cargo clippy -- -D warnings`、`pnpm check`。
- [ ] G2 手动验收清单（prd.md Acceptance Criteria 第 4 条）：旧库升级、双协议双会话、会话内切换、删除级联回退、模型列表失败兜底。Tauri dev 起本地真实 provider 验证（注意环境代理：HTTP 客户端 `no_proxy` 已绕开 Clash）。
- [ ] G3 trellis-check 全范围复查（跨层数据流：绑定列 → DTO → store → UI 展示）。

## 验证命令汇总

```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings
pnpm check          # format:check + lint + typecheck + test + build
pnpm tauri dev      # 手动验收（G2）
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `migrations/0005_multi_provider.sql` | DROP 旧表不可逆；迁移错误损坏用户库 | A4 迁移测试先行；提交粒度 = Phase A 单独一笔 |
| `providers/service.rs` | 凭据 reconcile 语义回归（keyring/DB 不一致） | B1 保持操作日志模式不变；B2 全路径测试 |
| `providers/generation.rs` | effective 解析错误导致生成打到错误 provider | D2 参数化测试三组合全覆盖 |
| `provider-client.ts` / schemas | 事件机校验误伤（该文件含大量协议防御逻辑） | E2 只增不删事件机部分；前端测试全跑 |
| `GlobalSettingsDialog.tsx` | 重构中丢失只读（归档）保护；`generationActive` 门禁按需求移除（PRD R1） | F2 测试明确保留 readOnly 场景；移除门禁后全量前端测试 |

回滚策略：Phase A–D 每阶段独立提交；后端任一阶段不可挽救时 revert 该笔（迁移阶段除外——需同时回滚用户库，见 design §8）。前端阶段依赖后端命令面，不可单独回滚到旧契约。

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 齐备并经用户评审
- [ ] implement.jsonl / check.jsonl 已含真实条目（非 _example）
- [ ] 工作树 `../canopy-multi-provider` 干净、基于最新 main
