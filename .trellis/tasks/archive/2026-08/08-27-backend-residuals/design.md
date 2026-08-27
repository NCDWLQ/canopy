# 后端重构遗留问题收敛：任务树设计

## 1. 结构

父任务不修改生产代码，只管理三个可独立验收的子任务：

```text
released-db-upgrade-harness
  └─> cleanup-stale-provider-binding

decouple-export-database  (independent)
```

所有子任务在共享分支 `fix/backend-residuals` 上按独立提交落地。Trellis 同一时间只激活一个子任务；完成、检查、提交并归档当前子任务后再切换下一个。

## 2. 顺序与集成

1. 先建立 v0.4.0 released-database fixture 和真实 SQL plugin 升级 harness。
2. 用该 harness 驱动 `0007+` provider/model 不变量 migration。
3. 导出解耦无 migration 依赖，可在 1 与 2 之后执行，减少并行共享文件冲突。
4. 父任务最后运行全仓集成门并核对三个子任务 spec 的一致性。

## 3. 跨任务合同

- `0001`–`0006` 永不改写；v0.4.0 fixture 是后续 migration 的兼容输入。
- provider 绑定修复只改变持久化残值，不改变 command、DTO、keyring 或 generation 选择语义。
- 导出解耦只取消 `database_unavailable` 前置失败；路径、内容、大小、IO 和 wire 合同保持不变。
- 每个子任务可通过 revert 代码提交回滚；migration 一旦运行则仅允许 forward repair，不提供 down migration。

## 4. 最终门

父任务不运行 `task.py start`。三个子任务归档后，父任务只做集成核验、记录提交与归档，不新增临时实现。
