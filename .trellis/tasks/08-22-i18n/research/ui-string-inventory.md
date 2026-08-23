# UI 字符串清单与 i18n 现状勘察（2026-08-22）

> 探索 agent 全量扫描结论（工作树 /home/jwh/Code/canopy-i18n，基线 main@4938107）。
> 本文是迁移工作的文件级清单来源。

## 1. 技术栈

React 19 + TypeScript（strict, noUncheckedIndexedAccess, resolveJsonModule）+ Vite 8 + Tailwind 4；UI 为 shadcn（`components.json`，primitives 在 `src/components/ui/*`）+ 统一 `radix-ui` 包 + lucide-react + sonner toasts + streamdown 2.4.0（助手 markdown 渲染）；状态 zustand 5（两个 store，无 persist 中间件）；校验 zod；测试 vitest + testing-library (jsdom)。路径别名 `@/* -> src/*`。

## 2. 现状语言

用户可见字符串全部为简体中文，一致无混杂。英文仅出现在内部/开发错误与机器码。示例：
- `src/features/conversations/components/ConversationWorkspace.tsx:576` "开始新会话"、`:579` "在下方输入第一条消息。发送后才会保存。"
- `src/features/conversations/components/Composer.tsx:19` `placeholder = "输入消息…"`
- `src/features/settings/components/SettingsDialog.tsx:65,70-71,86,96` "设置"/"模型提供商"/"会话"
- `src/features/conversations/components/MessageBubble.tsx:14-19` 角色标签 "系统/用户/助手/工具"
- `src-tauri/src/error.rs:36` "请求包含无效输入。"（后端错误直达 UI）

## 3. 字符串分布（CJK grep 行数，不含测试）

**侧栏 / 历史** — `ConversationWorkspace.tsx`（36 行）：新会话按钮/tooltip（344-352, 521-529）、"历史记录" 头（359）、归档徽章（403, 536）、空态/加载（429, 434, 477, 616）、重试（447, 625）、侧栏折叠开关（501-502）、归档 AlertDialog（681-709）、composer 占位三元（660-665）。

**聊天 / 消息区**：
- `MessageNode.tsx`（17）：分支编辑按钮（136-161）、生成回复 CTA（175, 180）、图标 tooltip/aria（195-239）、分支 textarea 占位（265）
- `ConversationPane.tsx`（12）：错误横幅 "出错了"/"重试"（192-204）、空态（211）、保存 spinner aria（253）
- `MessageBubble.tsx`（7）：角色标签 + `${roleLabel}消息` aria（14-19, 33）
- `ThinkingBlock.tsx`（2）："思考中…" / "思考过程"
- `OutlineTree.tsx`（5）：错误兜底（104）、aria（182）、展开/收起插值标签（226）、"该消息暂无回复"（227）、"无内容"（242）
- `Composer.tsx`（6）：sr-only 标签（83）、占位默认（19）、发送/取消标题（102-103, 119-120）
- `AssistantMarkdown.tsx`（约 8）：streamdown 的 `MARKDOWN_TRANSLATIONS` 映射（56-66 行，copyCode/copied/copyTable/Csv/Markdown/Tsv）

**设置对话框**：
- `SettingsDialog.tsx`（6）：trigger、sr-only 标题/描述、导航 aria + 两个分类
- `ConversationSettingsPanel.tsx`（8）：面包屑、"自动生成标题" 开关及描述（100-105）、"标题模型"（121）、"跟随会话"（138）
- `ProviderSettingsPanel.tsx`（9）：面包屑 "设置/模型提供商"、"编辑"/"新建" 状态（31-52）、返回按钮 aria（74-77）
- `ProviderSettingsList.tsx`（20）："全部提供商"、"新建"（63-74）、空态（79）、默认徽章（108-111）、下拉项/标题（135-179）、删除 AlertDialog 插值（198-222）
- `ProviderSettingsEditor.tsx`（27）：标题三元（252）、alerts（256-264）、全部字段标签/占位（270-451：名称/协议/基础端点/模型列表/默认模型/API 密钥）、端点提示（323）、按钮（344-483）、插值 aria（377, 400）

**错误 / toast**：`src/components/ui/toaster.tsx:55`（"跳转到会话"）；`useWorkspaceGenerationController.ts` toast 标题（101）、composer `unavailableReason`（351-361）；store 兜底错误 `conversations/store/index.ts:192,198`、`providers/store/index.ts:58`；client 兜底 `src/lib/tauri/client.ts:281,289`、`provider-client.ts:536`。

**内置中文的 shadcn 基础组件**：`src/components/ui/dialog.tsx:76,115`（"关闭"）、`breadcrumb.tsx:106`（"更多"）、`spinner.tsx:9`（"正在加载"）。

## 4. i18n 现有设施

