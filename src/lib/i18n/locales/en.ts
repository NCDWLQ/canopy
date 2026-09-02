import type { Dictionary } from "./zh-CN"

/**
 * English dictionary. `satisfies Dictionary` keeps the key set and every
 * interpolation signature in lockstep with zh-CN at compile time.
 */
export const en = {
  // Shared UI vocabulary (shadcn primitives and generic buttons/labels).
  "common.close": "Close",
  "common.loading": "Loading",
  "common.more": "More",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.save": "Save",
  "common.add": "Add",
  "common.default": "Default",
  "common.settings": "Settings",
  "common.breadcrumb": "Breadcrumb",
  "common.discard": "Discard",
  "common.unsavedChangesTitle": "Discard unsaved changes?",
  "common.unsavedChangesBody":
    "Your changes have not been saved. Continuing will discard them.",

  // CommandErrorCode mapping plus frontend fallback error copy.
  "errors.invalidInput": "The request contains invalid input.",
  "errors.notFound": "The requested resource was not found.",
  "errors.treeIntegrity": "The conversation tree could not be verified.",
  "errors.databaseUnavailable": "The database is currently unavailable.",
  "errors.migrationFailure": "The database migration failed.",
  "errors.providerAuthentication": "Provider authentication is required.",
  "errors.rateLimited": "The provider rate limit was reached.",
  "errors.providerUnavailable": "The provider is currently unavailable.",
  "errors.networkFailure": "The provider network request failed.",
  "errors.cancelled": "Generation was cancelled.",
  "errors.exportFileWrite": "Failed to write the export file.",
  "errors.internal": "An unexpected error occurred.",
  "errors.unsafeTreeProjection":
    "The conversation tree cannot be shown safely.",

  // ConversationWorkspace.tsx
  "conversation.workspace.sidebar": "Conversation sidebar",
  "conversation.workspace.newConversation": "New conversation",
  "conversation.workspace.history": "History",
  "conversation.workspace.historyList": "Conversation history",
  "conversation.workspace.generatingReply": "Generating reply",
  "conversation.workspace.archivedBadge": "Archived",
  "conversation.workspace.archive": "Archive",
  "conversation.workspace.loadingHistory": "Loading history…",
  "conversation.workspace.emptyHistory": "No saved conversations yet.",
  "conversation.workspace.noActiveHistory":
    "No active conversations. Archived conversations are available in Settings.",
  "conversation.workspace.retryHistory": "Retry loading history",
  "conversation.workspace.noConversationLoaded": "No conversation loaded.",
  "conversation.workspace.collapseSidebar": "Collapse sidebar",
  "conversation.workspace.expandSidebar": "Expand sidebar",
  "conversation.workspace.archivedReadonlyBadge": "Archived — read-only",
  "conversation.workspace.blankTitle": "Start a new conversation",
  "conversation.workspace.blankHint":
    "Type a message below to start the conversation",
  "conversation.workspace.firstMessagePlaceholder": "Type your first message…",
  "conversation.workspace.loadingHistoryPane": "Loading conversation history…",
  "conversation.workspace.placeholderArchived":
    "Conversation is archived (read-only)",
  "conversation.workspace.placeholderGenerating": "Generating reply…",
  "conversation.workspace.placeholderBranchMessage": "Type a branch message…",
  "conversation.workspace.placeholderNextMessage": "Type your next message…",
  "conversation.workspace.placeholderDraftOnly":
    "Cannot send directly here; create a branch to continue",
  "conversation.workspace.archiveConfirmTitle": "Archive this conversation?",
  "conversation.workspace.archiveConfirmBody":
    "Archiving makes the conversation read-only and removes it from the sidebar history. You can find and manage it in Settings > Archived Conversations.",
  "conversation.workspace.archiveConfirmInterrupts":
    "Archiving will interrupt the generation in progress.",
  "conversation.workspace.archiveConfirmAction": "Archive",
  "conversation.workspace.conversationMenu": ({ title }: { title: string }) =>
    `Conversation actions: ${title}`,
  "conversation.workspace.rename": "Rename",
  "conversation.workspace.renameDialogTitle": "Rename conversation",
  "conversation.workspace.renameDialogLabel": "Conversation title",
  "conversation.workspace.renameDialogTitleBlank": "The title cannot be blank.",
  "conversation.workspace.renameDialogTitleTooLong":
    "The title cannot exceed 200 characters.",
  "conversation.workspace.deleteConfirmTitle": "Delete this conversation?",
  "conversation.workspace.deleteConfirmBody":
    "Deletion cannot be undone; the conversation and every message in it are permanently removed.",
  "conversation.workspace.deleteConfirmInterrupts":
    "Deleting will interrupt the generation in progress and discard its result.",

  // ConversationPane.tsx
  "conversation.pane.thinking": "Thinking",
  "conversation.pane.generationFailed": "Reply failed",
  "conversation.pane.persistFailed": "This reply could not be saved",
  "conversation.pane.regenerate": "Regenerate",
  "conversation.pane.replyStopped": "Reply stopped",
  "conversation.pane.loading": "Loading conversation…",
  "conversation.pane.errorTitle": "Something went wrong",
  "conversation.pane.retry": "Retry",
  "conversation.pane.empty": "No message selected.",
  "conversation.pane.saving": "Saving message",
  "conversation.pane.branchOrigin": "Branch from here",

  // Composer.tsx
  "conversation.composer.placeholder": "Type a message…",
  "conversation.composer.label": "Message input",
  "conversation.composer.cancelGeneration": "Stop generating",
  "conversation.composer.send": "Send message",

  // MessageNode.tsx
  "conversation.message.saveAsBranch": "Save as new branch",
  "conversation.message.createBranch": "Create branch",
  "conversation.message.generateReply": "Generate reply",
  "conversation.message.configureProvider": "Configure a provider to generate",
  "conversation.message.regenerate": "Regenerate",
  "conversation.message.editAsBranch": "Edit as new branch",
  "conversation.message.branchFromHere": "Branch from here",
  "conversation.message.branchPrev": "Previous branch",
  "conversation.message.branchNext": "Next branch",
  "conversation.message.branchPosition": ({
    index,
    count,
  }: {
    index: number
    count: number
  }) => `Branch ${index}/${count}`,
  "conversation.message.copied": "Copied",
  "conversation.message.copy": "Copy",
  "conversation.message.editContent": "Edit message content",
  "conversation.message.branchPlaceholder": "Type a branch message…",
  "conversation.message.branchContent": "Branch message content",
  "conversation.message.export": "Export conversation up to this message",

  // exportMarkdown.ts + store export action
  "conversation.export.success": ({ fileName }: { fileName: string }) =>
    `Exported: ${fileName}`,
  "conversation.export.failed": "Export failed",
  "conversation.export.userLabel": "User",
  "conversation.export.assistantLabel": "Assistant",

  // MessageBubble.tsx
  "conversation.messageBubble.roleSystem": "System",
  "conversation.messageBubble.roleUser": "User",
  "conversation.messageBubble.roleAssistant": "Assistant",
  "conversation.messageBubble.roleTool": "Tool",
  "conversation.messageBubble.messageAria": ({ role }: { role: string }) =>
    `${role} message`,

  // ThinkingBlock.tsx
  "conversation.thinking.thinking": "Thinking…",
  "conversation.thinking.process": "Thought process",

  // OutlineTree.tsx
  "conversation.outline.tree": "Conversation tree",
  "conversation.outline.togglePreview": ({
    expanded,
    label,
  }: {
    expanded: boolean
    label: string
  }) => (expanded ? `Collapse ${label}` : `Expand ${label}`),
  "conversation.outline.messageFallback": "message",
  "conversation.outline.noReplies": "No replies to this message yet",
  "conversation.outline.emptyContent": "Empty",

  // ConversationPanorama.tsx + ConversationWorkspace.tsx
  "conversation.panorama.openPanorama": "View Panorama",
  "conversation.panorama.closePanorama": "Back to Conversation",
  "conversation.panorama.canvas": "Conversation Panorama",
  "conversation.panorama.controls": "Canvas zoom controls",
  "conversation.panorama.zoomIn": "Zoom in",
  "conversation.panorama.zoomOut": "Zoom out",
  "conversation.panorama.fitView": "Fit view",
  "conversation.panorama.collapseBranch": ({ label }: { label: string }) =>
    `Collapse branches of ${label}`,
  "conversation.panorama.expandBranch": ({ label }: { label: string }) =>
    `Expand branches of ${label}`,
  "conversation.panorama.collapseBranchTooltip": "Collapse branch",
  "conversation.panorama.expandBranchTooltip": "Expand branch",
  "conversation.panorama.expandBranchTooltipCount": ({
    count,
  }: {
    count: number
  }) => `Expand branch (${count} message${count === 1 ? "" : "s"})`,
  "conversation.panorama.hiddenCount": ({ count }: { count: number }) =>
    `${count} collapsed`,
  "conversation.panorama.deleteNode": "Delete branch",
  "conversation.panorama.deleteNodeConfirmTitle": "Delete this branch?",
  "conversation.panorama.deleteNodeConfirmDescription":
    "This permanently deletes this message and every reply and branch that follows it. This cannot be undone.",

  // SearchDialog.tsx
  "search.openButton": "Search conversations",
  "search.title": "Search conversations",
  "search.description": "Search message content and titles by keyword.",
  "search.placeholder": "Search messages or titles…",
  "search.hint": "Type a keyword to search message content and titles.",
  "search.searching": "Searching…",
  "search.noResults": "No matching conversations.",
  "search.resultsRegion": "Search results",
  "search.titleMatched": "Title match",

  // AssistantMarkdown.tsx (streamdown translations)
  "conversation.markdown.copyCode": "Copy code",
  "conversation.markdown.copied": "Copied",
  "conversation.markdown.copyTable": "Copy table",
  "conversation.markdown.copyTableAsCsv": "Copy as CSV",
  "conversation.markdown.copyTableAsMarkdown": "Copy as Markdown",
  "conversation.markdown.copyTableAsTsv": "Copy as TSV",
  "conversation.markdown.tableFormatCsv": "CSV",
  "conversation.markdown.tableFormatMarkdown": "Markdown",
  "conversation.markdown.tableFormatTsv": "TSV",

  // useWorkspaceGenerationController.ts
  "conversation.generation.replyGeneratedToast": "Reply generated",
  "conversation.generation.generationFailedToast": "Generation failed",
  "conversation.generation.unavailableProvider": "Configure a provider first.",
  "conversation.generation.unavailableNoConversation":
    "Create or load a conversation first.",
  "conversation.generation.unavailableArchived":
    "Archived conversations are read-only.",
  "conversation.generation.unavailableInvalidPath":
    "The current conversation path is broken; replies cannot be generated.",
  "conversation.generation.unavailableNotUserNode":
    "Select a user message to generate a reply.",
  "conversation.generation.unavailableRunActive":
    "Wait for the current reply to finish.",

  // toaster.tsx
  "conversation.toast.jumpToConversation": "Jump to conversation",
  "conversation.toast.archivedTitle": "Conversation archived",
  "conversation.toast.archivedDescription":
    "Click to open archived conversations in Settings",
  "conversation.toast.openArchivedSettings": "Open archived conversations",

  // ConversationProviderPicker.tsx
  "conversation.providerPicker.triggerUnconfigured": "No provider configured",
  "conversation.providerPicker.open": "Select model and reasoning effort",
  "conversation.providerPicker.providers": "Providers",
  "conversation.providerPicker.noProviders": "No providers configured yet.",
  "conversation.providerPicker.models": "Models",
  "conversation.providerPicker.noModelsHint":
    "Select a provider to choose a model.",
  "conversation.providerPicker.reasoningEffort": "Reasoning effort",
  "conversation.providerPicker.effortDefault": "Default",
  "conversation.providerPicker.effortLow": "Low",
  "conversation.providerPicker.effortMedium": "Medium",
  "conversation.providerPicker.effortHigh": "High",
  "conversation.providerPicker.manageProviders": "Manage model providers",

  // SettingsDialog.tsx
  "settings.dialog.description": "Workspace settings",
  "settings.dialog.navLabel": "Settings categories",
  "settings.dialog.generalCategory": "General",
  "settings.dialog.appearanceCategory": "Appearance",
  "settings.dialog.providersCategory": "Model Providers",
  "settings.dialog.conversationsCategory": "Conversations",
  "settings.dialog.archivedCategory": "Archived Conversations",

  // ArchivedConversationsPanel.tsx
  "settings.archived.title": "Archived Conversations",
  "settings.archived.listLabel": "Archived conversations list",
  "settings.archived.loading": "Loading archived conversations…",
  "settings.archived.emptyTitle": "No archived conversations",
  "settings.archived.emptyDescription":
    "Archived conversations appear here and remain available to open read-only.",
  "settings.archived.openAria": ({ title }: { title: string }) =>
    `Open archived conversation: ${title}`,
  "settings.archived.menuAria": ({ title }: { title: string }) =>
    `Archived conversation actions: ${title}`,
  "settings.archived.rename": "Rename",
  "settings.archived.unarchive": "Unarchive",
  "settings.archived.unarchiveAria": ({ title }: { title: string }) =>
    `Unarchive: ${title}`,
  "settings.archived.delete": "Delete",

  // GeneralSettingsPanel.tsx
  "settings.general.title": "General",
  "settings.general.language": "Language",
  "settings.general.languageDescription":
    "Choose the language used across the interface",
  "settings.general.languageSystem": "Follow system",
  "settings.general.languageZhCn": "简体中文",
  "settings.general.languageEn": "English",
  "settings.general.updateFailed": "Language setting was not saved",
  "settings.general.version": "Current version",
  "settings.general.versionDescription": ({ version }: { version: string }) =>
    version,
  "settings.general.versionUnavailable": "Unavailable",
  "settings.general.updateCheck": "Check for updates",
  "settings.general.updateCheckingStatus": ({ version }: { version: string }) =>
    `${version} · Checking for updates…`,
  "settings.general.updateCheckResult": "Update check result",
  "settings.general.updateUpToDate": ({ version }: { version: string }) =>
    `You're up to date (${version})`,
  "settings.general.updateAvailable": ({ version }: { version: string }) =>
    `Version ${version} is available`,
  "settings.general.openReleasePage": "Open release page",
  "settings.general.updateCheckFailed": ({ version }: { version: string }) =>
    `${version} · Couldn't check for updates. Try again.`,
  "settings.general.retryUpdateCheck": "Retry",

  // AppearanceSettingsPanel.tsx
  "settings.appearance.title": "Appearance",
  "settings.appearance.theme": "Theme mode",
  "settings.appearance.themeDescription":
    "Choose the display theme used across the interface",
  "settings.appearance.themeSystem": "Follow system",
  "settings.appearance.themeLight": "Light",
  "settings.appearance.themeDark": "Dark",
  "settings.appearance.themeColor": "Theme color",
  "settings.appearance.themeColorDescription":
    "Choose the primary accent color used across the interface",
  "settings.appearance.themeColorNeutral": "Neutral",
  "settings.appearance.themeColorBlue": "Blue",
  "settings.appearance.themeColorGreen": "Green",
  "settings.appearance.themeColorOrange": "Orange",
  "settings.appearance.themeColorRed": "Red",
  "settings.appearance.themeColorRose": "Rose",
  "settings.appearance.themeColorViolet": "Violet",
  "settings.appearance.updateFailed": "Appearance setting was not saved",

  // ConversationSettingsPanel.tsx
  "settings.conversation.title": "Conversations",
  "settings.conversation.autoGenerateTitle": "Auto-generate titles",
  "settings.conversation.autoGenerateTitleDescription":
    "After the first exchange, titles are generated automatically with the model configured below",
  "settings.conversation.titleModel": "Title model",
  "settings.conversation.followSession": "Follow conversation",
  "settings.conversation.defaultSystemPrompt": "Default system prompt",
  "settings.conversation.defaultSystemPromptDescription":
    "Applied to conversations without a custom system prompt",
  "settings.conversation.defaultSystemPromptPlaceholder":
    "Leave empty for no default",
  "settings.conversation.saveDefaultSystemPrompt": "Save",
  "settings.conversation.updateFailed": "Conversation setting was not saved",
  "settings.conversation.systemPromptSaved": "Default system prompt saved.",

  // ConversationSettingsDialog.tsx
  "conversation.settingsDialog.title": "Conversation settings",
  "conversation.settingsDialog.systemPrompt": "System prompt",
  "conversation.settingsDialog.systemPromptDescription":
    "Applies to new messages only; chat history remains unchanged",
  "conversation.settingsDialog.followGlobal": "Follow global default",
  "conversation.settingsDialog.globalPreview": "Current global default",
  "conversation.settingsDialog.restoreFollowGlobal": "Reset to global default",
  "conversation.settingsDialog.save": "Save",
  "conversation.workspace.conversationSettings": "Conversation settings",

  // ProviderSettingsPanel.tsx + ProviderSettingsList.tsx
  "settings.providers.crumbEdit": "Edit",
  "settings.providers.crumbNew": "New",
  "settings.providers.backToList": "Model Providers",
  "settings.providers.backToListAria": "Back to model providers",
  "settings.providers.allProviders": "All providers",
  "settings.providers.create": "New",
  "settings.providers.presetField": "Preset",
  "settings.providers.presetCustom": "Custom",
  "settings.providers.presetMenuLabel": "Presets",
  "settings.providers.preset.openai": "OpenAI",
  "settings.providers.preset.anthropic": "Anthropic",
  "settings.providers.preset.deepseek": "DeepSeek",
  "settings.providers.preset.kimi": "Kimi (Moonshot)",
  "settings.providers.preset.glmBigmodel": "Zhipu GLM (bigmodel.cn)",
  "settings.providers.preset.glmZai": "Zhipu GLM (z.ai)",
  "settings.providers.preset.openrouter": "OpenRouter",
  "settings.providers.preset.gemini": "Gemini (OpenAI compatible)",
  "settings.providers.preset.opencodeGo": "OpenCode Go",
  "settings.providers.empty": "No model providers added yet.",
  "settings.providers.editAria": ({ name }: { name: string }) =>
    `Edit: ${name}`,
  "settings.providers.defaultBadgeAria": "Current global default",
  "settings.providers.moreActionsAria": ({ name }: { name: string }) =>
    `More actions: ${name}`,
  "settings.providers.alreadyDefault": "Already the current default provider",
  "settings.providers.setAsDefault": "Set as default",
  "settings.providers.setAsDefaultDisabledAria":
    "Set as default (already the current default provider)",
  "settings.providers.deleteDisabled": "The default provider cannot be deleted",
  "settings.providers.deleteDisabledAria":
    "Delete (the default provider cannot be deleted)",
  "settings.providers.deleteTitle": "Delete model provider?",
  "settings.providers.deleteConfirm": ({ name }: { name: string }) =>
    `Delete “${name}”?`,
  "settings.providers.deleteConfirmBody":
    "Conversations using it will fall back to the global default.",

  // ProviderSettingsEditor.tsx
  "settings.providers.editorNewTitle": "New model provider",
  "settings.providers.editorEditTitle": "Edit model provider",
  "settings.providers.incompleteAlert": "Action not completed",
  "settings.providers.errors.duplicateName": ({ name }: { name: string }) =>
    `The name “${name}” is already in use`,
  "settings.providers.nameField": "Name",
  "settings.providers.protocolField": "Protocol",
  "settings.providers.protocolPlaceholder": "Select a protocol",
  "settings.providers.protocolOpenaiCompatible": "OpenAI compatible",
  "settings.providers.endpointField": "Base endpoint",
  "settings.providers.endpointHint":
    "Anthropic-compatible gateways need their own prefix; for DeepSeek enter https://api.deepseek.com/anthropic.",
  "settings.providers.modelsField": "Models",
  "settings.providers.modelInputPlaceholder": "Enter a model name",
  "settings.providers.fetchModels": "Fetch models",
  "settings.providers.fetchModelsFailed": "Failed to fetch models.",
  "settings.providers.removeModelAria": ({ model }: { model: string }) =>
    `Remove ${model}`,
  "settings.providers.addModelAria": ({ model }: { model: string }) =>
    `Add model: ${model}`,
  "settings.providers.defaultModelField": "Default model",
  "settings.providers.defaultModelPlaceholder": "Select a default model",
  "settings.providers.apiKeyField": "API key",
  "settings.providers.apiKeyOptional": "Optional",
  "settings.providers.showApiKey": "Show API key",
  "settings.providers.hideApiKey": "Hide API key",
  "settings.providers.saveAria": "Save model provider",
  "settings.providers.providerSaved": "Provider saved.",

  // formatProviderModelsSummary.ts
  "providers.modelsSummary.empty": "No models added",
  "providers.modelsSummary.more": ({
    head,
    remaining,
  }: {
    head: string
    remaining: number
  }) => (remaining === 1 ? `${head} +1 more` : `${head} +${remaining} more`),
} satisfies Dictionary
