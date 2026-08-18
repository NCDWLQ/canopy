# 会话标题自动生成

## Goal

用 LLM 为新会话生成简洁、语义的标题，替代当前"首条用户消息截断 40 字符"的占位标题，让侧边栏历史列表可辨识、可回忆。

## Background / Confirmed Facts

- 当前标题在前端创建会话时由 `deriveConversationTitle()` 生成：归一化空白后截断至 40 个 Unicode scalar，超长加 `…`(`src/features/conversations/deriveConversationTitle.ts`)；创建时一次性写入后端（`useWorkspaceGenerationController.ts:416`)，之后无更新机制。
- 后端标题校验：trim、非空、≤200 字符（`src-tauri/src/conversations/commands.rs:16,395`)。
- 不存在手动改名功能（前后端均无 rename)，因此一次性自动标题无覆盖用户标题的风险。
- Provider 客户端仅流式（`openai_compatible.rs:132,157`,`stream: true` 硬编码）；标题生成复用流式通道自行累积，无需新增非流式协议路径。
- GenerationRuntime 强制单会话单生成（`GenerationAlreadyActive`,`generation.rs:47-58`)；标题生成不写节点，须走独立轻量路径绕过该运行时。
- 应用级设置存于 `app_settings` 键值表（`repository.rs:8,173-207`，先例 `active_provider_id`)；标题模型绑定比照办理。
- 项目目前仅有按请求的 Tauri Channel（生成事件），无全局事件；标题更新通知将引入首个全局 `emit` 事件。
- 前端历史列表经 store `history.summaries` 管理，已有 `upsertSummary` / `updateSummaryActivity` 助手（`store/index.ts:285-300`)。

## Requirements

- R1: 首个助手回复成功持久化后，自动为该会话生成语义标题并写回；一次性触发（以 assistant 节点数 == 1 判定），不做定期再生成。仅在「自动生成会话标题」开关开启时触发。
- R2: 标题模型可配置：设置对话框提供「标题模型」，默认「跟随会话」（会话绑定的 provider/model)，可指定任意已配置 provider+model；配置持久化于 `app_settings`；跟随会话但会话无绑定时回退到 active provider。开关关闭时，「标题模型」选择器禁用（仍保留上次选择，便于再开启）。
- R3: 标题生成任何环节失败（断网/鉴权/空响应/超限）均静默回退，保留截断占位标题，仅记录日志，不弹错、不打断用户。
- R4: 标题生成不占用 GenerationRuntime、不写会话节点、不显示在消息流中、不阻塞回复事件投递。
- R5: 标题写库后经全局事件 `conversation://title-updated` 通知前端；侧边栏历史列表与（若为）当前会话标题自动更新，无需手动刷新。
- R6: 生成出的标题须清洗（trim、去首尾引号、单行化）并通过既有 `validate_title`（非空、≤200 字符），不合格则放弃。
- R7: 设置中提供全局开关「自动生成会话标题」，默认开启；持久化于 `app_settings`；关闭后新会话保持截断占位标题，不发起标题 LLM 调用。
- R8: 设置 UI 克制文案——控件标签已表达语义时不追加说明段落/副标题（无「首轮回复后用 LLM…」类辅助文）。

## Acceptance Criteria

- [ ] AC1(R1/R5/R7)：开关开启时，新会话发送首条消息并收到完整回复后，侧边栏在数秒内显示 LLM 生成的标题，替代截断占位。
- [ ] AC2(R4)：标题生成期间消息界面无任何感知；会话树无新增节点（仅 title 字段更新）。
- [ ] AC3(R3)：断网、错误 API Key、模型返回空/垃圾文本时，会话保持原截断标题，无错误 UI。
- [ ] AC4(R4)：标题生成与进行中的其他会话后台生成互不干扰。
- [ ] AC5(R2)：设置中选择指定标题模型后，新会话标题由该模型生成；恢复「跟随会话」后行为复原；重启后配置保留。
- [ ] AC7(R7)：关闭开关后，新会话首轮回复完成不发起标题调用、标题保持截断占位；再开启后，仅对新会话生效（已存在的截断标题会话不补跑）。重启后开关状态保留。
- [ ] AC6：质量门禁全绿——`cargo fmt --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test --all-features`、`pnpm check`（显式回传退出码）。

## Out of Scope

- 手动改名（rename）及"手动标题保护"——后续独立任务，届时需新增"仅当标题仍为占位/自动标题时才覆盖"的判定。
- 定期/每 N 轮标题再生成。
- 标题生成的 UI 进度指示（生成中 spinner 等）。
- 非流式协议路径的抽象（本次复用流式通道累积即可）。

## Key Decisions

- 触发时机：首轮回复完成后一次性生成（用户确认）。
- 标题模型：跟随会话 / 用户指定，设置可配；默认跟随会话（用户确认）。
- 手动改名：本任务不做（用户确认）。
- 失败策略：全链路静默回退 + 日志（设计决策）。
- 总开关：设置「自动生成会话标题」，默认开启（用户确认）。
- UI 文案：无冗余说明文本（用户确认）。
- 提示词：硬编码纯文本返回；独立 `title_prompt` 模块，不塞进业务编排（用户确认）。

## Artifacts

- `design.md`：架构、数据流、事件契约、取舍、测试策略。
- `implement.md`：有序实施清单、验证命令、风险文件与回滚点。
- `implement.jsonl` / `check.jsonl`:spec 与研究清单（子代理上下文）。
