# Implement: 线性视图分支切换器

## Checklist（按序执行）

1. [ ] store：新增 `siblingBranchInfo` 纯函数 + 单测
   （`store/index.ts`、`store/store.test.ts`）
   - 覆盖：根节点 → null；无兄弟 → null；中间兄弟 → 双侧 id；首/尾兄弟 →
     单侧 id 缺省。
2. [ ] i18n：`en.ts` + `zh-CN.ts` 增加 `branchPrev` / `branchNext` /
   `branchPosition` 三个键（typed dictionary，两侧必须同键）。
3. [ ] `BranchSwitcher.tsx` 新组件 + `BranchSwitcher.test.tsx`
   - 渲染 `i+1/count`；首/尾禁用态；点击回调；aria-label。
4. [ ] `MessageBubble.tsx`：新增 `pager` 插槽（常驻，hover-opacity 之外）
   - 三个角色分支（user/assistant/其他）都要接线；更新既有测试如受影响。
5. [ ] `MessageNode.tsx`：新增 `branchSwitcher` prop，编辑态隐藏
   - `MessageNode.test.tsx`：有/无 prop、编辑态隐藏。
6. [ ] `ConversationPane.tsx`：新增 `branchSwitcherFor` prop 并透传。
7. [ ] `ConversationWorkspace.tsx`：实现 `branchSwitcherFor` 闭包
   （`siblingBranchInfo` + `selectBranchAtNode`）。
8. [ ] `ConversationWorkspace.test.tsx` 集成测试：复用
   LEFT/RIGHT_BRANCH_SENTINEL 夹具，断言切换器渲染、点击后路径切换且滚
   动定位（reveal）。
9. [ ] 全量 `pnpm check`。

## Validation Commands

```bash
pnpm vitest run src/features/conversations   # 定向测试
pnpm check                                    # 全量质量门
```

## Risky Files / Rollback Points

- `MessageBubble.tsx`：三角色布局改动是唯一影响既有渲染的文件；每步完成
  后可单独 `git diff` 审视，出问题回滚到 checklist 上一步即可。
- 整体回滚：单 commit revert，无持久状态。

## Review Gates

- checklist 1–2 完成后：纯逻辑可独立测试，先行验证。
- checklist 8 完成后：跑一次全量 `pnpm check`（即 2.2 质量检查），通过后
  进入 Finish 阶段。
