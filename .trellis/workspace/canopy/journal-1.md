# Journal - canopy (Part 1)

> AI development session journal
> Started: 2026-08-09

---



## Session 1: Canopy week-one foundation

**Date**: 2026-08-09
**Task**: Canopy week-one foundation

### Summary

Defined and verified Canopy's first-week delivery framework and minimum frontend, database, error-handling, and testing specs.

### Main Changes

- Selected Canopy, MIT, and Rust sqlx repositories over the Tauri SQL plugin-managed pool.
- Documented tree-native Node/Conversation schema, fail-closed root-to-active recursive CTE, immutable branching, and typed errors.
- Defined developer-managed shadcn frontend-agent ownership and fixture handoff boundaries.

### Git Commits

(No commits - planning session)

### Testing

- [OK] Trellis manifests and placeholder scans passed.
- [OK] SQLite DDL, root constraints, delete protection, path ordering, sibling exclusion, and cycle termination passed.

### Status

[OK] **Completed**

### Next Steps

- Initialize the application repository and create the week-one foundation implementation task; the developer launches the separate frontend UI agent after shared contracts are frozen.


## Session 2: Scaffold Canopy desktop foundation

**Date**: 2026-08-09
**Task**: Scaffold Canopy desktop foundation
**Branch**: `main`

### Summary

Initialized the local Git repository and a validated Tauri 2 + React/Vite/shadcn desktop shell with pnpm, Rust quality gates, Rust-only SQLite plugin wiring, MIT licensing, smoke tests, and executable Trellis infrastructure contracts; no product conversation features were implemented.

### Git Commits

| Hash | Message |
|------|---------|
| `6e2b480` | (see git log) |

### Status

[OK] **Completed**


## Session 3: Tree persistence

**Date**: 2026-08-09
**Task**: Tree persistence
**Branch**: `main`

### Summary

Implemented and verified the SQLite conversation-tree persistence vertical slice with plugin-managed pooling, immutable tree constraints, transactional services, fail-closed root-to-active queries, and real migration regressions.

### Git Commits

| Hash | Message |
|------|---------|
| `d651093` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Implement typed conversation domain boundary

**Date**: 2026-08-09
**Task**: Implement typed conversation domain boundary
**Branch**: `main`

### Summary

Added conversation-only archive, typed Rust/Tauri commands and errors, a shared IPC contract fixture, runtime-validated TypeScript bridge and projections, fail-closed full-tree validation, Unicode-aligned input checks, SQLite lock mapping, and cross-layer regression coverage.

### Git Commits

| Hash | Message |
|------|---------|
| `0d66976` | (see git log) |

### Status

[OK] **Completed**


## Session 5: Secure Provider Generation Path

**Date**: 2026-08-09
**Task**: Secure Provider Generation Path
**Branch**: `main`

### Summary

Implemented and independently verified secure provider profiles, OpenAI-compatible SSE generation, strict ready-to-commit acknowledgement, exact cancellation, authoritative assistant persistence, and typed frontend IPC contracts.

### Git Commits

| Hash | Message |
|------|---------|
| `51dca22` | (see git log) |
| `1da6460` | (see git log) |

### Status

[OK] **Completed**


## Session 6: Integrate provider generation workspace

**Date**: 2026-08-10
**Task**: Integrate provider generation workspace
**Branch**: `integration-generation-ui`

### Summary

Integrated redacted provider settings and strict streamed generation into the tree-native workspace, including automatic ready acknowledgement, exact cancellation, authoritative assistant merge, post-ack SQLite reconciliation, accessibility, tests, and frontend code-spec updates.

### Git Commits

| Hash | Message |
|------|---------|
| `9b2fd85` | (see git log) |
| `d07f20e` | (see git log) |

### Status

[OK] **Completed**


## Session 7: Integrate workspace and fix AppImage rendering

**Date**: 2026-08-10
**Task**: Integrate workspace and fix AppImage rendering
**Branch**: `main`

### Summary

Fast-forwarded the completed Conversation Workspace and provider generation UI into main, fixed NVIDIA/WebKitGTK DMA-BUF blank rendering before Tauri initialization, passed 54 frontend and 46 Rust tests plus lint/type/build gates, and generated and visually verified the complete AppImage.

### Git Commits

| Hash | Message |
|------|---------|
| `5044b5f` | (see git log) |

### Status

[OK] **Completed**


## Session 8: Automatic generation after message send

**Date**: 2026-08-10
**Task**: Automatic generation after message send
**Branch**: `main`

### Summary

Added persistence-first automatic assistant generation for new conversations and appended user messages, guarded it against stale targets, unmounts, provider changes, and duplicate starts, expanded regression coverage, and documented the frontend state-management contract.

### Git Commits

| Hash | Message |
|------|---------|
| `98caf1a` | (see git log) |
| `aa4e840` | (see git log) |

### Status

[OK] **Completed**


## Session 9: Restore conversation history after restart

**Date**: 2026-08-10
**Task**: Restore conversation history after restart
**Branch**: `main`

### Summary

