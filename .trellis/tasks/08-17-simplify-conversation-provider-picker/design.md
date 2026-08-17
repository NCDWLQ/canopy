# Design: 简化会话模型选择器

## 1. Boundaries

| Layer | Change |
|-------|--------|
| Frontend picker | 去「跟随全局」；「默认」徽章；绑定-only 选择 |
| Frontend store | 新建草稿 `draftProviderBinding` + `draftReasoningEffort`；blank 可写草稿 |
| Frontend workspace | blank/creating 也挂载 picker |
| Frontend create path | 创建成功后、开生成前，将草稿经 `set_conversation_provider` 落库 |
| Backend | **MVP 不改** `create_conversation` 契约；复用现有 set binding。若落库失败则不启动生成并报错 |
| DB | 无迁移 |

## 2. Draft model

当 `isCreatingConversation || (conversationId === null && blank)`：

```ts
draftBinding: { providerId: string; model: string } | null
draftReasoningEffort: ReasoningEffort | null
```

- 进入新建：用 `activeProviderId` + 该 provider 默认 `model` 初始化 `draftBinding`（无激活 provider 则为 null）。
- Picker 在无 `conversationId` 时读写草稿，不调用 IPC。
- 有 `conversationId` 时行为同现网：调用 `setConversationProvider`；**禁止**从 UI 传 `binding: null`。

选中态解析：

- 已加载会话：`store.providerId ?? activeProviderId` 为高亮 provider；`store.model ?? provider.model` 为高亮 model。
- 新建草稿：用 `draftBinding`（或回退 active）。

「默认」徽章：`provider.id === activeProviderId`，与是否绑定无关。

## 3. Create → bind → generate

`useWorkspaceGenerationController.createConversation`：

1. `createConversation(title, content)`（现有）
2. 若草稿 `draftBinding != null`（或 effort 非 null）：`setConversationProvider({ binding: draftBinding, reasoningEffort: draftEffort })`
3. 成功后再 `startGeneration`
4. 步骤 2 失败：保留已创建会话投影，surface error，**不** startGeneration
5. 清除草稿 / `isCreatingConversation`

不扩展 `create_conversation` IPC：避免本任务跨 contract；双 RPC 窗口可接受（失败可重试绑定）。

## 4. Picker behavior changes

- 删除「跟随全局默认」按钮与对应测试。
- `chooseProvider` / `chooseModel`：始终 `save(nonNullBinding, effort)`；无 conversationId 时写草稿。
- `chooseEffort`：有 conversationId 时，binding 参数用当前已存绑定或「若 null 则同时快照当前 effective」（避免只改 effort 却仍 null——**推荐**：仅改 effort 时若 binding 为 null，一并写入当前 effective provider+model，与「点选即快照」一致且消灭「只改 effort 的隐形跟随」）。
- Provider 行：名称 + 可选「默认」Badge；右侧可保留默认 model 次要文字。

## 5. Compatibility

- 存量 null：只读打开不写库；effective 仍跟随（AC4）。
- 后端 `set_conversation_provider` 仍接受 `binding: null`（无 UI 调用即可）。
- 删除激活 provider 后绑定级联置空：现有行为保留；UI 回到 effective/未配置展示。

## 6. Trade-offs

| Decision | Choice | Why |
|----------|--------|-----|
| 创建是否扩展 IPC | 否，create 后 set | 更小 diff；失败可提示 |
| 仅改 effort 且 binding null | 同时快照 effective | 避免 effort-only 路径保留隐形跟随 |
| 草稿存 store vs 组件 state | store | create 路径与 picker 共享，切换侧栏不丢 |

## 7. Risks

- create 成功、set 失败：会话已存在但无绑定 → 必须明确错误且不生成；用户可再开选择器绑定后手动发送（或后续补偿；MVP 报错即可）。
- 进入新建时全局无 provider：草稿 null，选择器展示未配置；与现网未配置门禁一致。
