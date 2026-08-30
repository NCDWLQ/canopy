# 新增提供商时提供主流厂商预设

## Goal

新建模型提供商时，提供主流厂商预设（名称、协议、base endpoint 预填），让用户只需补 API key、拉取/填写模型即可完成配置，省去查文档填 endpoint 的成本。

## Background / Confirmed Facts

- Provider 为自由配置档：`name / protocol / base_endpoint / model / models[] / apiKey`，协议仅 `openai_compatible | anthropic`（`src/features/providers/types/index.ts`）。
- 新建流程：Settings → 模型提供商 → 新建 → `ProviderSettingsEditor` 空白表单；现有「模板」仅 `emptyDraft()`（`ProviderSettingsEditor.tsx` L64-71）与按协议的 endpoint 占位符（L341-344）。
- 代码库中无任何厂商预设机制——纯前端绿地功能，后端 / SQLite / IPC 均无需改动。
- 表单已有「根据 draft endpoint + key 拉取模型列表」能力，预设预填 endpoint 后该按钮即可用。
- 厂商 endpoint 依据：
  - 既有调研 `.trellis/tasks/archive/2026-08/08-16-multi-provider/research/api-protocols.md`；
  - 2026-08-30 补充查证：GLM 双平台（`open.bigmodel.cn/api/paas/v4` 国内 / `api.z.ai/api/paas/v4` 国际，账号与计费不通用）；OpenCode Go 为 OpenAI 兼容，`https://opencode.ai/zen/go/v1`，Bearer 认证，`GET /models` 可用。

## Requirements

- R1: 双入口（B+ 方案）：
  - R1a: 列表页「新建」按钮改为下拉菜单（复用现有 `DropdownMenu`），第一项「自定义（空白）」，分隔线后列出全部预设厂商；选中后进入编辑器并预填。
  - R1b: 编辑器（仅新建模式）顶部保留「预设」选择器，可切换预设或切回自定义；编辑已有提供商时不显示。
- R2: 预设目录（前端静态数据 `src/features/providers/presets.ts`）首批包含 9 条：
  | 预设 | 协议 | base endpoint |
  |---|---|---|
  | OpenAI | openai_compatible | `https://api.openai.com/v1` |
  | Anthropic | anthropic | `https://api.anthropic.com` |
  | DeepSeek | openai_compatible | `https://api.deepseek.com/v1` |
  | Kimi（Moonshot） | openai_compatible | `https://api.moonshot.cn/v1` |
  | 智谱 GLM（bigmodel.cn） | openai_compatible | `https://open.bigmodel.cn/api/paas/v4` |
  | 智谱 GLM（z.ai） | openai_compatible | `https://api.z.ai/api/paas/v4` |
  | OpenRouter | openai_compatible | `https://openrouter.ai/api/v1` |
  | Gemini（OpenAI 兼容层） | openai_compatible | `https://generativelanguage.googleapis.com/v1beta/openai` |
  | OpenCode Go | openai_compatible | `https://opencode.ai/zen/go/v1` |
- R3: 选中预设后预填名称、协议、base endpoint；**不预填模型列表**（避免清单过期），用户填 key 后用现有「拉取模型」按钮或手动添加。
- R4: 预填后所有字段可自由修改；选择器保留「自定义」空白选项（即现有 `emptyDraft` 行为）。
- R5: 预设选择器文案、厂商显示名走 i18n（`zh-CN` / `en`）。

## Acceptance Criteria

- [ ] 列表页「新建」为下拉菜单：含「自定义（空白）」+ 9 个预设厂商；点「自定义」进入空白表单（行为与现状一致），点厂商进入预填表单。
- [ ] 编辑器新建模式顶部有「预设」选择器，可随时切换预设或切回自定义；编辑已有提供商时不显示。
- [ ] 选中任一预设后，名称/协议/base endpoint 正确预填（与 R2 表一致），且可继续编辑。
- [ ] 预填后仅补 API key + 拉取模型即可保存成功（走现有 `save_provider` 校验，无后端改动）。
- [ ] 切换预设/切回自定义时不丢失用户已输入的 API key。
- [ ] zh-CN 与 en 文案齐全，无硬编码字符串。

## Out of Scope

- 后端 / 数据库 schema / IPC 变更。
- 新增协议（Gemini 原生、Azure 等）。
- 预设内置模型清单、选中预设后自动拉取模型。
- 预设的在线更新 / 远程下发。
- Kimi 国际版（api.moonshot.ai）、DeepSeek Anthropic 面等变体预设（后续按需扩充）。

## Key Decisions

- D1（2026-08-30 用户确认）: 交互形态 = **预填现有表单**，不做一键快速添加、不做自动拉模型。
- D2（2026-08-30 用户确认）: 首批厂商 = OpenAI、Anthropic、DeepSeek、Kimi、GLM、OpenRouter、Gemini（OpenAI 兼容）、OpenCode Go；其中 GLM 经查证拆为 bigmodel.cn / z.ai 两个预设。
- D3（建议，待批准）: 预设不内置模型列表，依赖现有「拉取模型」按钮，避免模型清单过期。
- D4（2026-08-30 用户确认）: UI 入口 = **B+ 双入口**（列表页「新建」下拉 + 编辑器顶部预设选择器）。经四个交互原型对比后选定。
- D5（2026-08-30 用户确认）: 舍弃 endpoint 归一化 WIP（原 stash，已 drop）。预设直接发 canonical base endpoint，不依赖后端归一化。

## Risks / Deferred

- 厂商 endpoint 未来可能变动 → 预设集中在一个 `presets.ts`，单点维护。
- OpenCode Go 少数模型仅 Anthropic `/messages` 面，预设按 OpenAI 兼容配置，主流模型（GLM/Kimi/DeepSeek 等）不受影响。
- 无后端 endpoint 归一化容错：用户手动粘贴带 `/chat/completions` 等后缀的 URL 仍会报错（现状不变，本任务不处理）。
