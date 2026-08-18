# 应用日志记录功能

## Goal

为 Canopy 建立默认可用、容量有界且不泄露用户数据的本地诊断日志。应用发生启动、数据库、会话、提供商或生成故障时，开发者能够从 release 构建的日志中识别失败环节；普通用户能够从设置中打开日志目录并提交日志协助排障。

## Background

- `src-tauri/src/lib.rs` 已依赖 `log` 和 `tauri-plugin-log 2.9.0`，但只在 debug 构建中以 `Info` 等级注册插件；release 构建没有持久日志。
- 当前只有自动标题失败路径产生一条产品日志，主要命令边界仍直接把内部错误映射为 `CommandError`。
- 该条日志把前端传入的 `conversation_id` 直接插入消息，而会话命令只校验标识符非空。它一旦随 release 落盘就成为可伪造日志行的注入点，属于本任务必须一并修正的现存缺陷。
- `.trellis/spec/backend/logging-guidelines.md` 已确定 Rust 是诊断边界，日志必须使用稳定字段，并禁止记录凭据、会话内容、原始请求/响应、数据库路径及未审查的错误输出。
- SQL 插件会在启动时预加载数据库并执行迁移，因此日志初始化必须先于 SQL 插件，才能覆盖启动失败。
- 设置对话框已有分类导航，但没有诊断分类；前端也没有日志桥接、查看或导出能力。

## Requirements

### R1 — 持久日志与生命周期

- debug 和 release 构建都必须将 Canopy 自有诊断事件写入 Tauri 平台日志目录。
- debug 构建同时保留控制台输出；release 构建不依赖控制台。
- release 最低记录 `info`，debug 最低记录 `debug`；第三方依赖的普通日志不得混入持久日志。
- rotation 单文件上限和 retention 总文件数由“设置 → 诊断”的用户选项控制，并在下一次启动时解析为 `LoggingPolicy`。默认值为单文件 5 MiB、总共 5 个文件（约 25 MiB）。
- 配置硬上限为单文件 20 MiB、总文件数 10、总预算 100 MiB；三项约束必须同时满足，不能产生无限文件、无限大小或无界总预算。
- 时间戳使用 UTC，跨启动追加现有活动文件；配置变更只在下一次启动时生效，运行中不替换进程级 logger。
- logger fallback 顺序必须固定：首选持久文件 sink；文件 sink 初始化失败时尝试控制台 sink；控制台 sink 也无法构建时退化为 no-op。若挂载失败是因为进程已有全局 logger，则保持既有 logger、不替换也不重试。任一降级都不得阻止应用继续启动。
- fallback 不得写入 SQLite、浏览器存储、无界内存缓冲或另一份未受 rotation/retention 约束的文件。

### R2 — 诊断事件

- 使用稳定的 `operation=<name> code=<name>` 字段；仅在有诊断价值时增加等级、阶段、耗时、计数或由应用生成并验证的 UUID。
- 覆盖应用启动/就绪、数据库预加载或迁移失败、关键会话与提供商变更、模型生成开始/完成/取消/失败、自动标题结果，以及需要调查的 Tauri 命令失败。
- logger 成功挂载后，后续启动失败事件必须能区分「某个插件初始化失败」与其它启动失败，并标识失败的插件，使数据库预加载/迁移失败可以从日志识别；同时不得输出底层错误消息。
- 同一失败只在拥有安全上下文的边界记录一次；repository、service 和 command 不得重复记录同一传播错误。
- 预期的无效输入、未找到、用户取消不自动记为 `error`；可恢复的数据库/网络/限流/提供商故障记为 `warn`，完整性破坏和未预期内部故障记为 `error`。
- 日志不会替代现有 `CommandError`、界面错误提示或恢复操作。

### R3 — 隐私与安全

- 不得记录 API 密钥、授权头、提供商凭据、提示词、消息正文、标题、节点 metadata、模型原始响应、完整请求 DTO 或响应 DTO。
- 不得记录本地数据库/日志路径、连接字符串、原始 provider body、未过滤的错误 `Debug`/source chain 或前端传入的任意字符串。
- 敏感内容禁令适用于 `error`、`warn`、`info`、`debug`、`trace` 全部等级以及文件/控制台全部 sink；提高日志等级只能增加经过同一类型化约束的事件，不能放宽字段、source chain 或 payload 规则。
- 命令失败日志只接受静态 operation、稳定错误码、布尔/数值元数据和经过类型验证的应用生成 UUID，不序列化 `CommandError.message/details`。
- 日志以换行分隔，因此任何写入日志行的动态值都不得包含换行、回车或其它控制字符；未经校验的标识符不得进入日志，避免伪造日志行。
- 日志目录路径只在 Rust 内部解析，不通过 IPC 返回给前端。

### R4 — 用户诊断入口

- 设置对话框新增独立“诊断”分类，归档会话只读状态不得禁用该入口。
- 诊断面板说明日志用途、敏感数据边界和当前 sink 状态，并提供“打开日志目录”按钮。
- 诊断面板提供单文件大小与总文件数选项，显示默认值、硬上限和计算后的总预算；只接受正整数且组合预算不得超过 100 MiB。
- 保存后的配置持久化到 SQL 预加载之前可读取的应用配置目录，并明确提示“重启后生效”；提供恢复默认值操作。
- 打开目录、加载配置和保存配置分别防止重复提交并显示进行中状态；成功后给出确认反馈，失败时保留其它诊断能力并显示安全、可重试的中文错误。
- Rust 命令不接收路径参数，只能创建并打开 Canopy 自己的平台日志目录；前端不获得通用 opener 权限。

