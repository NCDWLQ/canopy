# 优化右侧会话滚动合成

## Goal

修复 Canopy 在大窗口下滚动右侧会话面板时的明显卡顿，使 release 应用中滚轮、触控板和滚动条拖动都能保持接近默认窗口尺寸的流畅度，同时不改变会话、消息和生成行为。

## Background

- 默认窗口尺寸下右侧滚动正常；最大化或手动拉伸到接近屏幕大小后卡顿。把窗口缩回默认大小会立即恢复，因此问题跟随当前绘制面积，而不是操作系统最大化状态或 resize 后残留退化。
- 左侧历史记录和会话树滚动基本正常，问题集中在 `src/features/conversations/components/ConversationPane.tsx:157-208` 的右侧滚动表面。
- 纯文本消息与复杂 Markdown/代码消息同样复现，Streamdown、语法高亮和富文本复杂度不是必要条件。
- 滚轮/触控板与直接拖动原生滚动条滑块同样复现，输入事件频率和平滑滚动不是必要条件；瓶颈位于滚动后的绘制或合成。
- `tauri build --no-bundle` 生成的 release 二进制同样复现，Vite、HMR、Rust debug build 和开发者工具不是根因。
- 右侧标题栏在 `src/features/conversations/components/ConversationWorkspace.tsx:314` 使用半透明背景和 `backdrop-blur-sm`，但它是消息面板上方的普通布局兄弟而非覆盖内容的浮层，背景滤镜没有视觉必要性。
- 每条消息在 `src/features/conversations/components/MessageBubble.tsx:30-35` 使用 `shadow-sm`。滚动时这些阴影与边框属于右侧特有的重复绘制候选。
- 本机为 Arch Linux 7.1.8、Wayland、WebKitGTK 2.52.5、Tauri runtime-wry 2.11.4 / Wry 0.55.1，并检测到 NVIDIA RTX 4060。诊断进程无法证明 WebKit 实际采用的 GPU/DMABUF 路径；相关上游证据记录在 `research/webkitgtk-scroll-performance.md`。
- TanStack Virtual 能降低超长对话的 DOM/布局成本，但当前问题在简单纯文本与短内容中也成立，不能作为本缺陷的主修复。

## Requirements

1. 以 release 二进制的大窗口右侧滚动作为真实性能基准；开发浏览器或 jsdom 不能替代 WebKitGTK 手动验证。
2. 按独立、可回滚的 A/B 顺序隔离候选因素，每轮只改变一个绘制/合成变量并记录结果；一旦最小改动满足验收即停止扩张范围。
3. 第一优先级移除右侧标题栏无视觉价值的 `backdrop-filter` 和半透明背景，改为实色语义背景，不改变标题栏尺寸、结构、按钮或可访问性。
4. 若标题栏改动不足，单独验证消息 `shadow-sm`；只有证明确实改善 production 滚动时才移除或用低成本视觉分隔替代，并保留消息角色层级与边界可读性。
5. 若前两项仍不足，单独验证右侧滚动层的 CSS paint/layout containment 或滚动合成提示；不得盲目叠加 `will-change`、强制 transform 或额外合成层，因为它们可能增加显存和合成成本。
6. 仅在 CSS A/B 无法达到验收时，使用启动时环境变量对 WebKitGTK DMABUF/合成路径做外部诊断；不得把 `WEBKIT_DISABLE_DMABUF_RENDERER`、`WEBKIT_DISABLE_COMPOSITING_MODE` 或关闭硬件加速直接固化为默认产品行为，除非独立 A/B 证明收益且评估跨机器副作用。
7. 保持活动路径顺序、兄弟分支隔离、assistant Markdown、transient/持久化转换、编辑/分支、loading、错误、归档、生成、取消和恢复行为不变。
8. 不修改数据库、Tauri IPC、provider、DTO、Zustand shape、会话树规则或消息持久化格式。
9. 自动化测试保护产品行为和结构回归；WebKitGTK 帧表现通过 release A/B 手动验证并在任务记录中明确结果。

## Acceptance Criteria

- [x] release 二进制在大窗口下滚动右侧会话面板时，滚轮/触控板和滚动条滑块的内容更新都能持续跟随输入，不再出现当前明显的逐帧停顿，并且体验接近默认窗口尺寸。
- [x] 最终只保留经单变量 A/B 证明有效，或虽未单独改善但移除无视觉必要绘制且无回归的最小 CSS 改动；任务记录说明每个已测试候选是否有效。
- [ ] 标题栏、消息边界、角色层级、焦点状态和明暗主题仍清晰可用。
- [ ] 普通文本与 Markdown/代码消息都能正常显示和滚动。
- [ ] 活动路径顺序与兄弟分支排除、归档只读、编辑/分支和所有生成状态测试继续通过。
- [x] 不向默认启动环境写入未经跨场景验证的 WebKitGTK 禁用开关。
- [x] 直接运行仓库本地 ESLint、TypeScript、Vitest、Vite build 等价检查通过；沙箱中的 `pnpm` 因无法打开其数据库未能执行。

## Out of Scope

- 接入 `@tanstack/react-virtual`、`content-visibility` 或其他长列表虚拟化；这些属于独立的长对话容量优化。
- 虚拟化历史记录、会话树、设置窗口或 composer。
- 迁移到新的 shadcn chat primitives、重做消息视觉设计或添加“回到最新”等新交互。
- 修改 Linux 系统显卡驱动、Wayland compositor 或用户全局环境配置。
- 承诺一个跨所有 Linux GPU/桌面环境的固定 FPS 数字；本任务针对当前可复现环境修复并保留安全回滚路径。

## Technical Notes

- WebKitGTK Bug 305290 描述 resize 后滚动持续退化，但 Canopy 缩小窗口会立即恢复，因此仅作为相关背景，不作为当前主解释。
- WebKitGTK 默认请求硬件加速并不等于实际 GPU/DMABUF 路径可用；最终判断必须来自 production A/B，而不是配置推断。
- 任务目录 slug 保留原始 `virtualize-conversation-messages` 以维持 Trellis 会话引用，任务标题和交付范围已更新为滚动合成优化。
