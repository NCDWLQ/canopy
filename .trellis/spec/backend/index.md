# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory records the Rust/Tauri conventions for Canopy's local
application core. Product code is organized by capability:

| Module | Owns |
|--------|------|
| `infra` | `DATABASE_URL`, ordered migration catalog, managed SQLite pool, identity/time |
| `settings` | typed `app_settings` (language, theme, auto-title, title-model binding, default system prompt) |
| `llm` | protocol, endpoint validation, HTTP adapters, model discovery (no SQL/Tauri) |
| `providers` | profiles, keyring credentials, active provider, `list_providers` façade, title-binding validation |
| `conversations` | conversation tree, search, persistence; no provider table SQL |
| `generation` | reply runtime, prepare/run/finalize, conversation-provider binding, system-prompt injection, auto-title |
| `exports` | bounded Markdown file writes (path/content validation + filesystem IO) |
| `error.rs` | `CommandError` IPC mapping only |

Application workflows (`generation`) may compose domains. Domains do not
import application adapters. `list_providers` remains a permanent aggregate
IPC façade.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Rust/Tauri module organization and ownership | Current |
| [App Capabilities](./app-capabilities.md) | Tauri plugin wiring, minimal permissions, OS IO via Rust commands | Current |
| [Database Guidelines](./database-guidelines.md) | SQLite schema, repositories, queries, migrations | Current |
| [Error Handling](./error-handling.md) | Cross-layer error types, redaction, UI handling | Current |
| [Quality Guidelines](./quality-guidelines.md) | Backend standards and testing strategy | Current |
| [Logging Guidelines](./logging-guidelines.md) | Diagnostic events, levels, and redaction | Current |
| [Provider Guidelines](./provider-guidelines.md) | Credentials, LLM protocol, generation commits, and auto-title | Current |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