Added SQLite-backed conversation discovery and startup rehydration, a history sidebar, deterministic latest-path selection, cold-start/file-backed regressions, and documented the restore contract.

### Git Commits

| Hash | Message |
|------|---------|
| `0a32173` | (see git log) |
| `e7df2f5` | (see git log) |

### Status

[OK] **Completed**


## Session 10: Core usability and async mutation safety

**Date**: 2026-08-12
**Task**: Core usability and async mutation safety
**Branch**: `main`

### Summary

Added a blank Composer-first conversation flow with normalized prompt-derived titles and accessible history labels; guarded append, branch, and edit completions with unique request epochs and live selection checks so stale results cannot steal navigation or start generation; added comprehensive regressions and synchronized frontend specs.

### Git Commits

| Hash | Message |
|------|---------|
| `d35f6b5` | (see git log) |
| `c7cdaef` | (see git log) |

### Status

[OK] **Completed**


## Session 11: 生成体验产品化

**Date**: 2026-08-12
**Task**: 生成体验产品化
**Branch**: `main`

### Summary

将 transient 生成投影产品化为普通助手消息，加入 1.5 秒静默恢复宽限、阶段派生失败、内容保留与真实恢复动作；补齐 ready 后取消、明确失败、歧义重载和卸载计时竞态测试，并同步前端可执行规范。

### Git Commits

| Hash | Message |
|------|---------|
| `654e076` | (see git log) |
| `73ea3e7` | (see git log) |

### Status

[OK] **Completed**


## Session 12: Refactor sidebar global settings

**Date**: 2026-08-12
**Task**: Refactor sidebar global settings
**Branch**: `main`

### Summary

Moved Provider configuration from the conversation header into a global Settings dialog opened from a low-emphasis sidebar footer action; preserved provider security and mutation behavior, expanded accessible interaction coverage, and documented the workspace-global settings contract.

### Git Commits

| Hash | Message |
|------|---------|
| `612dd7b` | (see git log) |
| `29fcc46` | (see git log) |

### Status

[OK] **Completed**


## Session 13: Localize Canopy interface to Simplified Chinese

**Date**: 2026-08-12
**Task**: Localize Canopy interface to Simplified Chinese
**Branch**: `main`

### Summary

Localized 113 approved UI and error messages to Simplified Chinese, preserved IPC and machine error contracts, updated tests and specs, and verified 110 frontend plus 52 Rust tests.

### Git Commits

| Hash | Message |
|------|---------|
| `95b4cd4` | (see git log) |
| `011e905` | (see git log) |

### Status

[OK] **Completed**


## Session 14: Assistant Markdown rendering

**Date**: 2026-08-12
**Task**: Assistant Markdown rendering
**Branch**: `main`

### Summary

Added safe GFM rendering for durable and streaming assistant messages with Shiki code highlighting and Chinese copy controls; pinned Streamdown 2.4.0 to exclude Mermaid and documented the rendering trust boundary.

### Git Commits

| Hash | Message |
|------|---------|
| `192fde6` | (see git log) |
| `ac3464d` | (see git log) |

### Status

[OK] **Completed**


## Session 15: 优化大窗口右侧会话滚动

**Date**: 2026-08-15
**Task**: 优化大窗口右侧会话滚动
**Branch**: `main`

### Summary

通过 release A/B 定位并修复大窗口右侧会话滚动卡顿：移除标题栏 backdrop blur、消息阴影，并在 ConversationPane 滚动表面加入 [contain:paint]。最终用户确认接近 800x600 流畅度；保留行为不变，未接入虚拟化或新增 WebKit 运行时开关。ESLint、TypeScript、120 项 Vitest、Vite build 和 Tauri release build 全部通过。

### Git Commits

| Hash | Message |
|------|---------|
| `46164bf` | (see git log) |

### Status

[OK] **Completed**


## Session 16: 右侧对话区域消息气泡与极简输出风格改造

**Date**: 2026-08-15
**Task**: 右侧对话区域消息气泡与极简输出风格改造
**Branch**: `main`

### Summary

重构右侧会话区域消息展示风格：用户消息改为右对齐气泡（保留 bg-muted，移除'用户'文字），助手消息改为背景直出极简风格（无边框无卡片，移除'助手'文字，瞬态无缝显示），操作按钮悬停/聚焦显现，保留完整无障碍可访问性，新增单元测试并更新设计规范。

### Git Commits

| Hash | Message |
|------|---------|
| `0beb065` | (see git log) |

### Status

[OK] **Completed**


## Session 17: 优化 Composer 视觉样式为半透明磨砂质感与悬浮透出

**Date**: 2026-08-15
**Task**: 优化 Composer 视觉样式为半透明磨砂质感与悬浮透出
**Branch**: `main`

### Summary

重构输入框 Composer 布局为悬浮磨砂玻璃质感，移除硬通栏边框并支持滚动内容透出，修复中文输入法回车误提交与发送按钮垂直居中对齐

### Git Commits

| Hash | Message |
|------|---------|
| `75f7b5d` | (see git log) |

### Status

[OK] **Completed**


## Session 18: Composer generation controls and assistant regeneration

