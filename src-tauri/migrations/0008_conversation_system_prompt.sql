-- Per-conversation system prompt override. NULL means follow the global
-- default (`app_settings.default_system_prompt`). There is no "explicitly
-- unused" third state.
ALTER TABLE conversations ADD COLUMN system_prompt TEXT;
