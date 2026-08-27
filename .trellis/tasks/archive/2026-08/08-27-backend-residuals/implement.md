# 后端重构遗留问题收敛：执行计划

## 执行顺序

- [x] 激活、实现、检查并归档 `08-27-released-db-upgrade-harness`。
- [x] 在升级 harness 全绿后，激活、实现、检查并归档 `08-27-cleanup-stale-provider-binding`。
- [x] 激活、实现、检查并归档 `08-27-decouple-export-database`。
- [x] 核对三个子任务提交均位于 `fix/backend-residuals`，任务目录和规范无漂移。
- [x] 运行最终 `cargo fmt`、Clippy、全量 Rust 测试、`pnpm check` 和 debug no-bundle Tauri build。
- [ ] 提交父任务集成记录并归档父任务。

## Gate

父任务没有生产实现，不应被激活为 `in_progress`。每次只启动拥有当前交付物的子任务。

## Integration notes (2026-08-27)

Work commits on `fix/backend-residuals`:

- `b4b28bc` / `c87f8de` — released DB upgrade harness + specs
- `d8a955b` / `5a57d5b` — migration 0007 binding integrity + specs
- `ae53834` / `80531e0` — export DB preflight removal + specs

Children archived under `.trellis/tasks/archive/2026-08/`. Final gates re-run green with workspace `CARGO_TARGET_DIR`.
