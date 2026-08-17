# 会话标题自动生成 — 执行计划

## 实施清单（按序）

### 1. 后端：自动标题设置（开关 + 模型绑定）
- [ ] `providers/repository.rs`：新增 `AUTO_GENERATE_TITLE_SETTING_KEY`、`TITLE_MODEL_BINDING_SETTING_KEY`，复用 `get_setting`/`set_setting`/`delete_setting_value`
- [ ] `providers/service.rs`：`get/set_auto_generate_title`、`get/set_title_model_binding`（绑定校验 provider 存在、model ∈ provider.models；null 清除）
- [ ] `providers/commands.rs`：对应命令 + DTO；读取并入现有设置加载路径
- [ ] 单测：开关读写、绑定解析矩阵、缺省值行为

### 2. 后端：标题生成核心 `providers/titles.rs`（新文件）
- [ ] 最先短路：开关关闭 → 立即返回（零 LLM）
- [ ] 触发判定：assistant 节点计数 == 1（repository 查询）
- [ ] 绑定解析：设置 → 会话绑定 → active provider 回退链
- [ ] 提示词：`providers/title_prompt.rs`（独立模块，仅模板/组装；`titles.rs` 不内联长字符串）
- [ ] 一次性调用：复用协议客户端流式通道，max_tokens≈60、禁 thinking、累积纯文本
- [ ] 清洗：trim/去引号/单行化/validate_title；空或超限 → 放弃
- [ ] 写库：UPDATE conversations.title（conversations repository 新方法）
- [ ] 事件：`app.emit("conversation://title-updated", payload)`
- [ ] 接入 `finish_generation` Completed 分支，`tokio::spawn` 异步执行；全链路错误仅 log

### 3. 前端：store 事件监听
- [ ] `src/lib/tauri`：事件 payload 类型 + 运行时校验（遵循 type-safety spec)
- [ ] conversations store：初始化时 `listen("conversation://title-updated")` → upsertSummary；当前会话同步 tree.conversation.title
- [ ] 测试：事件到达 → summary 更新 / 当前会话标题更新 / 非当前会话不打扰生成

### 4. 前端：设置对话框「自动标题」区块
- [ ] GlobalSettingsDialog 左栏新增「会话」分类；右栏：「自动生成会话标题」开关 +「标题模型」选择（跟随会话 / 指定 provider+model）
- [ ] 开关关闭时标题模型选择器禁用（保留上次选择）
- [ ] 文案仅控件标签，不加说明段落；复用现有 provider 选择器模式（DropdownMenu + 已配置模型列表）
- [ ] 测试：开关切换、选择/保存/清除、关时选择器禁用

### 5. 验证与收尾
- [ ] `cargo fmt --check` + `cargo clippy --all-targets --all-features -- -D warnings` + `cargo test --all-features`
- [ ] `pnpm check`（含全量前端测试）
- [ ] G2 手动验收：开→首轮后标题更新；关→保持截断、无请求；断网静默；指定标题模型生效；重启后开关/绑定保留

## 验证命令

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm check
```

注意：验证命令显式回传退出码，不用管道掩盖（上次教训）。

## 风险文件 / 回滚点

- `providers/generation.rs` — 接入点是生成主链路，改动须最小（仅 Completed 分支追加 spawn)；回滚 = 移除 spawn 调用
- `conversations/repository.rs` — 新增 UPDATE title 与节点计数查询，不改既有查询
- 前端 store index.ts — 监听注册放在初始化动作中；回滚 = 删监听 + 类型

## 审查门

- 步骤 2 完成后自查：GenerationRuntime 零接触、无节点写入、无持久化部分内容
- 步骤 3 完成后自查：事件监听的清理（unlisten）与 store 重置路径
- commit 前跑 trellis-check 全量
