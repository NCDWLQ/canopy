# provider 删除后的会话绑定残值：技术设计

## 1. Migration

新增 `0007_conversation_provider_binding_integrity.sql`，并作为版本 7 注册到 `infra::database::MIGRATION_CATALOG`。绝不修改 v0.4.0 已发布的 `0001`–`0006`。

Migration 包含两个动作：

```sql
UPDATE conversations
SET model = NULL
WHERE provider_id IS NULL AND model IS NOT NULL;

CREATE TRIGGER provider_delete_clears_conversation_binding
BEFORE DELETE ON providers
FOR EACH ROW
BEGIN
  UPDATE conversations
  SET provider_id = NULL, model = NULL
  WHERE provider_id = OLD.id;
END;
```

最终 SQL 的命名与格式可在实现时按 migration 规范调整，但语义不得弱化为仅一次性 cleanup。

## 2. Why a Trigger

- 无凭据 provider 删除和 credential reconcile 删除走不同 service 分支，但最终都删除 provider row。
- FK 只拥有 `provider_id`，无法同时更新 `model`。
- 在每条 service 分支前手动更新会话会复制不变量，也不能覆盖直接 SQL 删除测试/维护路径。
- `BEFORE DELETE` trigger 在 FK `ON DELETE SET NULL` 前将两列一起清空，保留 `reasoning_effort`。

## 3. Tests

- released fixture：v0.4.0 stale row 经版本 7 升级后 model 清空，其余字段保持。
- migration integration：绑定 provider 后直接删除 provider，断言 `(provider_id, model) = (NULL, NULL)` 且 effort 不变。
- provider service：覆盖无凭据立即删除与有凭据 reconcile 删除。
- generation binding：继续证明 set/clear 只接受成对 provider/model。
- fresh database：1–7 从空库顺序应用并通过全部 tree/provider tests。

## 4. Compatibility

- IPC、DTO 和读取层 `binding_model` 可暂时保留为防御性映射；删除它不是本任务要求。
- null provider/model 仍表示跟随全局 provider，生成行为不变。
- active provider、title binding 与 keyring operation 的事务顺序不变。

## 5. Rollback

Migration 采用 forward-only。代码回滚不删除 trigger；trigger 产生的 null/null 状态已被旧版本支持。若 migration 本身有缺陷，使用新的 forward repair migration，不执行 down migration。
