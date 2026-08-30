# 执行计划：新装时首个提供商自动设为默认

## Checklist

- [ ] 1. 后端：`src-tauri/src/providers/service.rs` `save()` 内，记录 `was_empty`，在提交事务前按规则写入 `active_provider_id`
- [ ] 2. 后端测试：空库首存激活 / 再存不切换 / 删默认后编辑不激活 / 保存失败不写入
- [ ] 3. 前端：`src/features/providers/store/index.ts` `saveProvider` 乐观镜像激活规则
- [ ] 4. 前端测试：改写 `store.test.ts:141` 既有断言 + 新增两个不激活场景
- [ ] 5. Spec：`.trellis/spec/backend/provider-guidelines.md` §8 补充规则
- [ ] 6. 质量检查（见下）全部通过后进入 Phase 3

## 验证命令

```bash
cd src-tauri && cargo test providers
cd src-tauri && cargo clippy --all-targets -- -D warnings
npx vitest run src/features/providers
npx tsc --noEmit
```

（以 `quality-guidelines.md` 中的实际命令为准。）

## Review Gates

- 后端改动后：确认 `save_provider` IPC 签名与返回类型未变（命令表面冻结）。
- 前端改动后：确认 `phase` 状态机（`readyOrUnconfigured`）未被绕过，仅通过 `activeProviderId` 入参生效。

## 回滚点

每步均为独立文件改动，可单独 `git checkout` 回滚；无迁移、无破坏性变更。
