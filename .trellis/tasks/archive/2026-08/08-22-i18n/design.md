# i18n 技术设计

> 需求见 `prd.md`，字符串级证据见 `research/ui-string-inventory.md`。

## 1. 总体方案：零依赖类型化词典

**不引入 i18next / react-intl / lingui**，在 `src/lib/i18n/` 自建约百行的核心：

- 规模仅 ~200 条 × 2 语言包，唯一复数场景 1 处，无日期/数字格式化需求；
- 项目风格是精简依赖 + 极致类型安全（spec：`satisfies`、闭合 union 不复制、strict TS）；
- i18next 的运行时配置、插件体系（detector/persist）与松散默认键类型在此规模下是净负担，其能力（命名空间、懒加载、ICU）没有对应需求。

**代价**：自维护插值与复数（`{name}` 占位 + 函数型词条）；无 ICU 生态。若未来出现复杂复数/性别语法需求再评估迁移。

## 2. 模块结构

```
src/lib/i18n/
  index.ts          # 公共出口：t、useTranslation、commandErrorMessage、类型
  types.ts          # SupportedLocale / LocalePreference / Dictionary 类型
  locale-store.ts   # zustand store：locale（UI 态，不 persist——持久化走后端）
  resolve.ts        # 系统检测 + 持久化偏好解析（纯函数，可测）
  locales/
    zh-CN.ts        # 中文词典（as const，键与函数签名 = 事实标准类型源）
    en.ts           # 英文词典（satisfies Dictionary，键缺失即编译错误）
  command-errors.ts # Record<CommandErrorCode, MessageKey> 错误文案映射
```

词典形态（扁平点分键，值为字符串或参数化函数）：

```ts
// locales/zh-CN.ts
export const zhCN = {
  "conversation.newConversation": "开始新会话",
  "settings.providers.deleteConfirm": ({ name }: { name: string }) => `删除「${name}」？`,
  "conversation.modelsSummaryMore": ({ head, remaining }: { head: string; remaining: number }) =>
    remaining === 1 ? ... : ...,   // 复数仅英文需要，函数词条天然承载
} as const
export type Dictionary = typeof zhCN

// locales/en.ts
export const en = { ... } satisfies Dictionary   // 键/参数形状错误即编译失败
```

`t` 双重载：静态键 `t(key)` 与参数键 `t(key, params)`，经条件类型从 `Dictionary` 推导键集合。组件经 `useTranslation()` 取 `t`（订阅 locale store，切换即重渲染）。

**类型安全推论**：新增语言包 = 新增一个 `satisfies Dictionary` 文件 + 注册；漏键/多键/参数不匹配都是编译错误，不需要运行时 fallback 链（未知 locale 兜底 zh-CN 仅防御存储脏数据）。

## 3. 语言状态与数据流

```
启动：
  store 初始 locale = resolveFromSystem(navigator.languages)   // zh* → zh-CN，否则 en
  渲染立即开始（用系统语言，无白屏）
  ↓ list_providers 水合（既有启动路径，响应新增 language 字段）
  language !== "system" 且解析结果 ≠ 当前 → setLocale(解析值)   // 仅显式偏好不同时闪一次

切换：
  设置面板 Select → set_language 命令（app_settings kv）→ 成功后 setLocale(store)
  → zustand 通知全部订阅组件重渲染 + effect 更新 document.documentElement.lang
```

- **存储**：`app_settings` 表新键 `language`，取值 `"system" | "zh-CN" | "en"`；缺键 = `"system"`（默认跟随系统）。无 schema migration（kv 表天然加键）。
- **不使用 localStorage**：遵循 spec「设置 round-trip 走 invoke」；代价是启动时依赖 `list_providers` 水合，若失败则停留在系统语言（可接受的优雅降级）。
- **首次启动闪烁**：仅当「显式偏好 ≠ 系统语言」时出现一次切换；不做启动阻塞（不为此延迟渲染）。

## 4. IPC 契约（复用 auto-title 先例）

