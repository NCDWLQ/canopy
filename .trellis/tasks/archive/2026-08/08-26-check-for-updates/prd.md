# 开发检查更新功能

## Goal

让 Canopy 用户能够在桌面应用内确认当前版本是否有可用更新，并得到
清晰、可操作的结果反馈。

## Confirmed Facts

- 当前应用版本在 `package.json:4`、`src-tauri/Cargo.toml` 和
  `src-tauri/tauri.conf.json:4` 中均为 `0.3.1`。
- 发布工作流 `.github/workflows/release.yml:3-6` 使用 `v*` tag 触发，
  为 Linux x64、Windows x64、macOS Apple Silicon 和 macOS Intel 构建桌面安装包。
- 当前发布参数包含 `--no-sign`（`.github/workflows/release.yml:90-103`），
  仓库尚未配置 Tauri updater 插件、更新端点、签名公钥或更新权限。
- 设置对话框已有通用设置面板入口（`src/features/settings/components/SettingsDialog.tsx:31-142`），
  通用面板目前只包含语言设置（`src/features/settings/components/GeneralSettingsPanel.tsx:47-127`）。
- 前端遵循 typed-dictionary 双语 i18n；新增用户可见文本需要同时覆盖
  `zh-CN` 与 `en`（`.trellis/spec/frontend/i18n-guidelines.md`）。
- 已安装 `@tauri-apps/plugin-opener`，并在默认 capability 中授予了
  `opener:default`，现有 Markdown 链接已通过该插件打开外部网页。
- 仓库远端为 `https://github.com/NCDWLQ/canopy.git`；发布页可使用
  `https://github.com/NCDWLQ/canopy/releases/latest`，版本检查可使用公开的
  GitHub Releases API。

## Requirements

- 在现有设置体验中提供检查更新入口，并展示当前应用版本。
- 检查结果至少能区分：已是最新版本、发现可用新版本、检查失败。
- 检查过程中应有进行中状态，避免重复触发并给出可理解的完成反馈。
- 失败结果不得泄露原始网络或内部错误文本；应按现有错误展示约定提供本地化提示。
- 保持现有语言切换、设置面板布局和只读状态行为不回归。
- 更新检查使用 GitHub 正式发布版本作为来源，不将草稿或预发布版本误报为稳定更新。
- 发现新版本时提供打开正式发布页的操作；下载和安装由用户在系统浏览器中完成。

## In Scope

- 通用设置面板中的当前版本展示和“检查更新”操作。
- 调用公开 Releases API、校验响应、比较稳定 SemVer 版本并映射为有限的 UI 状态。
- “检查中”“已是最新”“发现新版本”“检查失败”四种状态的双语文案和可访问性标签。
- 通过现有 opener 能力打开固定的 GitHub 最新发布页。
- 前端单元/组件测试覆盖成功、无更新、新版本、无效响应、网络失败和重复点击。

## Out of Scope

- 后台自动检查、启动时检查、检查频率设置或通知中心提醒。
- Tauri updater 插件、更新包签名、公钥配置、静默下载和应用内安装/重启。
- 平台安装包代码签名、macOS notarization、Windows SmartScreen 信任建设。
- 预发布版本、测试渠道、自定义更新源或第三方更新服务器。

## Acceptance Criteria

- [x] 用户可从设置中的通用区域触发“检查更新”，并能看到当前版本号。
- [x] 检查进行时入口显示忙碌/禁用状态，不会并发发起重复检查。
- [x] 无新版本时显示本地化的“已是最新版本”结果。
- [x] 有新版本时显示版本号及下一步操作或明确的发布页面/安装包入口。
- [x] 网络、更新源不可用或响应无效时显示本地化失败提示，并允许再次检查。
- [x] `zh-CN` 和 `en` 下的新增文案、按钮、状态和可访问性标签均完整。
- [x] 版本 API 返回草稿/预发布/缺少合法 tag 时不会把错误数据展示为稳定更新。
- [x] 现有前端质量检查和相关设置测试通过。

## Technical Notes

- 当前版本从 Tauri app API 获取，避免在 UI 中重复维护版本常量；测试通过边界 mock 提供稳定版本。
- 更新检查逻辑放在 `src/lib/updates/`，负责请求 GitHub API、校验最小响应结构、解析稳定版本和统一错误；React 组件只消费 typed result，不直接访问网络。
- 由于应用 CSP 当前仅允许 `ipc:` 和 `http://ipc.localhost`，生产配置需要为公开 GitHub API 增加精确的 `connect-src https://api.github.com`；不授予任意网络源。
- “打开发布页”复用现有 `@tauri-apps/plugin-opener`，URL 固定为仓库的 `/releases/latest`，不把 API 返回的任意 URL 直接交给外部打开器。
- GitHub `latest` 发布接口天然排除草稿和预发布版本；客户端仍需对版本字段和响应结构做 fail-closed 校验。