### R5 — 兼容性与可维护性

- 复用现有 `log` facade 和 `tauri-plugin-log`，不引入第二套 tracing/telemetry 框架。
- 通过独立 diagnostics 后端模块和独立 TypeScript client/schema 管理日志配置与 IPC 契约，不把诊断行为塞入 provider client。
- 支持当前桌面目标 Windows、macOS 和 Linux；打开目录使用 Tauri 2 官方 opener Rust API。
- 不改变现有命令成功 DTO、`CommandError` 机器码或数据库 schema。
- 日志配置使用版本化、大小有界、可恢复的独立配置记录；损坏或写入中断不得破坏上一次有效配置，也不得阻止启动。

## Acceptance Criteria

- [ ] AC1（R1）：debug 构建同时产生控制台与文件日志，release 构建产生文件日志；持久文件仅包含 Canopy 目标且等级符合构建配置。
- [ ] AC2（R1）：默认策略在日志达到 5 MiB 后轮转，活动文件与归档文件总数不超过 5；合法自定义值按配置轮转/保留，缺失、非法、越过硬上限或总预算溢出的配置回退到默认策略；重新启动后继续写入活动文件。
- [ ] AC3（R1）：测试分别模拟文件 sink 构建失败、控制台 fallback 构建失败和 logger 挂载失败；fallback 顺序符合约定，diagnostics bootstrap setup 始终返回 `Ok(())`，后续应用构建/启动继续执行。用户主动打开不可用目录时仍按 R4 显示可重试错误。
- [ ] AC4（R2）：自动化测试或受控验证证明启动、代表性命令失败、生成完成/失败/取消和自动标题失败产生预期的 operation/code/level，且同一错误没有重复事件；logger 已挂载后，后续插件初始化失败的事件带有失败插件名。
- [ ] AC5（R3）：对每个启用等级（包含测试启用的 `debug`/`trace`）和文件/控制台 sink 使用凭据、提示词、消息正文、路径、provider body 与换行/回车哨兵；格式化输出均不包含哨兵值或 `CommandError.message/details`，且不产生额外日志行。
- [ ] AC6（R4）：用户可从“设置 → 诊断”查看活动策略与 sink 状态，保存 1–20 MiB 的单文件上限和 1–10 的总文件数；组合总预算超过 100 MiB 时前端阻止提交且 Rust 再次拒绝。保存成功后显示重启生效提示，重启后新策略成为活动策略，恢复默认值可回到 5 MiB/5 文件。
- [ ] AC7（R4）：用户可打开由 Rust 解析的 Canopy 日志目录；IPC 响应不包含本地路径，capability 不授予通用 opener 命令权限。加载、保存、打开操作各自防重复触发；任一失败不清除已知设置或禁用其它操作，并提供可访问的中文错误与重试路径。
- [ ] AC8（R5）：模拟保存中断或一个配置槽损坏时，上一次有效记录仍可读取；两个槽均缺失使用默认值，均无效则安全回退默认值；配置文件大小受限，未知字段、版本、非整数、溢出和越界组合均被拒绝。
- [ ] AC9（R5）：现有会话、提供商、生成和设置测试继续通过，Rust format/Clippy/test 与前端 format/lint/typecheck/test/build 全部通过。

## Out of Scope

- 云端遥测、远程日志上传、崩溃转储和第三方可观测性平台。
- 内置日志查看器、日志搜索、压缩诊断包或自动上传。
- 面向用户的日志等级配置。
- 记录会话正文、提示词、标题或模型原始响应。
- 数据库迁移；日志设置不写入 SQLite。

## Development Environment

- Worktree path: `/home/jwh/Code/canopy-application-logging`.
- Branch: `feat/application-logging` (base `main`).
- Main worktree (`/home/jwh/Code/canopy`) stays on `main`; no product-code
  changes land there.
- Planning artifacts are mirrored into the linked worktree before task start;
  after start, the linked-worktree copy is authoritative for implementation.

## Key Decisions

- MVP 包含 release 本地持久日志和“设置 → 诊断 → 打开日志目录”。
- 不拆分父子任务：后端日志与诊断入口共享同一安全契约和验收链路，作为一个跨层任务更容易进行端到端验证。
- rotation/retention 由“设置 → 诊断”配置，默认 5 MiB/5 文件，硬上限 20 MiB/文件、10 文件且总预算不超过 100 MiB。
- 配置保存在应用配置目录的双槽版本化记录中，下一次启动生效；不依赖尚未预加载的 SQLite。
- 打开目录命令不接收路径；设置命令只接收受上下限约束的两个整数。目录解析、配置持久化和最终校验均由 Rust 完成。

## Risks and Deferred Items

- 日志插件依赖进程级全局 logger，测试必须隔离或测试纯配置/格式化逻辑，避免并行测试重复注册。
- 启动过程中诊断引导自身失败时无法依赖同一日志系统报告原因；本次只保证降级不阻断启动。
- 会话命令的 `conversation_id`/`node_id` 目前只校验非空，不是经过验证的 UUID，因此会话相关失败事件本次不携带关联标识。把这些命令升级为 UUID 校验从而恢复关联能力，留待单独任务。
- 崩溃堆栈和 panic payload 可能包含敏感数据，留待单独设计安全的崩溃诊断方案。