**Date**: 2026-08-15
**Task**: Composer generation controls and assistant regeneration
**Branch**: `main`

### Summary

Integrated Composer Send/Stop behavior, preserved editable drafts and keyboard semantics, moved generation/recovery actions into message context, added always-visible cancelled/failed recovery, and added final-assistant regeneration from its exact parent user. Added controlled provider settings opening, focused component/workspace tests, frontend spec contracts, and verified format/lint/typecheck/151 tests/build.

### Git Commits

| Hash | Message |
|------|---------|
| `0a38799` | (see git log) |

### Status

[OK] **Completed**


## Session 19: Simplify generation commit protocol

**Date**: 2026-08-15
**Task**: Simplify generation commit protocol
**Branch**: `main`

### Summary

Moved generation finalization and authoritative assistant persistence into the long-lived Rust command; removed the frontend acknowledgement handshake; aligned IPC schemas, store/controller behavior, recovery logic, tests, and executable specs. Full frontend and Rust quality gates passed.

### Git Commits

| Hash | Message |
|------|---------|
| `88067cc` | (see git log) |

### Status

[OK] **Completed**


## Session 20: Optimize new conversation button layout and sidebar hierarchy

**Date**: 2026-08-15
**Task**: Optimize new conversation button layout and sidebar hierarchy
**Branch**: `main`

### Summary

Added collapsed-sidebar quick new conversation entry to main header, toolbarized sidebar top bar with branding and unified SquarePen icon button with tooltips, established symmetrical section subheaders for History and OutlineTree, updated frontend component guidelines, and added full test coverage.

### Git Commits

| Hash | Message |
|------|---------|
| `631195b` | (see git log) |

### Status

[OK] **Completed**


## Session 21: Keep archive action visible during generation

**Date**: 2026-08-15
**Task**: Keep archive action visible during generation
**Branch**: `main`

### Summary

Changed the conversation archive button to remain visible during active generation while disabled with Chinese guidance. Added regression coverage for visibility, disabled behavior, and re-enabling after cancellation. Full tests, lint, and typecheck pass.

### Git Commits

| Hash | Message |
|------|---------|
| `bc3b539` | (see git log) |

### Status

[OK] **Completed**


## Session 22: History row archive button with confirm dialog

**Date**: 2026-08-16
**Task**: History row archive button with confirm dialog
**Branch**: `main`

### Summary

Moved the archive action from the workspace header to a hover-revealed icon button on each sidebar history row (sibling buttons, valid HTML). Archiving now requires an AlertDialog confirmation; confirming on the generating current conversation cancels the run first, while other rows archive by ID without disturbing it. Store archiveConversation gained targetId support with history-channel-only errors for non-current targets. History row titles switched to native title tooltips so the bubble no longer blocks the archive icon. Landed via PR #1 (merge 3698b64); spec updated with the generation-interruption / off-target-mutation contract.

### Git Commits

| Hash | Message |
|------|---------|
| `eb20651` | (see git log) |
| `45afd07` | (see git log) |
| `e2ab7ef` | (see git log) |

### Status

[OK] **Completed**


## Session 23: Flatten markdown block chrome and unify copy buttons

**Date**: 2026-08-16
**Task**: Flatten markdown block chrome and unify copy buttons
**Branch**: `main`

### Summary

Committed pending sidebar restyle (single scroll area, sticky section headers, row selection pills). Replaced streamdown double-card wrappers with lean single-card markup for code blocks (CSS via .assistant-markdown scope, no !important) and tables (LeanTable component). Added TableCopyDropdown to tables with zh translations. Pinned code copy button to language row (position:static via :has()), unified copy buttons to ghost style with 14px icons and 8px card spacing. All work split into 5 atomic commits, each verified (prettier/eslint/tsc/160 tests).

### Git Commits

| Hash | Message |
|------|---------|
| `6848a98` | (see git log) |
| `cf5dabc` | (see git log) |
| `137b6b1` | (see git log) |
| `1a8929f` | (see git log) |
| `cbfb716` | (see git log) |

### Status

[OK] **Completed**


## Session 24: 后台生成：跨会话切换与多路并发生成

**Date**: 2026-08-16
**Task**: 后台生成：跨会话切换与多路并发生成
**Branch**: `main`

### Summary

实现生成期间自由切换会话：store 单例 generation 重构为按会话键控的 GenerationRun 注册表（含 priorChildIds/parentPreview），事件守卫面向注册表、取消隐式取消与卸载取消；守卫放宽（切换/新建/同会话切节点放行，树变更按会话加锁）；切回强制回到生成路径并续显流式内容；后台完成/失败经 sonner toast 通知——因 sonner 2.x 无整卡点击 API，用 toast.custom 自定义可点击卡片（prompt 标题+回复预览截断、top-right、expand、官方配方面包），并补真实渲染集成测试防 mock 盲区；同步更新 state-management/hook-guidelines 规范。经验：取消/关闭从不持久化部分内容（后端契约）；toast mock 测试需配真实渲染层验证。

### Git Commits

| Hash | Message |
|------|---------|
| `6499828` | (see git log) |

### Status

[OK] **Completed**


