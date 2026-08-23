# i18n 国际化支持

## Goal / 用户价值

Canopy 界面文案当前全部硬编码简体中文（约 200 处、24 个非测试文件，见 `research/ui-string-inventory.md`）。本任务引入 i18n 机制，将用户可见文案迁入语言资源，支持 **zh-CN + en** 双语界面，让非中文用户获得完整英文体验；中文用户体验零回归。

## 已确认事实（仓库勘察 2026-08-22）

- 前端 React 19 + TS（strict, noUncheckedIndexedAccess）+ Vite 8 + shadcn + zustand；无任何 i18n 基础设施。
- 后端 `src-tauri/src/error.rs` 16 条中文错误消息每条携带稳定 snake_case `CommandErrorCode`；前端 zod `commandErrorSchema` 已校验该闭合枚举；`client.ts:261-276` 目前原样透传 `message` 直接渲染。
- 设置持久化机制现成：SQLite `app_settings` kv 表 + Tauri 命令（`set_auto_generate_title` 同构模式，见 `providers/commands.rs:337-345`、`repository.rs:179-221`）。
- `index.html:2` 静态 `lang="zh-CN"`；时间戳从不渲染（无日期/数字格式化需求）；streamdown 已有 `translations` prop 挂点。
- 唯一复数场景 `formatProviderModelsSummary.ts`；若干插值模板（`删除「${name}」？` 等）；18 个测试文件断言中文文案。
- 永不翻译：LLM 消息正文/思考块/标题/预览、用户输入的 provider 名/模型名、CSV/Markdown/TSV 表格标签。

## Requirements

### R1 i18n 基础设施
- 引入类型安全的 i18n 机制（键类型化、支持 `{name}` 插值与英文复数），全部用户可见前端文案迁入语言资源，包括 3 个 shadcn 基础组件（dialog/breadcrumb/spinner）与 streamdown 翻译表（`AssistantMarkdown.tsx`）。

### R2 语言集合与默认行为
- MVP 支持 zh-CN 与 en 两个语言包，二者文案覆盖率 100%（无裸键 fallback 到用户可见状态）。
- 首次启动跟随系统 locale（Tauri WebView 的 `navigator.languages`）：中文系统 → zh-CN，其他 → en。
- 用户可在设置中手动选择语言（含"跟随系统"选项），选择持久化并优先于系统检测。

### R3 语言偏好持久化
- 偏好存储复用 `app_settings` kv 表 + Tauri 命令模式；不引入 localStorage（遵循 spec：设置走 invoke）。

### R4 后端错误消息本地化
- 前端按 `CommandErrorCode`（闭合枚举）映射本地化错误文案，不再渲染后端中文 `message`；Rust 端 message 保持原样（存量行为零变化）。
- 未知/缺码兜底到通用 internal 错误文案；机器可读 `details` 保持英文原样。

### R5 切换即时生效
- 切换语言后全 UI 即时刷新，无需重启应用；`<html lang>` 同步更新。

### R6 测试
- 既有 18 个断言中文文案的测试文件保持通过（策略：测试环境固定 zh-CN locale，使断言文本不变）。
- 新增 i18n 核心测试：locale 检测/回退、插值、复数、错误 code 映射、切换即时生效。

## Acceptance Criteria

- [x] 系统 locale 为中文的首次启动显示中文；英文系统首次启动显示英文界面。（代码验证：`resolve.test.ts` zh*/非 zh 检测与偏好解析、`locale-store` 初始 locale、`GeneralSettingsPanel.test.tsx` 显式固定 navigator 的 system 回退测试）
- [x] 设置面板可选 简体中文 / English / 跟随系统；重启后选择保留（`app_settings` 中可验证 kv）。（代码验证：Rust `language_preference_settings_round_trip_through_the_settings_kv` 断言 kv 行、`lib.rs` 命令注册/校验测试、`provider-client.test.ts` 载荷与闭合枚举、store/面板 round-trip 测试；真实重启后 GUI 目检待手动验收）
- [x] 切换语言后全部界面文案即时切换（侧栏、消息区、设置、toasts、错误横幅、aria-label/tooltip、占位符、空态、AlertDialog），`<html lang>` 更新，无残留硬编码文案。（代码验证：结构上全部用户可见文案经 `t()`（见残留扫描零命中），`index.test.ts` 重渲染、`App.test.tsx` html lang 同步、`GeneralSettingsPanel.test.tsx` 切换后控件文案即时重译）
- [x] 触发后端错误（如无效 provider 端点）时，错误横幅/toast 文案跟随当前语言；`details` 机器码保持原样。（代码验证：`command-errors.test.ts` 11 个 code 全覆盖 + 未知兜底 + 双语切换、所有展示点改 `commandErrorMessage(code)`，`details` 仅透传不渲染）
- [x] zh-CN 下全部文案与现状逐字一致（中文回归零差异，占位/插值后文本相同）。（代码验证：HEAD 基线全部中文字符串字面量与词典逐字比对脚本通过，8 处模板参数改名输出等价；既有中文断言测试零改动通过）
- [x] `pnpm check`（format/lint/typecheck/test/build）与 `cargo test` 全绿。（2026-08-22 检查代理复跑：`pnpm check` exit 0（24 文件 223 测试）、`cargo test` 90 测试全过、`cargo clippy --all-targets -- -D warnings` 与 `cargo fmt --check` exit 0）
- [x] 代码中（非资源文件、非测试）不再有用户可见的硬编码中文字符串。（代码验证：`rg "\p{Han}"` 仅剩设计保留项——Rust error.rs 消息/`MIGRATED_PROVIDER_NAME`（前端不渲染 message，改为 code 映射）、LLM title prompt 数据、index.css 与 AssistantMarkdown 注释/throw 已批准例外）

> GUI 级最终手动验收（`pnpm tauri dev` 过一遍七条）仍待执行；用户实测反馈的两处修正（通用分类图标 `Languages`→`Settings2`、默认打开分类 providers→general，2026-08-22）已并入并有测试覆盖。

## Out of Scope

- 第三个及更多语言（架构上新增语言包即可扩展，但不属于本任务）。
- RTL 语言、日期/数字/货币本地化格式（当前无渲染需求）。
- Rust 端错误 message 本身的多语言化（以前端 code 映射替代）。
- LLM 动态内容（消息、标题、预览）与用户输入数据（provider 名/模型名）的翻译。
- 原生窗口标题 / `document.title` 的本地化（保持 "Canopy"）。

## Key Decisions（用户已确认 2026-08-22）

1. MVP 语言集合 = zh-CN + en。
2. 默认行为 = 跟随系统 locale，设置可覆盖并持久化。
3. 后端错误消息进 MVP，采用前端按 `CommandErrorCode` 映射方案。
