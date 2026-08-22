# 调研：成熟产品的对话标题生成（2026-08-22）

来源：Open WebUI、LibreChat、NextChat、LobeChat（lobehub v2）源码 + GPT-5 系统提示泄露讨论。
闭源产品（ChatGPT / Claude.ai）确切 prompt 未公开；行为模式为独立小模型后台生成、首轮后出标题、可手动重生成。

## 本项目现状（分支 main @ 1c8f8bc）

- Prompt：`src-tauri/src/providers/title_prompt.rs`，单条 user 消息，指令 + `<conversation><user>/<assistant>` 转义包裹；中文 ≤20 字 / 其他 ≤40 字符；语言跟随用户消息；含反注入声明。
- 管线：`src-tauri/src/providers/titles.rs`，每次 generation 完成后 spawn，但 `load_auto_title_context`（`conversations/service.rs:338`）要求恰好 1 条 assistant → 实际只生成一次。
- 参数：`build_title_request` 两协议均 max_tokens=60、无 temperature、无 reasoning_effort；Anthropic 通道 system=None。
- 后处理：`clean_title` 合并空白 + 去包裹引号 → `validate_title`；失败即放弃（埋点 title_generation_skipped）。
- 前端兜底：`deriveConversationTitle.ts` 用首条消息前 40 字符截断作初始标题。
- 模型解析：专用标题模型绑定 > 会话 provider/model > active provider 默认模型（fallback 直接用主聊天模型）。

## 各产品要点（prompt 原文见调研会话记录）

| 维度 | Open WebUI | LibreChat | NextChat | LobeChat | 本项目 |
|---|---|---|---|---|---|
| 结构 | 分节 Task/Guidelines/Output + few-shot 4 例 | "Title:" 结尾引导补全 | 本地化 prompt 附在真实消息后 | system 指令 + user 数据 | 单 user 消息 |
| 长度 | 2-4 words | max 40 chars | 4-5 words | ≤15 words / ≤80 chars | 中 20 字 / 其他 40 字符 |
| 语言 | 聊天主语言（多语默认英文） | 未指定 | UI locale | 显式 locale 参数 | 用户消息语言（更优） |
| 输入 | `{{MESSAGES:END:2}}` 最后 2 条 | 首条 user+assistant | 最近 historyMessageCount 条 | 全量消息标签包裹 | 首条 user+assistant（各 2000 字符截断） |
| 输出 | JSON `{"title":...}` | 裸文本 | 裸文本 | 严格 JSON Schema（strict） | 裸文本 |
| 触发/重试 | 首轮后；手动可再生成 | titleTiming immediate（不等回复）/final | 默认标题且 ≥50 token；可手动刷新 | 首轮后 | 恰好 1 条 assistant，一次成败 |
| 模型 | 可配 task model | gpt-3.5-turbo（temperature 0.7, max_tokens 20） | 强制小模型（gpt-4o-mini 等） | 可配 | 默认用主聊天模型 |
| 注入防护 | 无 | 无 | 无 | 标签包裹无转义 | 转义 + 不可信声明（最优） |

## 改进候选（讨论范围用，按优先级）

1. **max_tokens=60 + reasoning 模型兼容**（正确性）：o 系列 / R1 类思考 token 计入 max_tokens，60 可能正文为空 → 标题静默失败。默认 fallback 又直接用会话主模型，必踩。建议 max_tokens 提到 100+，title 请求带 reasoning_effort=low/minimal。
2. **失败重试**：改为“标题仍为默认值且 ≥1 条 assistant”即尝试，首轮失败后下次 generation 完成时自然重试。
3. **寒暄开场兜底**：首条 user 过短（如 <10 字符）时多带几条 user 消息进 `<conversation>`；prompt 加“若开头只是问候，从实质内容提炼”。
4. **prompt 强化**：2-3 个中英 few-shot（注明勿照抄）；"Be plain and factual, not creative"；显式禁 emoji /《》/ 引号 / Markdown。
5. **清洗强化**：`clean_title` 剥离 "Title:"/“标题：” 前缀；考虑剥 emoji。
6. **system/user 角色分离**：指令进 system，两协议通道同步（顺手优化）。
7. 暂不做：JSON Schema 结构化输出（三方端点兼容性差）、用户自定义 prompt、titleTiming=immediate 并行生成（前端已有截断兜底）。
8. 顺手：title_generation_skipped 埋点按失败原因细分。

## 参考链接

- Open WebUI: backend/open_webui/config.py（DEFAULT_TITLE_GENERATION_PROMPT_TEMPLATE）、utils/task.py（{{MESSAGES:END:2}}）
- LibreChat: api/server/services/Endpoints/assistants/title.js、packages/data-provider/src/config.ts（titleMethod/titleTiming/titleModel）
- NextChat: app/store/chat.ts（触发条件+小模型强制）、app/locales/en.ts（prompt 原文）
- LobeChat: packages/prompts/src/chains/summaryTitle.ts、topicAutoSummary.ts
- GPT-5 泄露：news.ycombinator.com/item?id=44918708（其 title 指令属 Tasks 功能，非会话标题）