## Session 25: 多 Provider 支持：提交、PR 与验收收尾

**Date**: 2026-08-17
**Task**: 多 Provider 支持：提交、PR 与验收收尾
**Branch**: `main`

### Summary

multi-provider 任务收尾：修复 tree_persistence 迁移目录断言（补 0006 provider_models）后全量验证转绿；按既定 3-commit 方案提交（backend+契约 fixtures / 前端 UI / 任务工件+spec）并合并 main——main 侧滚动回归测试适配 streaming 状态新增的必填 thinking 字段；cargo test 77 + clippy -D warnings + pnpm check（168 前端测试）全绿。发起 PR #3，G2 手动验收通过（旧库升级、双协议双会话、删除级联回退、模型列表失败兜底）后合并（9099c75），任务归档。经验：管道 tail/grep 会掩盖测试退出码，验证命令需显式回传 $?；分支落后 main 时先提交再合并，自动合并无冲突不等于类型层面兼容（本例 TS 必填字段）。

### Git Commits

| Hash | Message |
|------|---------|
| `92d5a99` | (see git log) |
| `f3f744c` | (see git log) |
| `5af255b` | (see git log) |

### Status

[OK] **Completed**


## Session 26: Settings dual-column dialog

**Date**: 2026-08-17
**Task**: Settings dual-column dialog
**Branch**: `main`

### Summary

Rebuilt global Settings into a dual-column list-detail dialog (category nav, breadcrumbs, provider CRUD polish), squash-merged as PR #6.

### Git Commits

| Hash | Message |
|------|---------|
| `9f6c781` | (see git log) |

### Status

[OK] **Completed**


## Session 27: 会话标题自动生成

**Date**: 2026-08-17
**Task**: 会话标题自动生成
**Branch**: `feat/auto-title`

### Summary

实现首轮回复后自动生成会话标题：默认开启开关、可选标题模型、独立 title_prompt（英文+转义防注入）、成对引号清洗、全局 title-updated 事件与设置「会话」页；落地于 feat/auto-title。

### Git Commits

| Hash | Message |
|------|---------|
| `b1e4d4d` | (see git log) |

### Status

[OK] **Completed**


## Session 28: 会话标题自动生成：spec 收尾

**Date**: 2026-08-18
**Task**: 会话标题自动生成：spec 收尾
**Branch**: `feat/auto-title`

### Summary

自动标题任务收尾：写入 GenerationRuntime 外的标题路径、全局 title-updated 解码，以及 Switch/Select/无句号 helptext 约定；设置 UI 已用官方 Switch 与分组 Select。任务此前已归档。

### Main Changes

- Spec：auto-title 不走 GenerationRuntime；conversation://title-updated 先 Zod 再 applyTitleUpdate
- Spec：app_settings auto_generate_title / title_model_binding；prompt 转义；成对引号清洗
- Spec：ReUI 注册表、官方 Switch、分组 Select、FieldDescription 无句号

### Git Commits

| Hash | Message |
|------|---------|
| `4394a82` | (see git log) |
| `594b7d1` | (see git log) |
| `c07181e` | (see git log) |

### Testing

- [OK] 未重跑产品测试；本轮仅 spec

### Status

[OK] **Completed**

### Next Steps

- 确认后推送 feat/auto-title 并更新 PR #8


## Session 29: Extract settings feature and rename SettingsDialog

**Date**: 2026-08-18
**Task**: Extract settings feature and rename SettingsDialog
**Branch**: `feat/extract-settings-feature`

### Summary

Moved GlobalSettingsDialog out of features/providers into a new features/settings module. SettingsDialog now owns dialog chrome and category navigation; ProviderSettingsPanel/List/Editor own provider-specific state; ConversationSettingsPanel lives under settings with no conversations dependency. Migrated all 16 existing behavior tests plus added regressions for store errors, controlled/uncontrolled open, reopen reset, secret cleanup, and stale API-key reveal guard. 191/191 tests pass, pnpm check green. Updated frontend spec docs for new ownership boundary.

### Git Commits

| Hash | Message |
|------|---------|
| `9be55e9` | (see git log) |

### Status

[OK] **Completed**


## Session 30: 标题生成快速包：角色分离 + 预算修复 + prompt/清洗强化

**Date**: 2026-08-22
**Task**: 标题生成快速包：角色分离 + 预算修复 + prompt/清洗强化
**Branch**: `feat/title-improvements`

### Summary

调研 Open WebUI/LibreChat/NextChat/LobeChat 后落地候选 1+4+6+5：build_title_prompt 改为 TitlePrompt{system,user} 两协议角色分离；max_tokens 60→256 且 OpenAI-compatible 带 reasoning_effort=low（修思考型模型静默失败）；system prompt 加 few-shot/风格压制/符号禁令；clean_title 增加一次性 Title:/标题： 前缀剥离。88 测试全绿，clippy 干净，主对话路径零改动；provider-guidelines.md Auto-Title 契约已同步。候选 2(重试+migration)/3(寒暄兜底)/7(埋点细分) 留待后续。

### Git Commits

