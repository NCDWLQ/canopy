# 深色模式（Dark Mode）与外观设置实现计划

## 实施清单

### 阶段 1：后端存储与 Tauri 命令
- [ ] 在 `src-tauri/src/providers/domain.rs` 中定义 `ThemePreference` 枚举及文本转换函数。
- [ ] 在 `src-tauri/src/providers/repository.rs` 中定义 `THEME_SETTING_KEY = "theme"`，实现读写 helper 函数。
- [ ] 在 `src-tauri/src/providers/service.rs` 中实现 `get_theme` 与 `set_theme` 方法，并在 `list_providers` 中读取 `theme`。
- [ ] 在 `src-tauri/src/providers/commands.rs` 中实现 `set_theme` 命令及 `SetThemeRequest` / `SetThemeResult`，在 `ListProvidersResult` 中加入 `theme` 字段，并在 `PROVIDER_COMMAND_NAMES` 注册 `"set_theme"`。
- [ ] 在 `src-tauri/src/lib.rs` 中注册 `set_theme` 处理器。
- [ ] 更新 `contract-fixtures/provider-ipc.json`，补充 `set_theme` 命令、请求及响应，并在 `list_providers` 成功载荷中添加 `theme`。
- [ ] 在 `src-tauri/tests/provider_profile.rs` 与 `src-tauri/tests/provider_contract.rs` 中添加/更新测试，验证 `cargo test` 通过。

### 阶段 2：前端 IPC 契约与 Schema 绑定
- [ ] 在 `src/lib/tauri/provider-schemas.ts` 中添加 `themePreferenceSchema = z.enum(["system", "light", "dark"])`，更新 `listProvidersResultSchema`、`setThemeRequestSchema`、`setThemeResultSchema`。
- [ ] 在 `src/lib/tauri/provider-client.ts` 与 `src/lib/tauri/types.ts` 中定义 `setTheme` 客户端方法及对应类型。
- [ ] 在 `src/lib/tauri/provider-client.test.ts` 中补充 `set_theme` 传输测试与 `listProviders` 解析断言。

### 阶段 3：前端 Theme 基础设施与 Store 水合
- [ ] 新建 `src/lib/theme/types.ts`、`src/lib/theme/resolve.ts`、`src/lib/theme/theme-store.ts`、`src/lib/theme/useTheme.ts` 与 `src/lib/theme/index.ts`。
- [ ] 编写 `src/lib/theme/resolve.test.ts` 与 `src/lib/theme/theme-store.test.ts`。
- [ ] 在 `src/features/providers/store/index.ts` 中扩充 `theme: ThemePreference` 状态、在 `loadProviders` 中水合、实现 `setTheme` action。
- [ ] 在 `src/features/providers/store/store.test.ts` 中补充水合与更新测试。

### 阶段 4：设置面板、字典与界面适配
- [ ] 在 `src/lib/i18n/locales/zh-CN.ts` 与 `src/lib/i18n/locales/en.ts` 中补充外观与主题相关键（`settings.dialog.appearanceCategory`、`settings.appearance.*`）。
- [ ] 新建 `src/features/settings/components/AppearanceSettingsPanel.tsx` 与其导出 `src/features/settings/components/index.ts`。
- [ ] 在 `src/features/settings/components/SettingsDialog.tsx` 中新增「外观」导航项与渲染分支。
- [ ] 编写 `src/features/settings/components/AppearanceSettingsPanel.test.tsx` 并更新 `SettingsDialog.test.tsx`。
- [ ] 在 `src/features/conversations/components/MindMapCanvas.tsx` 中将 `resolvedTheme` 接入 `<ReactFlow colorMode={resolvedTheme}>`。
- [ ] 在 `src/App.tsx` 中接入 `useThemeStore`，添加 `document.documentElement` class 同步与 `(prefers-color-scheme: dark)` 事件监听。
- [ ] 在 `src/App.test.tsx` 中补充主题同步与媒体查询响应测试。

### 阶段 5：全量验证与质量门禁
- [ ] 运行 `cargo test`。
- [ ] 运行 `pnpm check`（`prettier` / `eslint` / `tsc` / `vitest` / `vite build`）。
- [ ] 手动冒烟检查：验证设置对话框中的「外观」分类、在深色/浅色/系统跟随模式下的即时切换与持久化效果。

---

## 验证命令

```bash
# 后端测试
cargo test

# 前端全量质量检查（格式化、Lint、类型检查、单元测试、构建）
pnpm check
```
