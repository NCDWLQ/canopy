/**
 * Simplified Chinese dictionary. Keys follow `<feature>.<component>.<name>`
 * with flat dot notation; the zh-CN dictionary is the mechanical copy of the
 * current UI copy (task 08-22-i18n, research/ui-string-inventory.md §3) and
 * doubles as the type-level source of truth.
 *
 * Interpolated messages are functions taking one params object. This file
 * must stay in sync with `en.ts`, which is checked against `Dictionary`.
 */
export const zhCN = {
  // Shared UI vocabulary (shadcn primitives and generic buttons/labels).
  "common.close": "关闭",
  "common.loading": "正在加载",
  "common.more": "更多",
  "common.cancel": "取消",
  "common.delete": "删除",
  "common.save": "保存",
  "common.add": "添加",
  "common.default": "默认",
  "common.settings": "设置",
  "common.breadcrumb": "面包屑",
  "common.discard": "丢弃",
  "common.unsavedChangesTitle": "丢弃未保存的更改？",
  "common.unsavedChangesBody": "当前修改尚未保存，继续操作将丢失这些修改。",

  // CommandErrorCode mapping plus frontend fallback error copy.
  "errors.invalidInput": "请求包含无效输入。",
  "errors.notFound": "未找到请求的资源。",
  "errors.treeIntegrity": "无法验证对话树。",
  "errors.databaseUnavailable": "对话数据库当前不可用。",
  "errors.migrationFailure": "数据库迁移失败。",
  "errors.providerAuthentication": "需要服务提供商身份验证。",
  "errors.rateLimited": "已达到服务提供商的速率限制。",
  "errors.providerUnavailable": "服务提供商当前不可用。",
  "errors.networkFailure": "服务提供商网络请求失败。",
  "errors.cancelled": "生成已取消。",
  "errors.exportFileWrite": "写入导出文件失败。",
  "errors.internal": "发生意外错误。",
  "errors.unsafeTreeProjection": "无法安全显示对话树。",

  // ConversationWorkspace.tsx
  "conversation.workspace.sidebar": "对话侧栏",
  "conversation.workspace.newConversation": "新建对话",
  "conversation.workspace.history": "历史记录",
  "conversation.workspace.historyList": "对话历史记录",
  "conversation.workspace.generatingReply": "正在生成回复",
  "conversation.workspace.archivedBadge": "已归档",
  "conversation.workspace.archive": "归档",
  "conversation.workspace.loadingHistory": "正在加载历史记录…",
  "conversation.workspace.emptyHistory": "暂无已保存的对话。",
  "conversation.workspace.retryHistory": "重试加载历史记录",
  "conversation.workspace.noConversationLoaded": "尚未加载对话。",
  "conversation.workspace.collapseSidebar": "收起侧栏",
  "conversation.workspace.expandSidebar": "展开侧栏",
  "conversation.workspace.archivedReadonlyBadge": "已归档 — 只读",
  "conversation.workspace.blankTitle": "开始新对话",
  "conversation.workspace.blankHint": "在下方输入消息，开启新对话",
  "conversation.workspace.firstMessagePlaceholder": "输入第一条消息…",
  "conversation.workspace.loadingHistoryPane": "正在加载对话历史记录…",
  "conversation.workspace.placeholderArchived": "对话已归档（只读）",
  "conversation.workspace.placeholderGenerating": "回复生成中…",
  "conversation.workspace.placeholderBranchMessage": "输入分支消息…",
  "conversation.workspace.placeholderNextMessage": "输入下一条消息…",
  "conversation.workspace.placeholderDraftOnly":
    "当前位置不可直接发送，可创建分支",
  "conversation.workspace.archiveConfirmTitle": "归档对话？",
  "conversation.workspace.archiveConfirmBody":
    "归档后对话转为只读，并在历史记录中标记为已归档。",
  "conversation.workspace.archiveConfirmInterrupts":
    "归档将打断正在进行的生成。",
  "conversation.workspace.archiveConfirmAction": "归档",
  "conversation.workspace.conversationMenu": ({ title }: { title: string }) =>
    `对话操作：${title}`,
  "conversation.workspace.rename": "重命名",
  "conversation.workspace.unarchive": "取消归档",
  "conversation.workspace.renameDialogTitle": "重命名对话",
  "conversation.workspace.renameDialogLabel": "对话标题",
  "conversation.workspace.renameDialogTitleBlank": "标题不能为空。",
  "conversation.workspace.renameDialogTitleTooLong":
    "标题不能超过 200 个字符。",
  "conversation.workspace.deleteConfirmTitle": "删除对话？",
  "conversation.workspace.deleteConfirmBody":
    "删除后无法恢复，该对话及其全部消息将被永久移除。",
  "conversation.workspace.deleteConfirmInterrupts":
    "删除将打断正在进行的生成并放弃其结果。",

  // ConversationPane.tsx
  "conversation.pane.thinking": "正在思考",
  "conversation.pane.generationFailed": "回复失败",
  "conversation.pane.persistFailed": "这条回复未能保存",
  "conversation.pane.regenerate": "重新生成",
  "conversation.pane.replyStopped": "回复已停止",
  "conversation.pane.loading": "正在加载对话…",
  "conversation.pane.errorTitle": "出错了",
  "conversation.pane.retry": "重试",
  "conversation.pane.empty": "尚未选择消息。",
  "conversation.pane.saving": "正在保存消息",
  "conversation.pane.branchOrigin": "由此处创建分支",

  // Composer.tsx
  "conversation.composer.placeholder": "输入消息…",
  "conversation.composer.label": "消息输入框",
  "conversation.composer.cancelGeneration": "停止生成",
  "conversation.composer.send": "发送消息",

  // MessageNode.tsx
  "conversation.message.saveAsBranch": "保存为新分支",
  "conversation.message.createBranch": "创建分支",
  "conversation.message.generateReply": "生成回复",
  "conversation.message.configureProvider": "配置服务提供商以生成",
  "conversation.message.regenerate": "重新生成",
  "conversation.message.editAsBranch": "编辑为新分支",
  "conversation.message.branchFromHere": "从此处创建分支",
  "conversation.message.branchPrev": "上一条分支",
  "conversation.message.branchNext": "下一条分支",
  "conversation.message.branchPosition": ({
    index,
    count,
  }: {
    index: number
    count: number
  }) => `分支 ${index}/${count}`,
  "conversation.message.copied": "已复制",
  "conversation.message.copy": "复制",
  "conversation.message.editContent": "编辑消息内容",
  "conversation.message.branchPlaceholder": "输入分支消息…",
  "conversation.message.branchContent": "分支消息内容",
  "conversation.message.export": "导出对话至该消息",

  // exportMarkdown.ts + store export action
  "conversation.export.success": ({ fileName }: { fileName: string }) =>
    `已导出：${fileName}`,
  "conversation.export.failed": "导出失败",
  "conversation.export.userLabel": "用户",
  "conversation.export.assistantLabel": "助手",

  // MessageBubble.tsx
  "conversation.messageBubble.roleSystem": "系统",
  "conversation.messageBubble.roleUser": "用户",
  "conversation.messageBubble.roleAssistant": "助手",
  "conversation.messageBubble.roleTool": "工具",
  "conversation.messageBubble.messageAria": ({ role }: { role: string }) =>
    `${role}消息`,

  // ThinkingBlock.tsx
  "conversation.thinking.thinking": "思考中…",
  "conversation.thinking.process": "思考过程",

  // OutlineTree.tsx
  "conversation.outline.tree": "对话树",
  "conversation.outline.togglePreview": ({
    expanded,
    label,
  }: {
    expanded: boolean
    label: string
  }) => `${expanded ? "收起" : "展开"} ${label}`,
  "conversation.outline.messageFallback": "消息",
  "conversation.outline.noReplies": "该消息暂无回复",
  "conversation.outline.emptyContent": "无内容",

  // ConversationPanorama.tsx + ConversationWorkspace.tsx
  "conversation.panorama.openPanorama": "查看全景",
  "conversation.panorama.closePanorama": "返回对话",
  "conversation.panorama.canvas": "对话全景",
  "conversation.panorama.collapseBranch": ({ label }: { label: string }) =>
    `收起 ${label} 的分支`,
  "conversation.panorama.expandBranch": ({ label }: { label: string }) =>
    `展开 ${label} 的分支`,
  "conversation.panorama.collapseBranchTooltip": "收起分支",
  "conversation.panorama.expandBranchTooltip": "展开分支",
  "conversation.panorama.expandBranchTooltipCount": ({
    count,
  }: {
    count: number
  }) => `展开分支（${count} 条）`,
  "conversation.panorama.hiddenCount": ({ count }: { count: number }) =>
    `${count} 条已折叠`,

  // SearchDialog.tsx
  "search.openButton": "搜索对话",
  "search.title": "搜索对话",
  "search.description": "按关键词搜索消息内容与对话标题。",
  "search.placeholder": "搜索消息或标题…",
  "search.hint": "输入关键词以搜索消息内容与对话标题。",
  "search.searching": "正在搜索…",
  "search.noResults": "没有匹配的对话。",
  "search.resultsRegion": "搜索结果",
  "search.titleMatched": "标题匹配",

  // AssistantMarkdown.tsx (streamdown translations)
  "conversation.markdown.copyCode": "复制代码",
  "conversation.markdown.copied": "已复制",
  "conversation.markdown.copyTable": "复制表格",
  "conversation.markdown.copyTableAsCsv": "复制为 CSV",
  "conversation.markdown.copyTableAsMarkdown": "复制为 Markdown",
  "conversation.markdown.copyTableAsTsv": "复制为 TSV",
  "conversation.markdown.tableFormatCsv": "CSV",
  "conversation.markdown.tableFormatMarkdown": "Markdown",
  "conversation.markdown.tableFormatTsv": "TSV",

  // useWorkspaceGenerationController.ts
  "conversation.generation.replyGeneratedToast": "已生成回复",
  "conversation.generation.generationFailedToast": "生成失败",
  "conversation.generation.unavailableProvider": "请先配置服务提供商。",
  "conversation.generation.unavailableNoConversation": "请先新建或加载对话。",
  "conversation.generation.unavailableArchived": "已归档的对话为只读。",
  "conversation.generation.unavailableInvalidPath":
    "当前对话路径异常，无法生成回复。",
  "conversation.generation.unavailableNotUserNode":
    "请选择一条用户消息以生成回复。",
  "conversation.generation.unavailableRunActive": "请等待当前回复完成。",

  // toaster.tsx
  "conversation.toast.jumpToConversation": "跳转到对话",

  // ConversationProviderPicker.tsx
  "conversation.providerPicker.triggerUnconfigured": "未配置服务提供商",
  "conversation.providerPicker.open": "选择模型与推理强度",
  "conversation.providerPicker.providers": "服务提供商",
  "conversation.providerPicker.noProviders": "尚未配置服务提供商。",
  "conversation.providerPicker.models": "模型",
  "conversation.providerPicker.noModelsHint": "选择服务提供商后可选模型。",
  "conversation.providerPicker.reasoningEffort": "推理强度",
  "conversation.providerPicker.effortDefault": "默认",
  "conversation.providerPicker.effortLow": "低",
  "conversation.providerPicker.effortMedium": "中",
  "conversation.providerPicker.effortHigh": "高",
  "conversation.providerPicker.manageProviders": "管理模型提供商",

  // SettingsDialog.tsx
  "settings.dialog.description": "工作区设置",
  "settings.dialog.navLabel": "设置分类",
  "settings.dialog.generalCategory": "通用",
  "settings.dialog.appearanceCategory": "外观",
  "settings.dialog.providersCategory": "模型提供商",
  "settings.dialog.conversationsCategory": "对话",

  // GeneralSettingsPanel.tsx
  "settings.general.title": "通用",
  "settings.general.language": "语言",
  "settings.general.languageDescription": "选择界面显示语言",
  "settings.general.languageSystem": "跟随系统",
  "settings.general.languageZhCn": "简体中文",
  "settings.general.languageEn": "English",
  "settings.general.updateFailed": "语言设置未保存",
  "settings.general.version": "当前版本",
  "settings.general.versionDescription": ({ version }: { version: string }) =>
    version,
  "settings.general.versionUnavailable": "不可用",
  "settings.general.updateCheck": "检查更新",
  "settings.general.updateCheckingStatus": ({ version }: { version: string }) =>
    `${version} · 正在检查更新…`,
  "settings.general.updateCheckResult": "更新检查结果",
  "settings.general.updateUpToDate": ({ version }: { version: string }) =>
    `已是最新版本（${version}）`,
  "settings.general.updateAvailable": ({ version }: { version: string }) =>
    `发现新版本 ${version}`,
  "settings.general.openReleasePage": "打开发布页面",
  "settings.general.updateCheckFailed": ({ version }: { version: string }) =>
    `${version} · 检查更新失败，请重试`,
  "settings.general.retryUpdateCheck": "重试",

  // AppearanceSettingsPanel.tsx
  "settings.appearance.title": "外观",
  "settings.appearance.theme": "主题模式",
  "settings.appearance.themeDescription": "选择界面显示主题",
  "settings.appearance.themeSystem": "跟随系统",
  "settings.appearance.themeLight": "浅色模式",
  "settings.appearance.themeDark": "深色模式",
  "settings.appearance.updateFailed": "外观设置未保存",

  // ConversationSettingsPanel.tsx
  "settings.conversation.title": "对话",
  "settings.conversation.autoGenerateTitle": "自动生成标题",
  "settings.conversation.autoGenerateTitleDescription":
    "首轮对话后，使用下方配置的模型自动生成标题",
  "settings.conversation.titleModel": "标题模型",
  "settings.conversation.followSession": "跟随对话",
  "settings.conversation.defaultSystemPrompt": "默认系统提示词",
  "settings.conversation.defaultSystemPromptDescription":
    "对话未单独设置时，默认使用此系统提示词",
  "settings.conversation.defaultSystemPromptPlaceholder": "留空表示不设置",
  "settings.conversation.saveDefaultSystemPrompt": "保存",
  "settings.conversation.updateFailed": "对话设置未保存",
  "settings.conversation.systemPromptSaved": "默认系统提示词已保存。",

  // ConversationSettingsDialog.tsx
  "conversation.settingsDialog.title": "对话设置",
  "conversation.settingsDialog.systemPrompt": "系统提示词",
  "conversation.settingsDialog.systemPromptDescription":
    "仅对后续消息生效，不影响历史记录",
  "conversation.settingsDialog.followGlobal": "跟随全局默认",
  "conversation.settingsDialog.globalPreview": "当前全局默认",
  "conversation.settingsDialog.restoreFollowGlobal": "恢复全局默认",
  "conversation.settingsDialog.save": "保存",
  "conversation.workspace.conversationSettings": "对话设置",

  // ProviderSettingsPanel.tsx + ProviderSettingsList.tsx
  "settings.providers.crumbEdit": "编辑",
  "settings.providers.crumbNew": "新建",
  "settings.providers.backToList": "模型提供商",
  "settings.providers.backToListAria": "返回模型提供商列表",
  "settings.providers.allProviders": "全部提供商",
  "settings.providers.create": "新建",
  "settings.providers.presetField": "预设",
  "settings.providers.presetCustom": "自定义",
  "settings.providers.presetMenuLabel": "常用预设",
  "settings.providers.preset.openai": "OpenAI",
  "settings.providers.preset.anthropic": "Anthropic",
  "settings.providers.preset.deepseek": "DeepSeek",
  "settings.providers.preset.kimi": "Kimi（Moonshot）",
  "settings.providers.preset.glmBigmodel": "智谱 GLM（bigmodel.cn）",
  "settings.providers.preset.glmZai": "智谱 GLM（z.ai）",
  "settings.providers.preset.openrouter": "OpenRouter",
  "settings.providers.preset.gemini": "Gemini（OpenAI 兼容层）",
  "settings.providers.preset.opencodeGo": "OpenCode Go",
  "settings.providers.empty": "尚未添加模型提供商。",
  "settings.providers.editAria": ({ name }: { name: string }) =>
    `编辑：${name}`,
  "settings.providers.defaultBadgeAria": "当前全局默认",
  "settings.providers.moreActionsAria": ({ name }: { name: string }) =>
    `更多操作：${name}`,
  "settings.providers.alreadyDefault": "已是当前默认提供商",
  "settings.providers.setAsDefault": "设为默认",
  "settings.providers.setAsDefaultDisabledAria":
    "设为默认（已是当前默认提供商）",
  "settings.providers.deleteDisabled": "当前为默认提供商，无法删除",
  "settings.providers.deleteDisabledAria": "删除（当前为默认提供商，无法删除）",
  "settings.providers.deleteTitle": "删除模型提供商？",
  "settings.providers.deleteConfirm": ({ name }: { name: string }) =>
    `删除「${name}」？`,
  "settings.providers.deleteConfirmBody": "使用它的对话将回退到全局默认。",

  // ProviderSettingsEditor.tsx
  "settings.providers.editorNewTitle": "新建模型提供商",
  "settings.providers.editorEditTitle": "编辑模型提供商",
  "settings.providers.incompleteAlert": "操作未完成",
  "settings.providers.errors.duplicateName": ({ name }: { name: string }) =>
    `名称「${name}」已被使用`,
  "settings.providers.readOnlyAlert": "只读",
  "settings.providers.readOnlyAlertBody":
    "查看已归档对话时无法修改模型提供商设置。",
  "settings.providers.nameField": "名称",
  "settings.providers.protocolField": "协议",
  "settings.providers.protocolPlaceholder": "选择协议",
  "settings.providers.protocolOpenaiCompatible": "OpenAI 兼容",
  "settings.providers.endpointField": "基础端点",
  "settings.providers.endpointHint":
    "Anthropic 兼容网关需带各自前缀，如 DeepSeek 填 https://api.deepseek.com/anthropic。",
  "settings.providers.modelsField": "模型列表",
  "settings.providers.modelInputPlaceholder": "手动输入模型名",
  "settings.providers.fetchModels": "获取模型列表",
  "settings.providers.fetchModelsFailed": "获取模型列表失败。",
  "settings.providers.removeModelAria": ({ model }: { model: string }) =>
    `移除 ${model}`,
  "settings.providers.addModelAria": ({ model }: { model: string }) =>
    `加入模型：${model}`,
  "settings.providers.defaultModelField": "默认模型",
  "settings.providers.defaultModelPlaceholder": "选择默认模型",
  "settings.providers.apiKeyField": "API 密钥",
  "settings.providers.apiKeyOptional": "可选",
  "settings.providers.showApiKey": "显示 API 密钥",
  "settings.providers.hideApiKey": "隐藏 API 密钥",
  "settings.providers.saveAria": "保存模型提供商",
  "settings.providers.providerSaved": "模型提供商已保存。",

  // formatProviderModelsSummary.ts
  "providers.modelsSummary.empty": "未添加模型",
  "providers.modelsSummary.more": ({
    head,
    remaining,
  }: {
    head: string
    remaining: number
  }) => `${head} 等 ${remaining} 个`,
} as const

/**
 * Dictionary contract: exactly the zh-CN keys, static entries widened to
 * `string`, parameterized entries keeping their exact function signature.
 * `en.ts` is checked against this shape, so missing keys, extra keys, or
 * mismatched interpolation params are compile errors.
 */
export type Dictionary = {
  readonly [K in keyof typeof zhCN]: (typeof zhCN)[K] extends string
    ? string
    : (typeof zhCN)[K]
}
