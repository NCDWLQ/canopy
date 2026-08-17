# Implement: 简化会话模型选择器

## Checklist

1. [x] Store：新增草稿字段；`enterConversationCreation` 初始化草稿；退出/加载会话时清除；暴露 `setDraftConversationProvider`（或等价）。
2. [x] `ConversationProviderPicker`：支持 `mode: "persisted" | "draft"`（或 `conversationId === null` 分支）；移除跟随全局；默认徽章；选择一律非 null 绑定；null 会话改 effort 时连带快照；更新测试。
3. [x] `ConversationWorkspace`：blank/creating 挂载 picker，接草稿 props/回调。
4. [x] `useWorkspaceGenerationController.createConversation`：create → set binding from draft → generate；set 失败不 generate；补测试。
5. [x] 回归：`ConversationWorkspace` / store / picker 既有测试；修正断言「跟随全局」相关用例。
6. [x] 质量：相关 vitest + eslint + tsc（本环境 `pnpm` 签名校验失败时改用本地 bin）。

## Validation

```bash
./node_modules/.bin/vitest run src/features/conversations/components/ConversationProviderPicker.test.tsx \
  src/features/conversations/components/ConversationWorkspace.test.tsx \
  src/features/conversations/store/store.test.ts \
  src/features/conversations/hooks/useWorkspaceGenerationController.test.tsx
./node_modules/.bin/eslint src/features/conversations/components/ConversationProviderPicker.tsx \
  src/features/conversations/components/ConversationWorkspace.tsx \
  src/features/conversations/store/index.ts \
  src/features/conversations/hooks/useWorkspaceGenerationController.ts
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
```

## Rollback

- 单特性分支；无 DB 迁移。回滚 = 弃用分支 / revert commits。
- 若已发布：UI 回退不影响存量 null 行。

## Before `task.py start`

- [x] prd / design / implement 齐备
- [x] 用户批准本规划摘要后，再 `task.py start` 并开分支
