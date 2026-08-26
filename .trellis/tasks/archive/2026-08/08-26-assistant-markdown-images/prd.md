# 允许助手消息 Markdown 图片渲染

## Goal

助手消息中的 `![alt](url)` 渲染为可见图片，而不是只显示 alt 文本。

## Background

- 渲染边界：`AssistantMarkdown`（Streamdown 2.4.0）+ `rehype-sanitize` / `rehype-harden`。
- 现状：`allowedImagePrefixes: []` + `img → ImageAltText`，测试断言无 `<img>`。
- 历史决策（`08-12-assistant-markdown-rendering` / component guidelines）为防追踪与危险协议故意禁图。
- Tauri CSP `img-src` 当前无 `http:`/`https:`，前端放行后仍需改 CSP 才能加载远程图。

## Requirements

- R1. 持久化与 streaming 助手消息对允许的 Markdown 图片渲染可见 `<img>`。
- R2. 未允许 URL 不发起加载；有 alt 时保留可读文本回退，不创建可加载 `img`。
- R3. 继续禁止 raw HTML / `dangerouslySetInnerHTML`；不启用图片下载控件。
- R4. 非助手角色仍为纯文本。
- R5. 更新测试与 `.trellis/spec/frontend/component-guidelines.md` 契约。
- R6. 允许绝对 `http:` / `https:` 图片，并放宽 CSP `img-src`。
- R7. 继续拦截 `data:` / `file:` / 相对路径及其它协议（Markdown 层不设 `allowDataImages`）。
- R8. MVP 不做点击打开、灯箱或自定义加载失败 UI；仅用消息宽度约束（如 `max-w-full`）。
- R9. 允许的 `<img>` 必须设置 `referrerPolicy="no-referrer"`，避免把对话页来源作为 Referer 发给图片主机。

## Out of Scope

- 用户 / 系统 / 工具消息的 Markdown 图片
- 本地附件、文件选择器作为图片源
- Mermaid / math / 其它 Streamdown 插件
- 图片缓存、代理、或其它超出 `no-referrer` 的隐私增强

## Acceptance Criteria

- [ ] AC1. `![说明](https://example.com/a.png)` 渲染为带正确 `src`/`alt` 的 `<img>`。
- [ ] AC2. `javascript:` / `file:` / `data:` / 相对路径不产生可加载 `img`；有 alt 时文本仍可见。
- [ ] AC3. raw HTML `<img>` / `<script>` 仍被拦截。
- [ ] AC4. streaming 与 static 行为一致。
- [ ] AC5. `AssistantMarkdown` 测试更新并通过；guideline 改为“允许安全远程图 / 拦截不安全图”。
- [ ] AC6. CSP `img-src` 包含 `http:` 与 `https:`，使远程图在 Tauri webview 可加载。
- [ ] AC7. 允许的 `<img>` 带 `referrerpolicy="no-referrer"`（React：`referrerPolicy="no-referrer"`）。

## Decisions

| ID | Decision |
|----|----------|
| D1 | 允许远程绝对 `http:` / `https:` 图片，并同步放宽 CSP |
| D2 | 继续拦截 `data:` / `file:` / 相对路径 / 其它协议 |
| D3 | MVP 无额外交互；仅安全渲染 + 宽度约束 |
| D4 | 图片使用 `referrerPolicy="no-referrer"` |

## Notes

- 复杂任务：需 `design.md` + `implement.md`；实现前须批准本规划摘要后再 `task.py start`。