- `list_providers` 响应新增 `language: "system" | "zh-CN" | "en"`（snake_case 不涉及，单字段字符串；默认 `"system"`）。`list_providers` 已是设置水合通道（`auto_generate_title` / `title_model_binding` 先例，见 spec frontend/type-safety.md Auto-Title 场景）。
- 新命令 `set_language`：请求 `{ request: { language } }`，返回存储值。与 `set_auto_generate_title`（`src-tauri/src/providers/commands.rs:337-345`）同构，走 `repository.rs:179-221` 的 kv helper。
- 前端 `src/lib/tauri/provider-schemas.ts` zod schema 扩展 + `provider-client.ts` 暴露 `setLanguage`；`contract-fixtures/provider-ipc.json` 同步（Rust/TS 共享 fixture 契约）。
- 设置 UI：`SettingsDialog` 导航新增「通用」分类，**排在导航第一位**（通用 / 模型提供商 / 会话；lucide `Settings2` 图标——2026-08-22 用户反馈调整，原设计 `Languages` 改为齿轮）。对话框打开时的默认板块为「通用」（2026-08-22 用户反馈调整，推翻原「保持模型提供商」的设计；`useState<SettingsCategory>` 初始值与 open 时 `setCategory` 重置均为 `"general"`）。`GeneralSettingsPanel`（语言 Select：跟随系统 / 简体中文 / English）复用 reui 设置控件模式（`ConversationSettingsPanel` 同款行布局）。语言为应用级设置，不并入「会话」板块；「通用」为未来应用级设置（主题/外观等）预留落点。

## 5. 后端错误消息映射

- `src/lib/i18n/command-errors.ts`：
  ```ts
  const map = { invalid_input: "errors.invalidInput", ... } satisfies Record<UiErrorCode, StaticMessageKey>
  commandErrorMessage(code): string  // 未知值兜底 errors.internal
  ```
  闭合 union 实际为 `src/lib/tauri/types.ts` 的 **`UiErrorCode`（11 个值）**（zod `commandErrorCodeSchema` 同集；Phase 1 已核实——error.rs 的 15 条中文消息收敛到 11 个 code，同 code 多消息在前端收敛为代表文案，机器码 `details` 保留差异信息）。类型从 `src/lib/tauri` 导入——**不在 i18n 层复制 union**（spec 禁止）。
- 渲染点改造：`ConversationPane.tsx:193` 错误横幅、`useWorkspaceGenerationController.ts` toast、两处 store 兜底与 client 兜底错误，从读 `error.message` 改为 `commandErrorMessage(error.code)`；`details` 机器码原样保留。
- `client.ts` 的 zod schema 与 wire 契约**零变化**（`message` 字段照常解析，只是不再用于展示）；Rust 端与 `lib.rs:164-171` 测试零改动。

## 6. 组件迁移策略

- 按 `research/ui-string-inventory.md` §3 清单逐文件迁移（重灾区先做：ConversationWorkspace → ProviderSettingsEditor → ProviderSettingsList → ConversationProviderPicker → MessageNode，其余收尾）。
- 3 个 shadcn 基础组件（dialog/breadcrumb/spinner）：改为接受可选文案 props（默认走 `t()`），保持 primitives 无强耦合。
- streamdown：`AssistantMarkdown.tsx` 的 `MARKDOWN_TRANSLATIONS` 改为从 `t()` 构造。
- aria-label / tooltip / 占位符 / 空态 / AlertDialog 全部走词典；插值模板改函数词条。

## 7. 测试策略

- **既有中文断言零改动**：测试 setup（`src/test`）显式固定 locale = zh-CN，组件渲染文本与现状逐字一致。
- 新增：`resolve.ts`（navigator mock、zh*/en 回退）、`t()`（静态/插值/复数/未知 locale 兜底）、`command-errors.ts`（16 个 code 全量 → 非空本地化文本）、设置面板 round-trip（fake client，断言 `set_language` 载荷）、切换语言重渲染 + `document.documentElement.lang`。
- Rust：repository kv 读写 round-trip、`set_language` 命令（镜像 auto-title 命令测试）；`lib.rs` 错误 JSON 测试不动。
- 门槛命令：`pnpm check`（format/lint/typecheck/test/build）+ `cargo fmt --check`（仅本任务触碰的文件）+ `cargo clippy` + `cargo test`。

## 8. 权衡与风险

| 决策 | 取舍 |
|---|---|
| 自建词典 vs i18next | 0 依赖 + 编译期键检查 vs 自维护 ~100 行；见 §1 |
| language 搭 `list_providers` vs 独立 `get_language` 命令 | 复用既有水合通道与 fixture vs 语义上语言非 provider 域；选前者（auto-title 先例），若实现中发现 `list_providers` 非启动必经路径则补一个独立读命令（实现期允许微调，回写本文件） |
| 启动闪烁 | 不阻塞渲染；仅显式偏好 ≠ 系统语言时闪一次 |
| 中文零回归 | zh 词典即现状字符串的机械搬运（验收标准之一：逐字一致） |

**回滚**：单分支任务，git revert 即可；`app_settings` 新键为加法，旧版本忽略多余 kv 行，无数据迁移风险。

**明确不做**：`MIGRATED_PROVIDER_NAME = "默认"`（存储数据，见 research §5）；原生窗口标题；RTL；日期格式化。
