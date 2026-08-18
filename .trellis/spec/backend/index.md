# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory records the initial Rust/Tauri conventions established by the
Canopy foundation and first-week architecture.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Rust/Tauri module organization and ownership | Initial |
| [Database Guidelines](./database-guidelines.md) | SQLite schema, repositories, queries, migrations | Initial |
| [Error Handling](./error-handling.md) | Cross-layer error types, redaction, UI handling | Initial |
| [Quality Guidelines](./quality-guidelines.md) | Backend standards and testing strategy | Initial |
| [Logging Guidelines](./logging-guidelines.md) | Diagnostic events, levels, and redaction | Initial |
| [Provider Guidelines](./provider-guidelines.md) | Secure profile storage, OpenAI-compatible SSE, generation commits, and auto-title | Current |

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
