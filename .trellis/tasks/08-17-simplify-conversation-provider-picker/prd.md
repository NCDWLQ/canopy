# 简化会话模型选择器：去掉跟随全局、新建可选模型

## Goal

降低会话标题栏 provider/model 选择器的心智负担：用户只需选择「这条对话用哪个服务/模型」，不必理解「跟随全局 vs 会话覆盖」；新建会话在发送首条消息前也能选好模型。

## Background

- 选择器：`ConversationProviderPicker`；空白新建态目前不渲染（`ConversationWorkspace.tsx`）。
- 会话 `provider_id`/`model` 可为 null（跟随全局）；effort 独立；生成用 effective（绑定优先，否则全局）。
- `create_conversation` 仅 title+content；绑定经 `set_conversation_provider`。
- 痛点：独立「跟随全局默认」增加概念；跟随态改模型会悄悄写入绑定。

## Requirements

### R1 选择器信息架构

- Popover **移除**「跟随全局默认」清除项；UI 不再提供将 binding 清回 null 的入口。
- 仅列出已配置 provider；当前全局激活项旁标「默认」。
- 选中态：已绑定会话用 `provider_id`；存量 null 会话用当前全局激活 provider 展示为选中（effective），不表述为「跟随」。
- 模型列表仍只读 provider 持久化列表（不联网）；保留 effort 与「管理服务提供商…」。

### R2 选择语义（一律快照）

- 点选任意 provider（含「默认」）→ 写入 `binding = { providerId, model }`（model 为该 provider 默认模型，除非用户另选模型）。
- 点选模型 → 写入绑定（尚无绑定则用当前全局激活 provider id + 所选 model）。
- effort 仍独立提交；清除绑定不再由 UI 触发（后端 API 可保留 null 能力供存量兼容）。

### R3 新建会话可选模型

- 空白/新建态标题栏展示同一选择器。
- 前端维护草稿（默认 = 当前全局激活 provider + 其默认 model；effort 默认未选）。
- 创建会话后将草稿落为该会话绑定，使首条生成使用用户所选。

### R4 存量 null 会话（懒处理）

- 不迁移、不在仅打开时写库。
- 保持 null 时继续 effective 跟随全局；用户一旦在选择器中点选任意 provider/model，即按 R2 快照写入。
- 新建路径创建时始终写入绑定（有可用全局默认时），不再产生新的 null（无 provider 配置时仍可为 null / 未配置流程）。

### R5 触发器

- 展示 effective provider·model；「默认」仅出现在 Popover 列表项。

## Out of Scope

- 多 provider CRUD / 协议 / 设置内模型列表拉取改动。
- 按消息临时改模型；provider 级默认 effort。
- 历史消息 model 回写或重跑。
- 将「跟随全局」作为一等 UX 概念保留或改名重做。
- 强制迁移存量 null 行。

## Acceptance Criteria

- [ ] AC1：选择器 Popover 无「跟随全局默认」；provider 列表在全局激活项旁有「默认」提示。
- [ ] AC2：在已绑定或存量 null 会话上点选任意 provider（含默认）或模型后，会话写入非 null 绑定；之后改全局激活不影响该会话的 effective provider/model。
- [ ] AC3：空白/新建态标题栏可见选择器；改 provider/model/effort 后发送首条，该会话持久化对应绑定且首条生成使用所选。
- [ ] AC4：从未打开过选择器的存量 null 会话，改全局激活后 effective 仍跟随；仅打开会话不写绑定。
- [ ] AC5：归档只读仍禁用选择器；「管理服务提供商…」仍打开设置。
- [ ] AC6：相关单元测试更新并通过；`pnpm` 前端检查（含 picker / workspace / store 相关测试）通过。若改动了 create 契约则 contract fixture 与后端测试同步通过。
