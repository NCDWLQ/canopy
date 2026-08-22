# 窗口默认大小与位置持久化

## Goal

默认窗口 800×600 对聊天布局过小。首启默认改为 1200×800(逻辑像素)并加最小尺寸约束;接入 `tauri-plugin-window-state`,此后记住并恢复用户上次的窗口大小、位置与最大化状态。静态默认值只负责首启。

## Background(已确认事实)

- 现状(main @ 4938107):`src-tauri/tauri.conf.json:16-17` width 800 / height 600,无 minWidth/minHeight/center。
- 布局依据:侧栏 `w-64 md:w-80`(`ConversationWorkspace.tsx:329`,≥768px 视口时 320px);会话列与输入框上限 `max-w-4xl`(896px,`ConversationPane.tsx:216`)。完整布局需 320+896+边距 ≈ 1280px 视口;800 视口下内容区仅 ~480px,600 高对"消息流+输入框"也局促。
- tauri 2.11.3 → 插件取 2.x。插件纯 Rust 侧接入(注册即自动 save/restore,前端零调用),与 `capabilities/default.json`"SQL remains Rust-only"的姿态一致,无需新增权限条目。
- 插件状态存 app data dir(`window-state.json`),无敏感数据。Wayland 下位置恢复由合成器决定,尺寸/最大化恢复正常(用户环境 KDE Wayland)。
- 修正一点:早前讨论里说过 "minWidth 720 保证 ≥ md 断点",这是错的——Tailwind md 断点是 768px,720 仍会回落窄侧栏。minWidth 取 768。

## Requirements

- R1 `tauri.conf.json` windows[0]:width 1200、height 800、minWidth 768、minHeight 480、center true;`resizable: true`、`fullscreen: false` 保持不变。
- R2 `src-tauri/Cargo.toml` 新增 `tauri-plugin-window-state = "2"`;`src-tauri/src/lib.rs` 的 `app_builder()` 注册插件(默认 StateFlags,不动 main.rs 的 Linux 渲染器配置)。
- R3 capabilities 不变:无前端 JS 调用,不加 `window-state:*` 权限。
- R4 首启行为:无状态文件时按 R1 静态配置居中启动;有状态文件时以恢复值优先。

## Acceptance Criteria

- [ ] `cargo test` 全量全绿(含 `application_builder_is_constructible`,证明带新插件的 builder 可构造)。
- [ ] `cargo clippy --all-targets -- -D warnings` 通过;编辑过的文件 fmt-clean(遵循 main 上 fmt drift 的既有约定)。
- [ ] `tauri.conf.json` 通过 `generate_context!` 编译校验(即 cargo test 隐含)。
- [ ] 手动验证(交付说明中记录方法,不由 CI 保证):删 `~/.local/share/app.canopy.desktop/window-state.json` 后首启 → 1200×800 居中;调整大小/位置/最大化后重启 → 恢复。

## Out of Scope

- 多显示器拔除后的离屏位置钳制(插件默认行为,遇问题另开任务)
- 前端 JS API(`save_window_state` 等)与权限暴露
- 窗口装饰/主题类状态的自定义 StateFlags
