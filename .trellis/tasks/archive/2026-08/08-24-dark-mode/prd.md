# 深色模式（Dark Mode）与外观设置支持

## Goal / 用户价值

Canopy 目前在 CSS 变量层面（`src/index.css`）已内置完整的浅色/深色主题变量与 `.dark` 选择器，但缺乏运行时主题切换能力与持久化偏好设置。本任务为 Canopy 引入完整的主题管理体系：
1. 在设置对话框中独立新增 **「外观 / Appearance」** 分类面板；
2. 支持 **跟随系统 (system) / 浅色模式 (light) / 深色模式 (dark)** 三种主题模式；
3. 提供平滑的主题即时切换、启动水合与持久化存储，提升夜间及弱光环境下的视觉舒适度。

## 已确认事实（仓库勘察 2026-08-24）

- **设置对话框架构**：
  - `SettingsDialog.tsx` 现有 `general`（通用）、`providers`（模型提供商）、`conversation`（会话）三档分类。
  - 用户明确要求将主题/外观独立为设置页中的新分类 **「外观 / Appearance」**（`appearance`）。
- **CSS 与样式系统**：
  - `src/index.css` 已经完整配置了 `@custom-variant dark (&:is(.dark *));` 以及 `.dark` 作用域下的所有语义 CSS 变量（`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--ring`, `--sidebar*` 等）。
  - shadcn/ui 组件均基于此类语义 CSS 变量及 `dark:` 变体构建。
- **设置持久化模式**：
  - SQLite `app_settings` kv 表与 Tauri 命令（如 `set_language`、`set_auto_generate_title`，见 `src-tauri/src/providers/`）已形成标准同构模式。
  - 启动时 `list_providers` 会批量返回全局设置字段（`language`, `auto_generate_title`, `title_model_binding`），前端 store 统一水合。
- **i18n 多语言**：
  - `zh-CN` 与 `en` 双语字典（`src/lib/i18n/locales/`）按 `<feature>.<area>.<name>` 组织。将新增 `settings.appearance.*` 词条。
- **Canvas / 图表组件**：
  - `@xyflow/react`（思维导图画布 `MindMapCanvas.tsx`）内置对 `colorMode` 的响应能力。
- **测试现状**：
  - 现有 24 个前端测试文件、90 个 Rust 单元/集成测试全绿。

## Requirements

### R1 主题偏好模式
- 支持三种主题偏好选项：
  - `system`（跟随系统，默认）：根据 OS / 系统颜色模式（`prefers-color-scheme: dark`）动态响应。
  - `light`（浅色模式）：强制使用浅色主题。
  - `dark`（深色模式）：强制使用深色主题。

### R2 设置界面新增「外观 / Appearance」面板
- 在 `SettingsDialog.tsx` 的导航栏中新增「外观 / Appearance」分类（位于「通用」与「模型提供商」之间或紧随通用）。
- 新增 `AppearanceSettingsPanel.tsx` 组件，承载外观与主题相关的配置。
- 面板包含主题选择下拉项（主题 / Theme），提供「跟随系统 / 浅色 / 深色」选项。
- 完整适配 `zh-CN` 和 `en` 双语字典，支持只读模式与保存失败回退。

### R3 主题偏好持久化（Backend & IPC）
- 后端复用 SQLite `app_settings` kv 表，键名为 `"theme"`。
- 新增 Tauri 命令 `set_theme`（闭合校验 `"system" | "light" | "dark"`）。
- `list_providers` 响应新增 `theme` 字段（缺省默认 `"system"`）。
- 严禁使用 `localStorage` 存储偏好（遵循 spec 设置走 IPC / invoke 原则）。

### R4 前端状态与动态响应（Frontend Theme Store & Runtime）
- 建立 `src/lib/theme/` 模块（含类型定义、系统主题监听器与状态 store）。
- 应用启动时自 `list_providers` 水合持久化主题设置。
- 动态在 `document.documentElement`（`<html>`）上添加或移除 `dark` 类，并维护 `color-scheme` 样式。
- 当处于 `system` 模式时，监听 `window.matchMedia("(prefers-color-scheme: dark)")` 的变化并实时更新界面。

### R5 画布与子系统适配
- `MindMapCanvas` 中的 `@xyflow/react` 同步传入对应的 `colorMode`（`"system" | "light" | "dark"`），确保思维导图画布的控制条、MiniMap 和背景与深色模式融洽统一。

### R6 测试与质量保障
- Rust 单元与契约测试覆盖 `theme` kv 读写、`set_theme` 校验、`list_providers` 载荷。
- 前端 Zod 校验、Client、Store、AppearanceSettingsPanel、SettingsDialog、ThemeStore / Resolver 全覆盖。
- `pnpm check` 与 `cargo test` 全绿，中文及既有测试零回归。

## Acceptance Criteria

- [ ] 设置对话框中新增「外观 / Appearance」分类，点击可展示外观设置面板。
- [ ] 首次启动应用且无持久化记录时，默认选择「跟随系统」；系统为深色时界面自动呈现深色，系统为浅色时呈现浅色。
- [ ] 在「设置 -> 外观」中可切换为「浅色」、「深色」或「跟随系统」，界面即时无刷新切换。
- [ ] 处于「跟随系统」时，切换操作系统主题（或触发 `matchMedia` change 事件），界面能即时自适应。
- [ ] 选择的主题偏好在重启后依然保留（持久化于 SQLite `app_settings`）。
- [ ] `contract-fixtures/provider-ipc.json` 与前后端契约测试保持一致。
- [ ] `pnpm check`（format / lint / typecheck / test / build）与 `cargo test` 全部通过。

## Out of Scope

- 自定义配色方案（如莫兰迪色、Catppuccin 主题等多种调色板扩展）。
- 按单个会话或特定消息节点独立设置不同主题。
