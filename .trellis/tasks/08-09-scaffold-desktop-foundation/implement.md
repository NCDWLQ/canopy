# Canopy Desktop Foundation Implementation Plan

## Ordered Checklist

1. Snapshot protected Trellis/Codex files and verify the current `.git` directory is empty.
2. Initialize Git directly on `main` without retaining the empty placeholder, then add MIT license/ignore/README foundations.
3. Create the pnpm/Vite React TypeScript manifest and configuration without using a destructive root generator.
4. Install and lock frontend runtime, build, lint, test, Tailwind, and local Tauri CLI dependencies.
5. Add the minimal React entry, global Tailwind stylesheet, accessible smoke component, and Vitest/Testing Library setup.
6. Initialize shadcn with Nova + Radix + Neutral; inspect `components.json`, CSS, utility files, and generated dependency changes.
7. Initialize Tauri 2 with identifier `app.canopy.desktop`, dev port `1420`, and local pnpm commands.
8. Register `tauri-plugin-sql` with SQLite, a non-domain bootstrap migration/preload, compatible direct `sqlx`, and minimal capabilities without frontend SQL execution.
9. Add Rust/toolchain configuration and smoke tests; confirm a single compatible sqlx/SQLite dependency stack.
10. Run the complete validation matrix and compare protected-file snapshots.
11. Update README with only commands proven by the completed checks.

## Validation Commands

```bash
git status --short --branch
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm tauri info
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
cargo tree --manifest-path src-tauri/Cargo.toml | rg 'tauri-plugin-sql|sqlx|sqlite'
pnpm tauri build --debug --no-bundle
```

## Review Gates

- No protected Trellis/Codex instruction file changed unexpectedly.
- The repository uses pnpm only and has exactly one lockfile.
- Tauri CLI is local and all documented commands use `pnpm tauri`.
- shadcn info matches Vite, Radix, Nova, Neutral, aliases, and Tailwind configuration.
- Webview capabilities do not allow raw SQL select/execute.
- No Node/Conversation tables, product UI, provider code, or tree state implementation appears.
- Build/test commands succeed from a clean lockfile install.

## Risk and Rollback Points

- Git was initialized directly at the developer's request; preserve recovery through small reviewed commits from this point onward.
- Dependency installation requires network access and may need sandbox escalation.
- Generated Tauri icons/binaries are accepted only in their conventional scaffold paths; generated caches/build outputs remain ignored.
- If a generator touches protected paths, stop, restore only that generator's changes, and use explicit file creation instead.
