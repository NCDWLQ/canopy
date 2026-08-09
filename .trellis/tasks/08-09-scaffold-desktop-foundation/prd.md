# Scaffold Canopy Desktop Foundation

## Goal

Create a reproducible, locally runnable desktop application foundation for Canopy without implementing conversation product features.

## Requirements

### Repository safety

- Replace the current empty, read-only `.git` placeholder with a valid Git repository on branch `main` without losing `.trellis/`, `.codex/`, `.agents/`, `AGENTS.md`, or `.gitattributes`.
- Add an MIT `LICENSE`, project-level ignore rules, and a minimal README with verified development commands.
- Do not overwrite or regenerate existing Trellis-managed files.

### Application scaffold

- Use `app.canopy.desktop` as the local-only Tauri application identifier; no publishing namespace is implied.
- Use pnpm as the sole JavaScript package manager and record its version in `packageManager`.
- Scaffold a Vite React TypeScript frontend in the existing repository root.
- Scaffold Tauri 2 with a Rust library entry point and desktop entry point.
- Install Tauri CLI locally through `@tauri-apps/cli`; do not require global `cargo-tauri`.
- Use Tailwind CSS 4 with the Vite plugin.
- Initialize shadcn/ui with the Nova preset, Radix base, and Neutral color tokens; create a valid `components.json` without building product UI.
- Install Zustand and define only the directory boundary needed for later tree state; do not implement the conversation store.

### Persistence boundary

- Add `tauri-plugin-sql` with SQLite support and register migrations/preload through the Rust plugin.
- Add a direct `sqlx` dependency compatible with the plugin-resolved version for future Rust repositories.
- Do not grant frontend `sql:allow-select` or `sql:allow-execute` permissions.
- Do not create the Node/Conversation product migration in this scaffold task.

### Quality baseline

- Configure formatting, linting, TypeScript checking, Vitest, React Testing Library, and Rust fmt/clippy/test commands.
- Add minimal frontend and Rust smoke tests proving the scaffold is runnable.
- Provide scripts for frontend development/build/tests and Tauri development/build.
- Verify the native Tauri prerequisites, frontend production build, Rust tests, and Tauri compilation.

## Acceptance Criteria

- [x] `git status` succeeds on branch `main`, and every pre-existing Trellis/Codex instruction file remains present.
- [x] `pnpm install --frozen-lockfile`, frontend lint, type-check, tests, and production build succeed.
- [x] `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test --all-features` succeed.
- [x] `pnpm tauri info` detects the installed Rust and Linux native dependencies.
- [x] `pnpm tauri build --debug --no-bundle` compiles the desktop application without requiring global Tauri tooling.
- [x] `components.json` reports Vite, Radix, Tailwind, aliases, and the selected preset correctly.
- [x] SQLite plugin registration and dependency resolution produce one compatible `sqlx`/SQLite stack, with no frontend SQL execution permissions.
- [x] README commands reproduce the verified local checks.
- [x] No conversation UI, Zustand tree behavior, provider integration, or Node/Conversation schema is implemented.

## Out of Scope

- Conversation tree UI or shadcn product components.
- Zustand conversation state implementation.
- Node/Conversation migrations and repositories.
- OpenAI-compatible provider calls.
- Packaging, signing, updater, CI/CD, mobile targets, and release automation.
