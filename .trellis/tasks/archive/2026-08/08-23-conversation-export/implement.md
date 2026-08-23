# 对话导出 — 执行计划

前置：`prd.md`（验收 AC1–AC7）、`design.md`（分层变更清单）。工作树 `/home/jwh/Code/canopy-export`，分支 `feat/conversation-export`，PR 目标 `main`。

## 有序清单

1. **Rust 写文件命令**
   - [ ] `Cargo.toml` + `tauri-plugin-dialog`；`lib.rs` 注册插件与命令
   - [ ] `commands.rs`：`WriteExportFileRequest/Response` DTO + service 方法 + `#[tauri::command]` + `CONVERSATION_COMMAND_NAMES`
   - [ ] `capabilities/default.json` + `"dialog:allow-save"`
   - [ ] 单测：IO 错误映射、空 path/content 拒绝、大小上限
2. **契约同步**
   - [ ] `contract-fixtures/conversation-ipc.json` 增条目；跑 `cargo test --test command_boundary`
3. **前端 IPC 封装**
   - [ ] `schemas.ts` zod schema + `client.ts` `writeExportFile`（走 `call()`）
   - [ ] `client.test.ts` 增用例
4. **导出纯函数**
   - [ ] `exportMarkdown.ts`：`buildExportMarkdown` + `sanitizeExportFilename`
   - [ ] colocated vitest：角色过滤、交替序列、空标题回退、非法字符清理、user 原样插入
5. **store 动作与 UI**
   - [ ] store `exportUpToMessage(anchorNodeId)`（切前缀 → save() → write → toast；取消静默）
   - [ ] `MessageNode.tsx` 导出按钮（仅 assistant，`exportDisabled` prop）
   - [ ] `ConversationPane.tsx` 接线（`generationRuns` 判断禁用态）
   - [ ] 组件测试：按钮出现条件、禁用态、取消无副作用
6. **i18n**
   - [ ] `zh-CN.ts` + `en.ts` 同步加 5 组 key（见 design.md 清单）
7. **质量门（最后一轮全量）**
   - [ ] `pnpm check`（format/lint/typecheck/test/build）
   - [ ] `cargo test` + `cargo clippy`（仅保持编辑文件 fmt-clean，见记忆：main 有 fmt 漂移）

## 验证命令

```bash
cd /home/jwh/Code/canopy-export
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
# 手动：pnpm tauri dev → 助手消息导出 → 保存 → 检查文件内容/生成中禁用/取消
```

## 风险文件与回滚点

- `src-tauri/src/conversations/commands.rs`、`contract-fixtures/conversation-ipc.json`：契约敏感，命令名拼写四处一致（commands.rs / lib.rs / fixture / client.ts）
- `src/features/conversations/store/index.ts`（1584 行）：只加动作不改既有逻辑
- 每步独立可提交；任何一步失败可 revert 该步而不影响已验证步骤

## start 前检查

- [ ] prd/design/implement 三件套已评审
- [ ] `implement.jsonl` / `check.jsonl` 已有真实条目（非 seed）
