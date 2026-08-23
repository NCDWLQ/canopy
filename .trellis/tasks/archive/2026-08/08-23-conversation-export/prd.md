# 对话导出功能

## Goal

让用户把一段对话以 Markdown 文件的形式从 Canopy 带出去，用于存档、分享或在其他工具中继续处理。导出以某条助手消息为锚点：导出「根节点 → 该消息」的对话前缀，所见即所选。

## 背景（代码库证据，详见 research/codebase-current-state.md）

- 对话是树结构，界面可见聊天 = 激活路径（root→leaf，root 即首条 user 消息，路径 user/assistant 交替）。
- 消息正文：assistant 为原始 Markdown，user 为纯文本；thinking 存于 `metadata.thinking`；无图片/附件。
- 现状仅有单条消息剪贴板复制；无文件保存对话框、无 dialog/fs 插件（capabilities 仅 `core:default`）。
- 激活路径在前端 store 中已含每条消息完整 `content`（`PathMessageView`），前端组装导出文本无需新读路径。
- 导出为纯读 + 一次文件写，节点不可变，无迁移。

## 关键决策记录

- D1（2026-08-23）导出形态：仅「保存 Markdown 文件」（系统保存对话框 + .md）。剪贴板整段复制、JSON 结构化导出不做。
- D2（2026-08-23）导出范围：以锚点消息为界——从根节点到该助手消息的路径前缀；不含分支、不含锚点之后的内容。
- D3（2026-08-23）导出内容：仅消息正文（user/assistant）。不含 thinking、模型名、时间戳。
- D4（2026-08-23）UI 入口：仅助手消息气泡 action 栏（hover 图标按钮，样式沿用现有 copy/regenerate 按钮）。

## Requirements

- R1 入口：助手消息气泡 action 栏新增导出图标按钮（ghost icon 样式，`title`/`aria-label` 走 i18n）；user 消息不出现。
- R2 范围：点击后导出激活路径中「根 → 该消息」前缀的全部 user/assistant 消息正文（防御性过滤仅保留 user/assistant 角色）。
- R3 保存：弹出系统保存对话框，默认文件名 = 对话标题（清理文件系统非法字符，空则回退默认名），过滤器为 `.md`；确认后写入 UTF-8 Markdown 文件。
- R4 文件格式：`# 标题` 开头，随后按顺序以 `## <角色标签>` + 消息正文呈现；角色标签随应用语言（zh-CN/en）。
- R5 生成中禁用：该对话正在流式生成时导出按钮禁用，防止导出未落库的流式内容。
- R6 取消与失败：保存对话框取消 = 无任何副作用；写文件失败按现有错误信封（`CommandError`→`UiError`）提示，zh/en 双语。
- R7 i18n：所有新 UI 字符串同时落 `zh-CN.ts`（真源）与 `en.ts`；消息正文与标题内容不翻译。

## Acceptance Criteria

- [ ] AC1 助手消息 hover 出现导出按钮（title 可读），user 消息无此按钮（R1）。
- [ ] AC2 点击后出现系统保存对话框，默认文件名为对话标题（已清理非法字符），类型过滤器 `.md`（R3）。
- [ ] AC3 保存的文件内容 = H1 标题 + 根→锚点消息的 user/assistant 正文序列，角色标题随语言（R2/R4）。
- [ ] AC4 文件不含 thinking、模型名、时间戳、锚点之后的消息、任何分支内容（D2/D3）。
- [ ] AC5 对话生成中导出按钮禁用；生成结束恢复可用（R5）。
- [ ] AC6 取消保存对话框后无文件写入、无 toast；写失败出现错误提示（R6）。
- [ ] AC7 `pnpm check` 与 `cargo test` 全绿；新增 IPC 命令进入 contract fixture（R3/R6 的实现约束）。

## Out of Scope

- 剪贴板整段对话复制；JSON 结构化导出（候选后续）。
- 全树/分支导出；锚点之后内容的导出；user 消息气泡入口。
- 批量/多对话导出；导出历史管理。
- user 正文在 Markdown 查看器中的语义保真（按原文插入，接受其他查看器将其解释为 Markdown）。

## 技术要点（细节见 design.md）

- 新增 `tauri-plugin-dialog`（JS `save()` API + Rust 侧 init + capability `dialog:allow-save`）。
- 新增 Rust 命令 `write_export_file({ path, content })`：文件写入仅在 Rust 侧完成，webview 不获得直接 fs 能力（沿用 "SQL remains Rust-only" 的最小 capability 原则）。
- Markdown 组装为前端纯函数（便于 vitest），数据取自 store 已加载的激活路径。

## Open Questions

（无——规划阻塞项已全部收敛）
