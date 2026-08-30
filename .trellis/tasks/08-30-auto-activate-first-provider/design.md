# 技术设计：新装时首个提供商自动设为默认

## 核心规则

在 `ProviderService::save` 中增加一条不变式：

> 保存前提供商列表为空（即本次保存创建的是首个提供商）时，在同一事务内将 `active_provider_id` 设为该新提供商的 id。

规则刻意收窄为"列表为空"，而非"无 active 即激活"：

- 更新已有提供商时列表必然非空 → 永不触发，天然排除编辑场景。
- 删除默认提供商后列表非空（剩继任者）→ 不触发，保留 spec §8"显式未配置状态优于静默切换"的语义。
- 全新安装 / 删光所有提供商后重新添加 → 触发，覆盖目标痛点。

## 后端改动（`src-tauri/src/providers/service.rs`）

`save()` 现有流程已在事务开始时加载完整提供商列表（`ProviderRepository::list_providers`，用于重名校验和查找 `existing`）。改动点：

1. 在事务开启时记录 `let was_empty = providers.is_empty();`。
2. 在提交保存 staging row 的同一事务内（凭据 reconcile 之后、commit 之前），若 `was_empty && existing.is_none()`，调用 `SettingsRepository::set_active_provider_id(&mut transaction, &provider_id)`。
3. 返回类型 `RedactedProvider` 不变；IPC `save_provider` 签名不变（命令表面冻结，spec §2）。

注意：`set_active_provider_id` 只是 `app_settings` 的 KV upsert，无 keyring 交互，放入现有事务无额外失败面。若保存本身失败（重名、端点非法、keyring 不可用），事务回滚，不会留下半激活状态。

## 前端改动（`src/features/providers/store/index.ts`）

`saveProvider` 成功后构造新状态时镜像同一规则：

```text
const activateFirst =
  previous.activeProviderId === null && previous.providers.length === 0
const activeProviderId = activateFirst ? provider.id : previous.activeProviderId
```

然后传入 `readyOrUnconfigured(...)`。选择乐观镜像而非保存后重新 `listProviders` 的理由：

- 后端在同一事务内保证结果，两侧规则由验收条件锁定，漂移风险低；
- 避免一次额外 IPC 往返和 epoch 竞态窗口；
- store 测试可直接断言，无需 mock 第二次调用。

`ProviderSettingsList` 的"设为默认"入口保留不变；`phase` 变为 `ready` 后 `ConversationWorkspace` 的 CTA 自动切换为 Generate，无需 UI 组件改动。

## 测试设计

后端（`providers/service.rs` 测试模块，沿用 fake credential store）：

- 空库保存首个提供商 → `load_active` 返回该提供商；`list_providers` 聚合中 `active_provider_id` 一致。
- 已有一个提供商时再保存新提供商 → active 不变。
- 无 active 但列表非空（先保存 A、B，删除 active 的 A）→ 编辑 B 后 active 仍为空。
- 保存失败（重名）→ 不写入 `active_provider_id`。

前端（`store/store.test.ts`）：

- 替换 `store.test.ts:141` 的 "does not auto-activate a new provider"：改为"首个提供商保存后自动激活（phase → ready）"。
- 新增：已有 `activeProviderId` 时保存新提供商不切换；`activeProviderId` 为空但列表非空时保存不激活。

## Spec 更新

`provider-guidelines.md` §8 增加一条：首个提供商（保存前列表为空）在保存事务内自动写入 `active_provider_id`；其余场景不自动激活，删除默认仍只清空不提升。

## 兼容性与回滚

- 纯行为新增，无 schema 迁移；旧数据库升级路径（migration 0005 种子）不受影响。
- 回滚 = 还原 service.rs 与 store 两处改动及测试，无数据残留风险（多写入的 `active_provider_id` 本身即是合法状态）。