| Hash | Message |
|------|---------|
| `e3ad5d0` | (see git log) |
| `bd032b4` | (see git log) |
| `5be9aaf` | (see git log) |

### Status

[OK] **Completed**


## Session 31: DeepSeek v4 标题思考禁用修复收尾归档

**Date**: 2026-08-22
**Task**: DeepSeek v4 标题思考禁用修复收尾归档
**Branch**: `main`

### Summary

确认 08-22-title-thinking-disabled 工作已随 PR #13 合并 main(显式 thinking:{type:disabled} 修复 DeepSeek v4 标题静默失败),分支与 worktree 此前已清理,本次补跑 finish-work:归档任务至 archive/2026-08 并记录 journal。

### Git Commits

| Hash | Message |
|------|---------|
| `7d6fa8d` | (see git log) |

### Status

[OK] **Completed**


## Session 32: 窗口 1200×800 默认值与位置持久化

**Date**: 2026-08-22
**Task**: 窗口 1200×800 默认值与位置持久化
**Branch**: `main`

### Summary

worktree 流程完成窗口状态任务:默认窗口 800×600→1200×800(逻辑像素),新增 minWidth/minHeight 768×480 与 center;接入 tauri-plugin-window-state 2.4.1(Rust-only 注册)从第二次启动恢复大小/位置/最大化。cargo test 全绿、clippy -D warnings 通过。PR #14 已合并(cb096d3)。网络插曲:github SSH 22/443 全挂,经 gh HTTPS credential helper 完成推送,已记入记忆。

### Git Commits

| Hash | Message |
|------|---------|
| `4f687a3` | (see git log) |

### Status

[OK] **Completed**


## Session 33: i18n support: zh-CN + en typed-dictionary UI localization

**Date**: 2026-08-23
**Task**: i18n support: zh-CN + en typed-dictionary UI localization
**Branch**: `feat/i18n`

### Summary

Planned and implemented full i18n support (task 08-22-i18n) in worktree canopy-i18n on feat/i18n: zero-dependency typed dictionary core (src/lib/i18n, 178 keys x zh-CN/en, compile-time key checks), language preference IPC (set_language + list_providers.language via app_settings kv, shared fixture both sides), error display routed to commandErrorMessage(code) instead of backend message, all ~24 components migrated, General settings panel (default category, Settings2 icon after user feedback), startup hydration + html lang sync. Specs updated: new frontend/i18n-guidelines.md; single-locale and zh-message-render clauses revised. Gates: pnpm check EXIT=0 (24 files/223 tests), cargo test/clippy/fmt clean. GUI manual acceptance pending; PR to main not yet created.

### Git Commits

| Hash | Message |
|------|---------|
| `92f3dc4` | (see git log) |
| `91e7ec6` | (see git log) |
| `9eec50a` | (see git log) |
| `3bfab43` | (see git log) |
| `2a68497` | (see git log) |
| `fa0b2fd` | (see git log) |
| `3c1da83` | (see git log) |

### Status

[OK] **Completed**


## Session 36: Conversation rename, delete & unarchive

**Date**: 2026-08-23
**Task**: Conversation rename, delete & unarchive
**Branch**: `feat/conversation-manage`

### Summary

新增 rename/delete/unarchive 三个会话 IPC 命令（契约 9→12 同组变更）；删除与取消归档采用事务内 trigger DROP/原文重建模式（nodes_reject_delete / conversations_archive_forward_only），测试守护保护完整性；侧栏行改「…」下拉菜单（重命名/归档↔取消归档/删除），重命名 Dialog+校验，删除确认框+运行中断提示，删除当前会话回空态新对话；spec 更新 guarded trigger-lifted mutations 约定与命令数同步提醒

### Git Commits

| Hash | Message |
|------|---------|
| `47d3e7b` | (see git log) |
| `83bf690` | (see git log) |
| `9628025` | (see git log) |
| `f9edbe4` | (see git log) |

### Status

[OK] **Completed**


## Session 34: 对话导出功能

**Date**: 2026-08-23
**Task**: 对话导出功能
**Branch**: `feat/conversation-export`

### Summary

完成按助手消息前缀导出 Markdown：补齐保存对话框与文件写入 IPC、前端导出纯函数/store/UI、双语文案及契约测试；记录 Tauri capability 配置规范，并通过前端全量检查、Rust 测试与 Clippy。

### Git Commits

| Hash | Message |
|------|---------|
| `f954182` | (see git log) |
| `4144b81` | (see git log) |

### Status

[OK] **Completed**


## Session 35: Finish conversation search

**Date**: 2026-08-23
**Task**: Finish conversation search
**Branch**: `feat/search`

### Summary

Hardened search matching, result limits, reveal scrolling, stale-query handling, response validation, and regression coverage; all frontend and Rust quality gates passed.

### Git Commits

| Hash | Message |
|------|---------|
| `a20da0e` | (see git log) |

### Status

[OK] **Completed**


## Session 37: Mind-map double-click opens conversation pane

**Date**: 2026-08-24
**Task**: Mind-map double-click opens conversation pane
**Branch**: `feat/mindmap-view`

### Summary

