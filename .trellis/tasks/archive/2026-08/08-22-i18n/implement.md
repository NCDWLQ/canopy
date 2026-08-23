# i18n 执行计划

> 依据 `design.md`；字符串清单 `research/ui-string-inventory.md` §3 是迁移核对表。
> 工作目录：git worktree `/home/jwh/Code/canopy-i18n`，分支 `feat/i18n`。

## Phase 0 — 基线确认

- [ ] `pnpm check` 与 `cargo test` 在 main 基线上全绿（记录基线，后续对比）。

## Phase 1 — i18n 核心（纯前端，可独立验证）

- [ ] `src/lib/i18n/types.ts`：`SupportedLocale`、`LocalePreference`、`Dictionary` 类型。
- [ ] `src/lib/i18n/locales/zh-CN.ts`：中文词典（从 inventory §3 机械搬运，扁平点分键；插值条目写成函数词条）。
- [ ] `src/lib/i18n/locales/en.ts`：`satisfies Dictionary` 英文词典（modelsSummary 复数：one/other）。
- [ ] `src/lib/i18n/locale-store.ts`（zustand，不 persist）、`resolve.ts`（`navigator.languages` 检测，zh*→zh-CN 否则 en）、`index.ts`（`t` 双重载 + `useTranslation`）。
- [ ] `src/lib/i18n/command-errors.ts`：`Record<CommandErrorCode, MessageKey>`（16 个 code 全覆盖）+ `commandErrorMessage()` 兜底 internal。
- [ ] 核心单测：resolve（navigator mock）、t 静态/插值/复数/未知 locale 兜底 zh-CN、command-errors 全 code 非空。

验证：`pnpm typecheck && pnpm test src/lib/i18n`

## Phase 2 — 后端 IPC（language 读写）

- [ ] Rust：`providers/repository.rs` kv helper 复用写 `language` 键；`providers/commands.rs` 新增 `set_language`（镜像 `set_auto_generate_title`）；`list_providers` 响应加 `language`（缺省 `"system"`）。
- [ ] 前端桥：`provider-schemas.ts` zod 扩展、`provider-client.ts` 暴露 `setLanguage` 与响应类型更新、`contract-fixtures/provider-ipc.json` 同步（Rust/TS 共享契约，两侧测试都要过）。
- [ ] Rust 测试：kv round-trip、`set_language` 命令、`list_providers` 含 language；`lib.rs:164-171` 错误 JSON 测试保持不动。

验证：`cargo test && cargo clippy && pnpm typecheck && pnpm test src/lib/tauri`

## Phase 3 — 错误展示切换（后端 message → code 映射）

> 执行拆分调整（2026-08-22 实施时）：Phase 3 代理独占文件 = 测试 setup 固定 zh-CN、ConversationPane.tsx 与 useWorkspaceGenerationController.ts **整文件**（含其全部文案）、两 store 与 client/provider-client 的构造层文案、dialog/breadcrumb/spinner/toaster/AssistantMarkdown。Phase 4 代理只做其余 feature 组件；SettingsDialog.tsx 整文件划归 Phase 5（导航要加「通用」板块）。

- [ ] `ConversationPane.tsx:193` 横幅、`useWorkspaceGenerationController.ts` toast（:101,:152,:165）、`conversations/store/index.ts:192,198`、`providers/store/index.ts:58`、`client.ts:281,289`、`provider-client.ts:536` 兜底错误：显示文本改 `commandErrorMessage(error.code)`；`details` 原样。
- [ ] wire 契约与 zod schema 零变化（只改展示层）。

验证：`pnpm test src/features`（此时测试 setup 尚未固定 locale，若有失败先完成 Phase 4 第一项再跑）

## Phase 4 — 测试基建 + 组件迁移

- [ ] `src/test` setup 固定 locale = zh-CN（显式 set，不依赖 jsdom navigator），既有中文断言保持逐字不变。
- [ ] shadcn 基础组件：`dialog.tsx`（"关闭"）、`breadcrumb.tsx`（"更多"）、`spinner.tsx`（"正在加载"）→ `t()`。
- [ ] `AssistantMarkdown.tsx`：`MARKDOWN_TRANSLATIONS` 从 `t()` 构造。
- [ ] 按清单迁移（顺序 = 字符串数降序，每文件迁移后跑其测试）：
  - ConversationWorkspace.tsx（36）
  - ProviderSettingsEditor.tsx（27）
  - ProviderSettingsList.tsx（20）
  - ConversationProviderPicker.tsx（19）
  - MessageNode.tsx（17）
  - ConversationPane.tsx（12）、SettingsDialog.tsx、ConversationSettingsPanel.tsx、ProviderSettingsPanel.tsx
  - Composer.tsx、MessageBubble.tsx、OutlineTree.tsx、ThinkingBlock.tsx、formatProviderModelsSummary.ts
  - toaster.tsx、useWorkspaceGenerationController 剩余（unavailableReason :351-361）
- [ ] 迁移完成后全局 grep 验收：非资源、非测试代码无用户可见硬编码中文（`[\u4e00-\u9fff]`，排除注释与 `src/lib/i18n/locales/`）。

验证：`pnpm test`（全量）

## Phase 5 — 语言设置 UI + 水合

- [ ] `GeneralSettingsPanel.tsx` 新建（语言 Select：跟随系统/简体中文/English，reui 行布局同 `ConversationSettingsPanel`）；`SettingsDialog` 导航加「通用」分类。
- [ ] 启动水合：`list_providers` 响应中 `language` 解析，非 `"system"` 时 setLocale；切换时 `setLanguage` → 成功后 setLocale。
- [ ] `document.documentElement.lang` 随 locale effect 更新。
- [ ] 新增测试：设置面板 round-trip（fake client 断言 `set_language` 载荷与蛇形字段）、水合偏好覆盖系统语言、切换后重渲染 + html lang。

验证：`pnpm test && pnpm typecheck`

## Phase 6 — 终检与验收

- [ ] `pnpm check` 全绿（format/lint/typecheck/test/build）。
- [ ] `cargo fmt --check`（仅触碰文件保持 fmt-clean，main 既有漂移不处理）、`cargo clippy`、`cargo test`。
- [ ] 手动验收（`pnpm tauri dev`）过一遍 prd.md Acceptance Criteria 七条，结果回写 prd 勾选框。

## 风险文件与回滚点

| 文件 | 风险 | 缓解 |
|---|---|---|
| `contract-fixtures/provider-ipc.json` | Rust/TS 共享契约，两侧测试同测 | Phase 2 一次改完，两侧测试同时过再继续 |
| `src/lib/tauri/client.ts` / `provider-client.ts` | IPC 边界，spec 高压区 | Phase 3 只动展示层，schema 不动 |
| `ConversationWorkspace.tsx`（36 处 + 181 行测试） | 单文件改动最大 | Phase 4 首个迁移，测试 setup 已固定 zh-CN 兜底 |
| 词典键命名 | 后期改键 = 全局重构 | 键名遵循 `<feature>.<area>.<name>`，Phase 1 定稿前对照清单复核一遍 |

- 回滚点：每个 Phase 一批工作提交（commit 计划在 Phase 3.4 按工作流与用户确认）；任一 Phase 失败可 `git revert` 该批提交，`app_settings` 新键为加法、旧版本可忽略。
