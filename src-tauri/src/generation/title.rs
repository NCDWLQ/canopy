use std::future::Future;

use secrecy::SecretString;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime};
use tokio_util::sync::CancellationToken;

use crate::conversations::{parse_title, AutoTitleContext, ConversationPersistenceService};
use crate::llm::{
    adapters::anthropic, OpenAiCompatibleClient, Protocol, TitlePrompt, ValidatedEndpoint,
};
use crate::settings::{SettingsService, TitleModelBinding};

use super::title_prompt::build_title_prompt;
use crate::providers::{domain::validate_model, Provider, ProviderService};
use crate::usage::{UsageService, UsageSource};

pub(crate) const TITLE_UPDATED_EVENT: &str = "conversation://title-updated";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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
    let pool_for_usage = pool.clone();
    let conversation_for_usage = conversation_id.to_owned();
    run_auto_title_with(
        pool,
        provider_service,
        conversation_id,
        move |provider, model, secret, prompt| {
            generate_title_from_provider(
                pool_for_usage,
                conversation_for_usage,
                provider,
                model,
                secret,
                prompt,
            )
        },
        |payload| app.emit(TITLE_UPDATED_EVENT, payload).map_err(|_| ()),
    )
    .await
}

async fn generate_title_from_provider(
    pool: SqlitePool,
    conversation_id: String,
    provider: Provider,
    model: String,
    secret: Option<SecretString>,
    prompt: TitlePrompt,
) -> Result<String, ()> {
    let endpoint =
        ValidatedEndpoint::parse(&provider.base_endpoint, provider.protocol).map_err(|_| ())?;
    let client = OpenAiCompatibleClient::new().map_err(|_| ())?;
    let cancellation = CancellationToken::new();
    let provider_id = provider.id.clone();
    let generated = match provider.protocol {
        Protocol::OpenAiCompatible => {
            let model = validate_model(&model).map_err(|_| ())?;
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
    UsageService::new(pool)
        .record_best_effort(
            Some(&conversation_id),
            None,
            UsageSource::Title,
            &provider_id,
            &model,
            generated.usage,
        )
        .await;
    Ok(generated.content)
}

async fn run_auto_title_with<G, Fut, E>(
    pool: SqlitePool,
    provider_service: ProviderService,
    conversation_id: &str,
    generate: G,
    emit: E,
) -> Result<(), ()>
where
    G: FnOnce(Provider, String, Option<SecretString>, TitlePrompt) -> Fut,
    Fut: Future<Output = Result<String, ()>>,
    E: FnOnce(TitleUpdatedPayload) -> Result<(), ()>,
{
    let settings = SettingsService::new(pool.clone());
    if !settings.get_auto_generate_title().await.map_err(|_| ())? {
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
    let expected_title = context.conversation.title.clone();
    if expected_title != derived_placeholder_title(&context.first_user_content) {
        return Ok(());
    }
    let configured_binding = settings.get_title_model_binding().await.map_err(|_| ())?;
    let (provider, model) =
        resolve_provider_and_model(&provider_service, &context, configured_binding).await?;
    let (_, secret) = provider_service
        .load_by_id_with_secret(&provider.id)
        .await
        .map_err(|_| ())?;
    let prompt = build_title_prompt(&context.first_user_content);
    let generated = generate(provider, model, secret, prompt).await?;
    let title = clean_title(&generated).ok_or(())?;
    let updated = persistence
        .update_title_if_current(conversation_id, &expected_title, &title)
        .await
        .map_err(|_| ())?;
    if !updated {
        log::warn!(
            "operation=auto_generate_title code=title_cas_mismatch conversation_id={conversation_id}"
        );
        return Ok(());
    }
    emit(TitleUpdatedPayload {
        conversation_id: conversation_id.to_owned(),
        title,
    })
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

/// Matches `deriveConversationTitle` in the frontend: collapse Unicode
/// whitespace, then cap at 40 scalars with an ellipsis. Auto-title HTTP
/// runs only while the stored title is still that create-time placeholder,
/// so a completed title or a manual rename is not replaced on retry.
const PLACEHOLDER_TITLE_LIMIT: usize = 40;

fn derived_placeholder_title(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let mut title = String::new();
    for _ in 0..PLACEHOLDER_TITLE_LIMIT {
        match chars.next() {
            Some(ch) => title.push(ch),
            None => return normalized,
        }
    }
    if chars.next().is_some() {
        title.push('…');
        title
    } else {
        normalized
    }
}

fn clean_title(raw: &str) -> Option<String> {
    let single_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let unquoted = strip_wrapping_quotes(&single_line);
    let unprefixed = strip_title_prefix(unquoted).trim();
    parse_title(unprefixed).ok()
}

/// Strips a single leading `Title:` / `标题:` / `标题：` prefix. Quotes are
/// removed first, so stacked wrappers (`"Title: Foo"`) are also handled.
/// The colon is mandatory and only one pass runs — "标题党现象讨论" and
/// double prefixes keep their remaining text (design.md §3).
fn strip_title_prefix(value: &str) -> &str {
    const ASCII_PREFIX: &[u8] = b"title:";
    if let Some(rest) = value
        .strip_prefix("标题：")
        .or_else(|| value.strip_prefix("标题:"))
    {
        return rest.trim_start();
    }
    let bytes = value.as_bytes();
    if bytes.len() >= ASCII_PREFIX.len()
        && bytes[..ASCII_PREFIX.len()].eq_ignore_ascii_case(ASCII_PREFIX)
    {
        return value[ASCII_PREFIX.len()..].trim_start();
    }
    value
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
    use std::{
        str::FromStr,
        sync::{Arc, Mutex},
    };

    use secrecy::SecretString;
    use serde_json::json;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    use crate::{
        conversations::{ConversationPersistenceService, NewConversation, NewNode, Role},
        infra::database::MIGRATION_CATALOG,
        providers::{CredentialStore, ProviderError, ProviderService},
        settings::{SettingsService, TitleModelBinding},
    };

    use super::{
        clean_title, derived_placeholder_title, resolve_provider_and_model, run_auto_title_with,
        TitleUpdatedPayload, TITLE_UPDATED_EVENT,
    };

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    }

    async fn migrated_pool() -> sqlx::SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        for migration in MIGRATION_CATALOG {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
        }
        pool
    }

    async fn insert_provider(pool: &sqlx::SqlitePool, id: &str, model: &str) {
        sqlx::query(
            "INSERT INTO providers \
               (id, name, protocol, base_endpoint, model, models, credential_ref, created_at, updated_at) \
             VALUES (?1, ?2, 'openai_compatible', 'https://provider.example/v1', ?3, ?4, NULL, 1, 1)",
        )
        .bind(id)
        .bind(id)
        .bind(model)
        .bind(serde_json::json!([model]).to_string())
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_first_user(pool: &sqlx::SqlitePool) -> ConversationPersistenceService {
        let persistence = ConversationPersistenceService::new(pool.clone());
        persistence
            .create_conversation(
                NewConversation {
                    id: "conversation".to_owned(),
                    title: "用户问题".to_owned(),
                    root_node_id: "user".to_owned(),
                },
                NewNode {
                    id: "user".to_owned(),
                    parent_id: None,
                    conversation_id: "conversation".to_owned(),
                    role: Role::User,
                    content: "用户问题".to_owned(),
                    model: None,
                    created_at: 1,
                    metadata: json!({}),
                },
            )
            .await
            .unwrap();
        persistence
    }

    async fn stored_title(pool: &sqlx::SqlitePool) -> String {
        sqlx::query_scalar("SELECT title FROM conversations WHERE id = 'conversation'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    struct NoopCredentialStore;

    impl CredentialStore for NoopCredentialStore {
        fn set(&self, _: &str, _: &SecretString) -> Result<(), ProviderError> {
            Ok(())
        }

        fn get(&self, _: &str) -> Result<Option<SecretString>, ProviderError> {
            Ok(None)
        }

        fn delete(&self, _: &str) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    fn provider_service(pool: sqlx::SqlitePool) -> ProviderService {
        ProviderService::new(pool, Arc::new(NoopCredentialStore))
    }

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

    #[test]
    fn title_cleanup_strips_one_title_prefix() {
        assert_eq!(clean_title("Title: Foo").as_deref(), Some("Foo"));
        assert_eq!(clean_title("TITLE: Foo").as_deref(), Some("Foo"));
        assert_eq!(clean_title("title:Foo").as_deref(), Some("Foo"));
        assert_eq!(clean_title("标题：东京三日").as_deref(), Some("东京三日"));
        assert_eq!(clean_title("标题:东京三日").as_deref(), Some("东京三日"));
        assert_eq!(clean_title("\"Title: Foo\"").as_deref(), Some("Foo"));
        assert_eq!(
            clean_title("Title: 标题: 双重").as_deref(),
            Some("标题: 双重")
        );
    }

    #[test]
    fn title_cleanup_keeps_content_without_prefix_colon() {
        assert_eq!(
            clean_title("标题党现象讨论").as_deref(),
            Some("标题党现象讨论")
        );
    }

    #[test]
    fn placeholder_title_mirrors_frontend_derivation() {
        assert_eq!(derived_placeholder_title("用户问题"), "用户问题");
        assert_eq!(derived_placeholder_title("  a\n\tb  "), "a b");
        assert_eq!(
            derived_placeholder_title("\u{3000}First\u{00a0}\t prompt\nline\u{2029}"),
            "First prompt line"
        );
        assert_eq!(
            derived_placeholder_title(&"字".repeat(41)),
            format!("{}…", "字".repeat(40))
        );
        assert_eq!(derived_placeholder_title(&"字".repeat(40)), "字".repeat(40));
        let emoji_prefix = "🙂".repeat(39);
        assert_eq!(
            derived_placeholder_title(&format!("{emoji_prefix}界tail")),
            format!("{emoji_prefix}界…")
        );
        assert_eq!(
            derived_placeholder_title(&format!("{emoji_prefix}界")),
            format!("{emoji_prefix}界")
        );
    }

    #[test]
    fn enabled_first_user_updates_title_and_emits_exact_global_event() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            let emitted = Arc::new(Mutex::new(None));
            let emit_slot = emitted.clone();
            run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_provider, _model, _secret, prompt| {
                    assert!(prompt.user.contains("<user_message>"));
                    assert!(prompt.user.contains("用户问题"));
                    assert!(!prompt.user.contains("<assistant>"));
                    assert!(!prompt.user.contains("助手"));
                    std::future::ready(Ok("  “生成标题”  ".to_owned()))
                },
                move |payload| {
                    *emit_slot.lock().unwrap() = Some(payload);
                    Ok(())
                },
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "生成标题");
            let payload = emitted.lock().unwrap().clone().unwrap();
            assert_eq!(
                payload,
                TitleUpdatedPayload {
                    conversation_id: "conversation".to_owned(),
                    title: "生成标题".to_owned(),
                }
            );
            assert_eq!(TITLE_UPDATED_EVENT, "conversation://title-updated");
            assert_eq!(
                serde_json::to_value(&payload).unwrap(),
                json!({ "conversation_id": "conversation", "title": "生成标题" })
            );
        });
    }

    #[test]
    fn disabled_or_already_titled_is_a_noop() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            let settings = SettingsService::new(pool.clone());
            settings.set_auto_generate_title(false).await.unwrap();
            run_auto_title_with(
                pool.clone(),
                service.clone(),
                "conversation",
                |_, _, _, _| async {
                    panic!("disabled auto-title must not call the title provider")
                },
                |_| panic!("disabled auto-title must not emit"),
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "用户问题");

            settings.set_auto_generate_title(true).await.unwrap();
            run_auto_title_with(
                pool.clone(),
                service.clone(),
                "conversation",
                |_, _, _, _| std::future::ready(Ok("生成标题".to_owned())),
                |_| Ok(()),
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "生成标题");

            run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_, _, _, _| async {
                    panic!("retry after a successful title must not call the title provider")
                },
                |_| panic!("retry after a successful title must not emit"),
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "生成标题");
        });
    }

    #[test]
    fn title_provider_falls_back_from_binding_to_conversation_to_active() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            insert_provider(&pool, "bound", "bound-model").await;
            insert_provider(&pool, "conversation-bound", "conversation-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let persistence = seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            let settings = SettingsService::new(pool.clone());

            service
                .set_title_model_binding(Some(TitleModelBinding {
                    provider_id: "bound".to_owned(),
                    model: "bound-model".to_owned(),
                }))
                .await
                .unwrap();
            let context = persistence
                .load_auto_title_context("conversation")
                .await
                .unwrap()
                .unwrap();
            let (provider, model) = resolve_provider_and_model(
                &service,
                &context,
                settings.get_title_model_binding().await.unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(provider.id, "bound");
            assert_eq!(model, "bound-model");

            service.set_title_model_binding(None).await.unwrap();
            persistence
                .set_provider_binding(
                    "conversation",
                    Some("conversation-bound".to_owned()),
                    Some("conversation-override".to_owned()),
                    None,
                )
                .await
                .unwrap();
            let context = persistence
                .load_auto_title_context("conversation")
                .await
                .unwrap()
                .unwrap();
            let (provider, model) = resolve_provider_and_model(&service, &context, None)
                .await
                .unwrap();
            assert_eq!(provider.id, "conversation-bound");
            assert_eq!(model, "conversation-override");

            persistence
                .set_provider_binding("conversation", None, None, None)
                .await
                .unwrap();
            let context = persistence
                .load_auto_title_context("conversation")
                .await
                .unwrap()
                .unwrap();
            let (provider, model) = resolve_provider_and_model(&service, &context, None)
                .await
                .unwrap();
            assert_eq!(provider.id, "active");
            assert_eq!(model, "active-model");
        });
    }

    #[test]
    fn missing_configured_title_provider_skips_instead_of_falling_through() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("INSERT INTO app_settings (key, value) VALUES ('title_model_binding', ?1)")
                .bind(r#"{"provider_id":"missing","model":"gone"}"#)
                .execute(&pool)
                .await
                .unwrap();
            seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            let result = run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_, _, _, _| async {
                    panic!("a missing title binding provider must not fall through to HTTP")
                },
                |_| panic!("a missing title binding provider must not emit"),
            )
            .await;
            assert!(result.is_err());
            assert_eq!(stored_title(&pool).await, "用户问题");
        });
    }

    #[test]
    fn title_generation_failure_is_non_fatal_and_keeps_placeholder() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            let result = run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_, _, _, _| std::future::ready(Err(())),
                |_| panic!("failed title generation must not emit"),
            )
            .await;
            assert!(result.is_err());
            assert_eq!(stored_title(&pool).await, "用户问题");
        });
    }

    #[test]
    fn manual_rename_during_title_generation_is_kept_by_cas() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let persistence = seed_first_user(&pool).await;
            let service = provider_service(pool.clone());
            run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                {
                    let persistence = persistence.clone();
                    move |_, _, _, _| {
                        let persistence = persistence.clone();
                        async move {
                            persistence
                                .rename_conversation("conversation", "手动标题")
                                .await
                                .unwrap();
                            Ok("自动标题".to_owned())
                        }
                    }
                },
                |_| panic!("a CAS miss must not emit"),
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "手动标题");
        });
    }

    #[test]
    fn later_nodes_do_not_change_the_first_user_excerpt_or_block_title() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let persistence = seed_first_user(&pool).await;
            persistence
                .append_completed_assistant(NewNode {
                    id: "assistant".to_owned(),
                    parent_id: Some("user".to_owned()),
                    conversation_id: "conversation".to_owned(),
                    role: Role::Assistant,
                    content: "助手回答不得进入标题提示词".to_owned(),
                    model: Some("active-model".to_owned()),
                    created_at: 2,
                    metadata: json!({}),
                })
                .await
                .unwrap();
            persistence
                .append_user_node(NewNode {
                    id: "user-2".to_owned(),
                    parent_id: Some("assistant".to_owned()),
                    conversation_id: "conversation".to_owned(),
                    role: Role::User,
                    content: "第二条用户消息".to_owned(),
                    model: None,
                    created_at: 3,
                    metadata: json!({}),
                })
                .await
                .unwrap();
            let service = provider_service(pool.clone());
            let emitted = Arc::new(Mutex::new(None));
            let emit_slot = emitted.clone();
            run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_provider, _model, _secret, prompt| {
                    assert!(prompt.user.contains("用户问题"));
                    assert!(!prompt.user.contains("助手回答"));
                    assert!(!prompt.user.contains("第二条用户消息"));
                    std::future::ready(Ok("生成标题".to_owned()))
                },
                move |payload| {
                    *emit_slot.lock().unwrap() = Some(payload);
                    Ok(())
                },
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "生成标题");
            assert_eq!(emitted.lock().unwrap().as_ref().unwrap().title, "生成标题");
        });
    }

    #[test]
    fn manual_rename_before_title_start_skips_http() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            let persistence = seed_first_user(&pool).await;
            persistence
                .rename_conversation("conversation", "手动标题")
                .await
                .unwrap();
            let service = provider_service(pool.clone());
            run_auto_title_with(
                pool.clone(),
                service,
                "conversation",
                |_, _, _, _| async {
                    panic!("a renamed conversation must not call the title provider")
                },
                |_| panic!("a renamed conversation must not emit"),
            )
            .await
            .unwrap();
            assert_eq!(stored_title(&pool).await, "手动标题");
        });
    }

    #[test]
    fn overlapping_title_jobs_keep_the_first_cas_write() {
        test_runtime().block_on(async {
            let pool = migrated_pool().await;
            insert_provider(&pool, "active", "active-model").await;
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ('active_provider_id', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            seed_first_user(&pool).await;
            let hold_late = Arc::new(tokio::sync::Notify::new());
            let late_ready = Arc::new(tokio::sync::Notify::new());
            let emitted_late = Arc::new(Mutex::new(None));
            let emitted_early = Arc::new(Mutex::new(None));

            let late = {
                let hold_late = hold_late.clone();
                let late_ready = late_ready.clone();
                let emit_slot = emitted_late.clone();
                run_auto_title_with(
                    pool.clone(),
                    provider_service(pool.clone()),
                    "conversation",
                    move |_, _, _, _| {
                        let hold_late = hold_late.clone();
                        let late_ready = late_ready.clone();
                        async move {
                            late_ready.notify_one();
                            hold_late.notified().await;
                            Ok("后到标题".to_owned())
                        }
                    },
                    move |payload| {
                        *emit_slot.lock().unwrap() = Some(payload);
                        Ok(())
                    },
                )
            };
            let early = {
                let late_ready = late_ready.clone();
                let hold_late = hold_late.clone();
                let emit_slot = emitted_early.clone();
                let pool = pool.clone();
                async move {
                    late_ready.notified().await;
                    let result = run_auto_title_with(
                        pool.clone(),
                        provider_service(pool),
                        "conversation",
                        |_, _, _, _| std::future::ready(Ok("先到标题".to_owned())),
                        move |payload| {
                            *emit_slot.lock().unwrap() = Some(payload);
                            Ok(())
                        },
                    )
                    .await;
                    hold_late.notify_one();
                    result
                }
            };

            let (late_result, early_result) = futures_util::future::join(late, early).await;
            late_result.unwrap();
            early_result.unwrap();
            assert_eq!(stored_title(&pool).await, "先到标题");
            assert!(emitted_late.lock().unwrap().is_none());
            assert_eq!(
                emitted_early.lock().unwrap().as_ref().unwrap().title,
                "先到标题"
            );
        });
    }
}