Double-clicking a mind-map node card now switches to the conversation pane, activates that branch, and scrolls to the clicked message. A later container-transform overlay was discarded before shipping. Task 08-23-mindmap-view archived; feat/mindmap-view pushed.

### Main Changes

- Double-click a mind-map node card to leave the canvas, select the branch through that node, and reveal the message
- Discarded the in-progress card-to-fullscreen FLIP overlay so only the double-click navigation shipped

### Git Commits

| Hash | Message |
|------|---------|
| `4c9f59f` | (see git log) |

### Testing

- [OK] MindMapCanvas and ConversationWorkspace tests for double-click navigation; pnpm check on the landed commit

### Status

[OK] **Completed**

### Next Steps

- Open a PR for feat/mindmap-view against main


## Session 38: Add Dark Mode Support and Appearance Settings Category

**Date**: 2026-08-24
**Task**: Add Dark Mode Support and Appearance Settings Category
**Branch**: `feat/dark-mode`

### Summary

Implemented dark mode support with SQLite settings persistence, frontend theme store with system media query listener, dedicated Appearance settings category in SettingsDialog, and MindMap ReactFlow color mode integration. All unit/integration tests and quality gates passed.

### Git Commits

| Hash | Message |
|------|---------|
| `9307240` | (see git log) |

### Status

[OK] **Completed**


## Session 39: Focus branch creation in Composer

**Date**: 2026-08-25
**Task**: Focus branch creation in Composer
**Branch**: `main`

### Summary

Moved assistant branch input into the persistent Composer, preserving visible messages and drafts; added focus, retry, conversation-switch lifecycle coverage, and updated frontend component contracts.

### Git Commits

| Hash | Message |
|------|---------|
| `ee3056f` | (see git log) |

### Status

[OK] **Completed**


## Session 40: Show pending branch origin marker

**Date**: 2026-08-25
**Task**: Show pending branch origin marker
**Branch**: `main`

### Summary

Truncated the rendered conversation path at a pending branch origin, added a localized shadcn Marker separator with GitBranch icon, preserved durable tree state and drafts, and cleared stale intent on tree navigation.

### Git Commits

| Hash | Message |
|------|---------|
| `f5c555f` | (see git log) |

### Status

[OK] **Completed**


## Session 41: 移除侧栏会话树

**Date**: 2026-08-25
**Task**: 移除侧栏会话树
**Branch**: `main`

### Summary

移除会话工作区侧栏 OutlineTree，保留历史与操作入口，统一由思维导图查看会话树；同步中英文侧栏文案、组件测试和前端 selector 规范。前端 334 项测试、TypeScript、Lint、构建及 Rust command_boundary 4 项测试通过。

### Git Commits

| Hash | Message |
|------|---------|
| `9798b35` | (see git log) |
| `e81b15c` | (see git log) |

### Status

[OK] **Completed**


## Session 42: 统一中文文案为「对话」

**Date**: 2026-08-25
**Task**: 统一中文文案为「对话」
**Branch**: `main`

### Summary

将面向用户的简体中文文案统一由「会话」优化为更自然的「对话」，并同步更新后端错误文案与全量测试用例。

### Git Commits

| Hash | Message |
|------|---------|
| `06d13af` | (see git log) |

### Status

[OK] **Completed**


## Session 43: 分支消息提交后自动生成

**Date**: 2026-08-25
**Task**: 分支消息提交后自动生成
**Branch**: `main`

### Summary

统一分支 Composer 交互：从助手创建分支、编辑用户消息为分支后，权威用户节点持久化成功即自动启动一次精确回复生成；补充控制器与工作区回归测试，更新前端状态规范。通过完整 Vitest（336 tests）、lint、typecheck 与生产构建。

### Git Commits

| Hash | Message |
|------|---------|
| `ce132ce` | (see git log) |

### Status

[OK] **Completed**


## Session 44: Conversation Panorama terminology refactor

**Date**: 2026-08-25
**Task**: Conversation Panorama terminology refactor
**Branch**: `main`

### Summary

Renamed the conversation mind-map view to Conversation Panorama across the internal workspace view route, components, layout modules, typed i18n keys, tests, and frontend guidelines. Preserved React Flow interactions and validated with 336 frontend tests, lint, typecheck, Prettier, and production build.

### Git Commits

| Hash | Message |
|------|---------|
| `9ac9926` | (see git log) |

### Status

[OK] **Completed**


## Session 45: Refine composer copy and branch placeholder

**Date**: 2026-08-25
**Task**: Refine composer copy and branch placeholder
**Branch**: `main`

### Summary

Optimized composer placeholders and workspace hints, fixed branch mode placeholder bug, updated test assertions, and passed full test suite.

### Git Commits

| Hash | Message |
|------|---------|
| `565533f` | (see git log) |

### Status

[OK] **Completed**


## Session 46: Optimize font stack with Geist Mono and CJK fallbacks

**Date**: 2026-08-25
**Task**: Optimize font stack with Geist Mono and CJK fallbacks
**Branch**: `main`

### Summary

