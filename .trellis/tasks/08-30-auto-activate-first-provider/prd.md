# 新装时首个提供商自动设为默认

## Goal

全新安装的用户在设置中添加第一个模型提供商后，无需再手动执行"设为默认"，即可直接开始对话生成。

## Background

当前全新安装的用户旅程：

1. 启动应用 → `providers` 为空、`active_provider_id` 不存在 → provider store `phase = "unconfigured"`
2. 用户通过 "Configure a provider" CTA 进入设置，添加并保存第一个提供商
3. 保存后 `active_provider_id` 仍为空（`phase = "idle"`），生成仍被禁用
4. 用户必须再在列表中点 ⋮ → "设为默认"，`phase` 才变为 `ready`

"添加第一个提供商"与"设为默认"在新装场景下 100% 重合，却要求用户操作两次，且第 4 步的入口（列表项菜单）并不显眼。

## Requirements

- 当用户保存一个**新**提供商、且保存前提供商列表为空（即这是首个提供商）时，系统自动将其设为全局默认提供商（写入 `active_provider_id`）。
- 以下场景行为**保持不变**：
    - 已有提供商时再添加新提供商：不自动切换默认（不覆盖用户已激活的选择，也不覆盖删除默认后的显式未配置状态）。
    - 编辑（更新）已有提供商：永不改变默认设置。
    - 删除当前默认提供商：清空 `active_provider_id`，不自动提升继任者（spec §8 既有规则）。
    - 从旧版单 profile 迁移时的种子逻辑（migration 0005）不变。
- IPC 命令表面保持冻结：`save_provider` 的签名与返回类型（`ProviderDto`）不变；自动激活是服务层内部行为。
- 前端 provider store 在保存首个提供商后正确反映新的 `activeProviderId`（`phase` 变为 `ready`），无需用户手动刷新或重开设置。
- 设置 UI 中"设为默认"入口保留，用于多提供商间切换。

## Non-goals

- 首次运行引导向导（onboarding wizard）——后续独立任务。
- 生成时的"单提供商回退"（无默认时隐式使用唯一提供商）。
- 多提供商场景下的任何默认切换策略变化。

## Acceptance Criteria

- [ ] 全新数据库（无提供商、无 `active_provider_id`）下保存第一个提供商后，`list_providers` 返回的 `active_provider_id` 即为该提供商 id。
- [ ] 已存在至少一个提供商时保存新提供商，`active_provider_id` 保持不变（包括其为空的显式未配置状态）。
- [ ] 更新已有提供商（名称/端点/模型/密钥任意组合）不改变 `active_provider_id`。
- [ ] 删除默认提供商后 `active_provider_id` 被清空，且随后编辑剩余提供商不会重新自动激活。
- [ ] 前端：全新安装下添加第一个提供商并保存后，对话区 CTA 从 "Configure a provider" 变为 "Generate reply"，无需额外操作。
- [ ] 前端 store 测试更新：覆盖"首个提供商保存后自动激活"与"已有激活/已有提供商时不自动激活"两类断言。
- [ ] 后端 service 测试覆盖上述全部后端断言。
- [ ] `.trellis/spec/backend/provider-guidelines.md` §8 补充该规则。

## Notes

- 技术方案见 `design.md`，执行清单见 `implement.md`。