无。package.json / pnpm-lock.yaml 无任何 i18n 库；前后端零 `Intl.*`/`toLocale*`；无日期/数字格式化 helper（时间戳仅用于排序 `conversations/store/index.ts:265`，从不渲染）。唯一正向挂点：streamdown 支持 `translations` prop（`AssistantMarkdown.tsx:56-66` 已接线）。

## 5. Rust 后端

- `src-tauri/src/error.rs`：`CommandError` 每条携带硬编码中文 `message` + 稳定 snake_case `CommandErrorCode`（16 条消息，36-153 行：invalid_input、internal、cancelled、provider auth/rate-limit/unavailable/network、not_found、tree_integrity、database_unavailable 等）。`details` 是机器可读英文码（如 `generation_already_active`）。
- 前端原样透传 `message`（`src/lib/tauri/client.ts:261-276` `normalizeCommandError`）并直接渲染：错误横幅 `ConversationPane.tsx:193`、toast `useWorkspaceGenerationController.ts:152,165`。→ **前端按 code 映射文案、忽略后端 message 是最干净路径**（code 已是 zod 校验的闭合枚举）。
- `src-tauri/src/providers/domain.rs:13`：`MIGRATED_PROVIDER_NAME = "默认"`（种子提供商名，存储数据，运行时不可翻译）。
- `src-tauri/src/providers/title_prompt.rs:11-29`：英文系统提示词，明确指示模型匹配用户语言（19 行）；`titles.rs:147-155` 同时剥离 "Title:" 与 "标题：" 前缀。标题是 LLM 动态输出，不翻译。
- Rust 无 locale 相关格式化；`lib.rs:164-171` 测试断言中文错误 JSON（若改 message 需同步，采用前端映射方案则不动）。

## 6. 设置 / 持久化

无 localStorage / sessionStorage / zustand-persist / tauri-plugin-store。全部设置走 SQLite：`app_settings` kv 表（`src-tauri/migrations/0005_multi_provider.sql:61-68`），`src-tauri/src/providers/repository.rs:179-221` 读写 helper，Tauri 命令 `set_auto_generate_title` / `set_title_model_binding`（`commands.rs:27,337-345`），经 `list_providers` 返回（`commands.rs:156,320-331`）。`language` 偏好可完全复用该模式。

## 7. 动态内容 / 插值 / 复数

**永不翻译**：LLM 消息正文、思考块、会话标题、消息预览（`deriveConversationTitle.ts` 派生）、用户输入的 provider 名/模型名、表格格式标签（CSV/Markdown/TSV 保持原样）。

**插值模板**（需要占位符机制）：
- `formatProviderModelsSummary.ts:6,10` — "未添加模型" / `` `${head} 等 ${remaining} 个` ``（**唯一复数场景**：中文无复数，英文需 one/other）
- `ProviderSettingsList.tsx:201` — `删除「${name}」？`
- `ProviderSettingsEditor.tsx:377,400` — `移除 ${model}` / `加入模型：${model.id}`
- `OutlineTree.tsx:226` — `` `${收起/展开} ${node.preview || "消息"}` ``
- `MessageBubble.tsx:33` — `` `${roleLabel}消息` ``

**状态三元**：composer 占位 `ConversationWorkspace.tsx:660-665`、复制 tooltip `MessageNode.tsx:238-239`、侧栏开关 `:501-502`。

## 8. HTML lang / 文档标题

`index.html:2` 静态 `<html lang="zh-CN">`（切换语言需运行时更新）。标题 "Canopy"（`index.html:7`、`src-tauri/tauri.conf.json` windows[0].title）；无 `document.title` 动态修改。

## 9. 规模估算

- 前端非测试文件约 24 个、去重字符串约 190-210 条。重灾区：ConversationWorkspace.tsx(36)、ProviderSettingsEditor.tsx(27)、ProviderSettingsList.tsx(20)、ConversationProviderPicker.tsx(19)、MessageNode.tsx(17)，其余 ≤12。
- Rust：1 个文件 16 条用户可见消息 + 1 个种子名（前端 code 映射方案下全部免翻译）。
- 测试：18 个测试文件断言中文（约 500 行，如 `ConversationWorkspace.test.tsx` 181 行），与组件改造量级相当 → 用"测试固定 zh-CN locale"策略可大幅降低改动。
- 另有 3 个 shadcn 基础组件 + `toaster.tsx` + streamdown 9 键翻译表。

## 10. 结构性结论

两个关键架构决策已明确：
1. **错误消息策略**：前端按 `CommandErrorCode` 映射（闭合枚举、zod 已校验），不改 Rust 端中文 message（存量行为零变化，`lib.rs` 测试不动）。
2. **语言偏好存储**：复用 `app_settings` kv + Tauri 命令模式（与 auto-title 设置完全同构）。