Installed @fontsource-variable/geist-mono, configured cross-platform CJK font fallbacks for --font-sans and --font-mono, and enabled global antialiasing

### Git Commits

| Hash | Message |
|------|---------|
| `45ef153` | (see git log) |

### Status

[OK] **Completed**


## Session 47: Assistant markdown remote images

**Date**: 2026-08-26
**Task**: Assistant markdown remote images
**Branch**: `main`

### Summary

Allowed http(s) Markdown images in assistant messages with SafeImage, no-referrer, and Tauri CSP img-src; blocked unsafe schemes; updated tests and component guidelines.

### Git Commits

| Hash | Message |
|------|---------|
| `4b31ca3` | (see git log) |

### Status

[OK] **Completed**


## Session 48: Manual check for updates

**Date**: 2026-08-26
**Task**: Manual check for updates
**Branch**: `main`

### Summary

Shipped settings-based manual update check via GitHub Releases API: version display, four result states, opener to releases/latest, CSP connect-src for api.github.com; PRD ACs met; task left in_progress until this cleanup archive.

### Git Commits

| Hash | Message |
|------|---------|
| `b7286bd` | (see git log) |

### Status

[OK] **Completed**


## Session 49: 后端模块边界重构

**Date**: 2026-08-27
**Task**: 后端模块边界重构
**Branch**: `main`

### Summary

完成后端模块边界重构：platform→infra、settings/llm/generation/conversations 边界隔离，冻结契约与 SQL owner 文档，PR #22 已合并。

### Git Commits

| Hash | Message |
|------|---------|
| `de3416e` | (see git log) |
| `a9e2f81` | (see git log) |
| `9f1b87b` | (see git log) |
| `657d0f9` | (see git log) |
| `af8d791` | (see git log) |
| `ed4e129` | (see git log) |
| `2f83cfc` | (see git log) |
| `1076658` | (see git log) |
| `82234d4` | (see git log) |
| `c6a8b57` | (see git log) |
| `39e4d9f` | (see git log) |

### Status

[OK] **Completed**


## Session 50: v0.4.0 released DB upgrade harness

**Date**: 2026-08-27
**Task**: v0.4.0 released DB upgrade harness
**Branch**: `fix/backend-residuals`

### Summary

Planned backend residuals tree; implemented shared register_sql_plugin, v0.4.0 fixture, and real Tauri SQL plugin upgrade harness; recorded harness contracts in backend specs; archived the harness child task.

### Git Commits

| Hash | Message |
|------|---------|
| `b4b28bc` | (see git log) |
| `c87f8de` | (see git log) |

### Status

[OK] **Completed**


## Session 51: Provider delete binding integrity

**Date**: 2026-08-27
**Task**: Provider delete binding integrity
**Branch**: `fix/backend-residuals`

### Summary

Implemented migration 0007 to clear orphan conversation models and BEFORE DELETE trigger for paired provider_id/model clears; updated regressions and backend specs; archived cleanup-stale-provider-binding.

### Git Commits

| Hash | Message |
|------|---------|
| `d8a955b` | (see git log) |
| `5a57d5b` | (see git log) |

### Status

[OK] **Completed**


## Session 52: Decouple export from managed database

**Date**: 2026-08-27
**Task**: Decouple export from managed database
**Branch**: `fix/backend-residuals`

### Summary

Removed write_export_file managed-DB preflight; export succeeds with empty DbInstances; updated backend specs; archived decouple-export-database.

### Git Commits

| Hash | Message |
|------|---------|
| `ae53834` | (see git log) |
| `80531e0` | (see git log) |

### Status

[OK] **Completed**


## Session 53: Backend residuals tree complete

**Date**: 2026-08-27
**Task**: Backend residuals tree complete
**Branch**: `fix/backend-residuals`

### Summary

Closed the backend residuals parent: harness, provider-binding migration 0007, and export DB decoupling all landed on fix/backend-residuals; final integration gates passed; parent archived.

### Git Commits

| Hash | Message |
|------|---------|
| `b4b28bc` | (see git log) |
| `c87f8de` | (see git log) |
| `d8a955b` | (see git log) |
| `5a57d5b` | (see git log) |
| `ae53834` | (see git log) |
| `80531e0` | (see git log) |

### Status

[OK] **Completed**


## Session 54: Panorama branch-from-here action bar

**Date**: 2026-08-29
**Task**: Panorama branch-from-here action bar
**Branch**: `feat/panorama-branch-button`

### Summary

Added the branch-from-here action to panorama node cards in worktree canopy-panorama-branch (feat/panorama-branch-button): PanoramaNodeData gained an onCreateBranch callback (null hides the affordance), the workspace reuses handleStartBranch (now useCallback, returns success) with selectNode + deferred composer focus after the canvas closes, and the action renders as a hover-revealed bar floating below branchable assistant cards. A context-menu variant and two geometry/tooltip fixes were tried and discarded by user decision; final form is the hover bar. Full check green (format/lint/typecheck/367 tests/build).

### Git Commits

| Hash | Message |
|------|---------|
| `c18d518` | (see git log) |
| `424264a` | (see git log) |

### Status

[OK] **Completed**


