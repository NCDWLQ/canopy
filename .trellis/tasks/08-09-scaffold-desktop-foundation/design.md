# Canopy Desktop Foundation Design

## Architecture

This task creates the buildable shell that later feature tasks consume:

```text
pnpm workspace root
  -> Vite + React + TypeScript frontend
  -> Tailwind 4 + shadcn Nova/Radix/Neutral
  -> local @tauri-apps/cli
  -> Tauri 2 Rust application
  -> tauri-plugin-sql managed SQLite pool/migrations
```

No product domain flows are implemented. The shell establishes tool ownership, directory boundaries, scripts, and smoke tests only.

## Safe Scaffold Strategy

The root already contains Trellis/Codex configuration and an invalid empty `.git` directory, so generators must not run with destructive overwrite flags.

1. Confirm the existing `.git` directory is still empty.
2. Initialize a new `main` repository directly, without retaining the empty placeholder. This requires an explicit elevated filesystem operation because the environment exposes `.git` specially.
3. Create the JavaScript manifest and Vite files explicitly in the root, preserving every pre-existing path.
4. Install packages with pnpm so the lockfile records resolved versions.
5. Initialize Tauri into the new `src-tauri/` directory only after inspecting the installed CLI help/options.
6. Initialize shadcn only after Vite, Tailwind, and the `@/*` alias are valid. Preview/inspect generated files and do not apply overwrite flags.

Before and after scaffolding, record the existence and hashes of `.trellis/workflow.md`, `.trellis/config.yaml`, `.codex/config.toml`, `.codex/hooks.json`, `AGENTS.md`, and `.gitattributes`. Any unexpected change stops the task.

## Frontend Foundation

Expected root layout:

```text
index.html
package.json
pnpm-lock.yaml
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
eslint.config.js
components.json
src/
  app/
  components/ui/
  features/
  lib/
    utils.ts
  test/
    setup.ts
  App.tsx
  main.tsx
  index.css
```

- Vite serves on port `1420` with `strictPort: true`; Tauri uses the same dev URL.
- `vite.config.ts` registers React, Tailwind, the `@` alias, and ignores `src-tauri/**` in the watcher.
- Tailwind uses its Vite plugin and a single global stylesheet.
- shadcn config uses the Nova preset, Radix base, Neutral tokens, CSS variables, and project aliases.
- `App.tsx` is a minimal accessible scaffold marker, not a product layout or chat interface.
- Empty feature directories use tracked README/placeholder documentation only when Git cannot retain the directory otherwise; do not pre-create speculative components.

## Package and Script Contract

`package.json` uses ESM, pnpm `11.12.0`, and Node 24.x. Required scripts:

| Script | Contract |
|---|---|
| `dev` | Run Vite development server |
| `build` | Type-check project references, then build Vite production assets |
| `lint` | Run ESLint over the frontend/config sources |
| `typecheck` | Run TypeScript without emitting |
| `test` | Run Vitest once |
| `test:watch` | Run Vitest in watch mode |
| `tauri` | Invoke the local Tauri CLI |
| `check` | Run lint, type-check, tests, and frontend build in a stable order |

Runtime dependencies are React, React DOM, Zustand, and `@tauri-apps/api`. Development dependencies cover Vite, TypeScript, React types/plugin, Tailwind Vite integration, ESLint, Vitest, jsdom, Testing Library, and local `@tauri-apps/cli`.

## Rust and Tauri Foundation

Expected Rust layout:

```text
rust-toolchain.toml
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/default.json
  icons/
  migrations/
  src/lib.rs
  src/main.rs
```

- Tauri identifier: `app.canopy.desktop`.
- `src/lib.rs` exposes the mobile-compatible `run` entry; `main.rs` calls it for desktop.
- The Tauri SQL plugin owns SQLite preload and migrations. Add one harmless bootstrap migration that proves the runner works without defining Node/Conversation product tables (for example, a private schema-version marker).
- Rust commands do not expose SQL to the frontend. The default capability must omit `sql:allow-select` and `sql:allow-execute`.
- Add a direct `sqlx` dependency compatible with the version resolved by the pinned `tauri-plugin-sql`; verify with `cargo tree` and avoid a second SQLite pool.
- Rust tests prove the application builder/configuration helper can be constructed without launching a GUI where practical; otherwise keep one pure smoke unit test and rely on `tauri build --debug --no-bundle` for integration compilation.

## Test and Quality Baseline

- Frontend smoke test renders the scaffold marker with accessible queries.
- Test setup loads `jest-dom` matchers and resets shared state/mocks.
- ESLint covers TypeScript/React and rejects warnings in CI-style checks.
- TypeScript uses strict mode and no unchecked `any` in authored files.
- Rust uses rustfmt, Clippy with warnings denied, and unit tests.
- `pnpm tauri info` is recorded after installation.
- `pnpm tauri build --debug --no-bundle` is the full local compile gate; no Linux bundle is produced in this task.

## Error and Security Baseline

- Do not add secrets or provider configuration.
- CSP and Tauri capabilities remain minimal; only capabilities required by the empty shell/plugin initialization are enabled.
- No frontend SQL permissions are granted even though the core SQL plugin is registered.
- Generated lockfiles are committed; install scripts must not depend on global Tauri or shadcn binaries.

## Compatibility and Rollback

- Git was initialized directly at the developer's request; there is no placeholder backup. Rollback relies on the task's first commit rather than a second Git directory.
- Package installation failures leave manifests reviewable; retry with network approval rather than changing package managers.
- If shadcn generation conflicts with existing files, stop and merge with `--diff`/manual patching instead of overwriting.
- If Tauri plugin and direct `sqlx` versions conflict, keep the plugin and align the direct dependency; do not introduce a second pool or remove the plugin to force resolution.
