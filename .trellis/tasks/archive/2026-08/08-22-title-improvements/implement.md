# 执行计划：标题生成快速包（1+4+6+5）

工作树：`/home/jwh/Code/canopy-title-improvements`（分支 `feat/title-improvements`，基于 main @ 1c8f8bc）

## 顺序清单

1. **title_prompt.rs**：`build_title_prompt` 返回 `TitlePrompt { system, user }`；按 design.md §1 重写 system 文本；user 块保持截断+转义。
   - 更新测试：`prompt_bounds_each_conversation_excerpt`（拆分为 system/user 断言）、`prompt_escapes_markup_breakout_attempts`（断言移到 user 部分）；新增 few-shot/风格禁令断言。
2. **openai_compatible.rs**：`build_title_request(model, &TitlePrompt)` → messages [system,user]、max_tokens 256、reasoning_effort "low"；`stream_title` 签名同步。
   - 更新测试 `title_request_is_bounded_and_disables_reasoning`（:424）→ 断言反转：max_tokens 256、reasoning_effort=="low"、messages 两条且 [0].role=="system"。
3. **anthropic.rs**：`build_title_request(model, &TitlePrompt)` → system Some、单 user 消息、max_tokens 256、thinking 维持 None；`stream_title` 签名同步。
   - 更新测试 `title_request_disables_thinking_and_limits_output`（:350）：max_tokens 256、system 字段非空、messages 单条。
4. **titles.rs**：调用点（:75）适配 `TitlePrompt`；`clean_title` 增加"引号剥离后剥一次 Title:/标题：/标题: 前缀"。
   - 更新/新增测试：前缀剥离 3 例 + 合法内容不误剥（"标题党现象讨论"）。
5. **回归**：全量 `cargo test`；确认主对话 `build_request` 测试无改动即通过。

## 验证命令

```bash
cd /home/jwh/Code/canopy-title-improvements/src-tauri
cargo test
# 仅检查已编辑文件（仓库存在 fmt 漂移，勿全局 fmt）
cargo fmt --check src/providers/title_prompt.rs src/providers/titles.rs src/providers/openai_compatible.rs src/providers/anthropic.rs 2>/dev/null || cargo fmt -- --check src/providers/title_prompt.rs
cargo clippy --all-targets -- -D warnings
```

（fmt 精确到文件的方式若不被 rustfmt 支持，退化为：`cargo fmt` 后 `git diff --stat` 确认仅目标文件被改写。）

## 风险文件与回滚点

- 全部改动集中在 `src-tauri/src/providers/` 四个文件，单 commit 可整体回滚。
- 每步完成后跑 `cargo test -p canopy_lib providers::` 缩小反馈环。
- 无 DB/前端/主对话路径改动，回滚零联动。

## task.py start 前检查

- [ ] prd.md 收敛（无遗留 Open Questions）
- [ ] design.md / implement.md 就位
- [ ] 用户已明确批准本规划摘要