## Session 55: Provider presets (B+ dual entry)

**Date**: 2026-08-30
**Task**: Provider presets (B+ dual entry)
**Branch**: `feat/provider-presets`

### Summary

Planned and implemented mainstream vendor presets for new providers: static presets.ts catalog (9 vendors), B+ dual entry (list New dropdown with chevron + editor preset selector), i18n zh-CN/en, and ProviderSettingsPanel tests. Dropped endpoint normalization WIP; opened draft PR #26 on feat/provider-presets.

### Git Commits

| Hash | Message |
|------|---------|
| `4bf4fe1` | (see git log) |

### Status

[OK] **Completed**


## Session 56: 线性视图分支切换器

**Date**: 2026-08-30
**Task**: 线性视图分支切换器
**Branch**: `main`

### Summary

规划并实现在 ConversationPane 的 ‹ i/n › 分支切换器：siblingBranchInfo + BranchSwitcher 组件，复用 selectBranchAtNode；样式与操作栏对齐（size-7、Tooltip、外边缘分页器）；pnpm check 通过，PR #27 已合并。

### Git Commits

| Hash | Message |
|------|---------|
| `1eb57f4` | (see git log) |
| `bca0dd8` | (see git log) |

### Status

[OK] **Completed**


## Session 57: React render hot-path performance

**Date**: 2026-08-30
**Task**: React render hot-path performance
**Branch**: `perf/react-render-hot-path`

### Summary

Stabilized selectActivePath cache, split workspace streaming subscriptions into WorkspaceStreamingLayer, memoized MessageNode/AssistantMarkdown, isolated App theme sync. pnpm check: 384 tests passed.

### Git Commits

| Hash | Message |
|------|---------|
| `57c3bc4` | (see git log) |

### Status

[OK] **Completed**


## Session 58: Memoize message nodes — streaming rerender verification

**Date**: 2026-08-30
**Task**: Memoize message nodes — streaming rerender verification
**Branch**: `perf/react-render-hot-path`

### Summary

Completed step 3 of render hot-path work on perf/react-render-hot-path: added messageNodeRenderProbe, integration test proving durable path MessageNodes skip rerenders on generation deltas, stabilized WorkspaceStreamingLayer action objects with useMemo (including archived/read-only guard fix from review).

### Git Commits

| Hash | Message |
|------|---------|
| `23e1071` | (see git log) |

### Status

[OK] **Completed**


## Session 59: 系统提示词功能

**Date**: 2026-08-30
**Task**: 系统提示词功能
**Branch**: `feat/system-prompt`

### Summary

在 feat/system-prompt 落地全局默认 + 每对话覆盖的系统提示词：迁移 0008、生成时按对话>全局>无注入、设置面板与对话设置对话框、IPC/store/i18n 全链路；spec 记录契约。全景不体现、无预置提示词。

### Git Commits

| Hash | Message |
|------|---------|
| `7e8f12f` | (see git log) |
| `7c3cef6` | (see git log) |

### Status

[OK] **Completed**


## Session 60: 全景视图用户节点删除

**Date**: 2026-08-31
**Task**: 全景视图用户节点删除
**Branch**: `feat/message-delete`

### Summary

实现全景视图用户节点删除：新增 delete_conversation_node IPC、store 子树同步、确认框 UI 与用户向文案；创建 Draft PR #30。

### Git Commits

| Hash | Message |
|------|---------|
| `bfacd94` | (see git log) |

### Status

[OK] **Completed**


## Session 61: Settings: theme ToggleGroup and archived panel redesign

**Date**: 2026-09-02
**Task**: Settings: theme ToggleGroup and archived panel redesign
**Branch**: `main`

### Summary

Replaced appearance theme Select with shadcn ToggleGroup. Redesigned archived conversations panel to open rows with visible unarchive button; rename/delete stay in overflow menu. Filled PRD and archived the panel-redesign task.

### Git Commits

| Hash | Message |
|------|---------|
| `cf734ee` | (see git log) |
| `da1f74a` | (see git log) |

### Status

[OK] **Completed**


## Session 62: Add configurable theme color

**Date**: 2026-09-02
**Task**: Add configurable theme color
**Branch**: `feat/theme-color-setting`

### Summary

Added a persisted seven-color shadcn primary selector to Appearance settings, including Tauri/SQLite contracts, frontend hydration, accessible swatches, bilingual labels, cross-layer tests, and updated Trellis specifications.

### Git Commits

| Hash | Message |
|------|---------|
| `4f71ca2` | (see git log) |

### Status

[OK] **Completed**


## Session 63: Preserve scroll during streaming

**Date**: 2026-09-02
**Task**: Preserve scroll during streaming
**Branch**: `fix/preserve-scroll-during-stream`

### Summary

Replaced ConversationPane's forced bottom-scroll with MessageScroller live-edge following, a localized jump-to-latest control, and spec contracts so streaming deltas no longer yank a user reading earlier messages.

### Git Commits

| Hash | Message |
|------|---------|
| `97d273b` | (see git log) |
| `9f61dbe` | (see git log) |

### Status

[OK] **Completed**
