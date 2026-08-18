use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime};
use tokio_util::sync::CancellationToken;

use crate::conversations::{
    commands::validate_title, AutoTitleContext, ConversationPersistenceService,
};

use super::{
    anthropic, openai_compatible::OpenAiCompatibleClient, title_prompt::build_title_prompt,
    Protocol, Provider, ProviderService, TitleModelBinding, ValidatedEndpoint,
};

pub(crate) const TITLE_UPDATED_EVENT: &str = "conversation://title-updated";

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct TitleUpdatedPayload {
    pub conversation_id: String,
    pub title: String,
}

pub(crate) fn spawn_auto_title<R: Runtime>(
    pool: SqlitePool,
    provider_service: ProviderService,
    app: AppHandle<R>,
    conversation_id: String,
) {
    tauri::async_runtime::spawn(async move {
        if run_auto_title(pool, provider_service, app, &conversation_id)
            .await
            .is_err()
        {
            log::warn!(
                "operation=auto_generate_title code=title_generation_skipped conversation_id={conversation_id}"
            );
        }
    });
}

async fn run_auto_title<R: Runtime>(
    pool: SqlitePool,
    provider_service: ProviderService,
    app: AppHandle<R>,
    conversation_id: &str,
) -> Result<(), ()> {
    if !provider_service
        .get_auto_generate_title()
        .await
        .map_err(|_| ())?
    {
        return Ok(());
    }

    let persistence = ConversationPersistenceService::new(pool);
    let Some(context) = persistence
        .load_auto_title_context(conversation_id)
        .await
        .map_err(|_| ())?
    else {
        return Ok(());
    };
    let configured_binding = provider_service
        .get_title_model_binding()
        .await
        .map_err(|_| ())?;
    let (provider, model) =
        resolve_provider_and_model(&provider_service, &context, configured_binding).await?;
    let (_, secret) = provider_service
        .load_by_id_with_secret(&provider.id)
        .await
        .map_err(|_| ())?;
    let endpoint =
        ValidatedEndpoint::parse(&provider.base_endpoint, provider.protocol).map_err(|_| ())?;
    let client = OpenAiCompatibleClient::new().map_err(|_| ())?;
    let cancellation = CancellationToken::new();
    let prompt = build_title_prompt(&context.first_user_content, &context.assistant_content);
    let generated = match provider.protocol {
        Protocol::OpenAiCompatible => {
            client
                .stream_title(&endpoint, &model, secret.as_ref(), &cancellation, &prompt)
                .await
        }
        Protocol::Anthropic => {
            anthropic::stream_title(
                &client,
                &endpoint,
                &model,
                secret.as_ref(),
                &cancellation,
                &prompt,
            )
            .await
        }
    }
    .map_err(|_| ())?;
    let title = clean_title(&generated).ok_or(())?;
    persistence
        .update_title(conversation_id, &title)
        .await
        .map_err(|_| ())?;
    app.emit(
        TITLE_UPDATED_EVENT,
        TitleUpdatedPayload {
            conversation_id: conversation_id.to_owned(),
            title,
        },
    )
    .map_err(|_| ())
}

async fn resolve_provider_and_model(
    provider_service: &ProviderService,
    context: &AutoTitleContext,
    configured_binding: Option<TitleModelBinding>,
) -> Result<(Provider, String), ()> {
    if let Some(binding) = configured_binding {
        let provider = provider_service
            .load_by_id(&binding.provider_id)
            .await
            .map_err(|_| ())?;
        return Ok((provider, binding.model));
    }
    if let Some(provider_id) = context.conversation.provider_id.as_deref() {
        let provider = provider_service
            .load_by_id(provider_id)
            .await
            .map_err(|_| ())?;
        let model = context
            .conversation
            .model
            .clone()
            .unwrap_or_else(|| provider.model.clone());
        return Ok((provider, model));
    }
    let provider = provider_service.load_active().await.map_err(|_| ())?;
    let model = provider.model.clone();
    Ok((provider, model))
}

fn clean_title(raw: &str) -> Option<String> {
    let single_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let unquoted = strip_wrapping_quotes(&single_line);
    validate_title(unquoted).ok()
}

fn strip_wrapping_quotes(value: &str) -> &str {
    let mut value = value.trim();
    loop {
        let mut chars = value.chars();
        let Some(first) = chars.next() else {
            return value;
        };
        let Some(last) = chars.next_back() else {
            return value;
        };
        if !matches!(
            (first, last),
            ('"', '"') | ('\'', '\'') | ('“', '”') | ('‘', '’')
        ) {
            return value;
        }
        let start = first.len_utf8();
        let end = value.len() - last.len_utf8();
        value = value[start..end].trim();
    }
}

#[cfg(test)]
mod tests {
    use super::clean_title;

    #[test]
    fn title_cleanup_removes_quotes_and_line_breaks() {
        assert_eq!(
            clean_title("  “自动\n标题”  ").as_deref(),
            Some("自动 标题")
        );
        assert_eq!(clean_title(" \n\t "), None);
        assert_eq!(clean_title(&"字".repeat(201)), None);
        assert!(clean_title(&"字".repeat(200)).is_some());
    }

    #[test]
    fn title_cleanup_keeps_content_quotes() {
        assert_eq!(
            clean_title("要求输出“HACKED”").as_deref(),
            Some("要求输出“HACKED”")
        );
        assert_eq!(
            clean_title("\"要求输出“HACKED”\"").as_deref(),
            Some("要求输出“HACKED”")
        );
    }
}
