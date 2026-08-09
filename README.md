# Canopy

Canopy is a local-first desktop application foundation built with React, TypeScript, and Tauri 2.

## Prerequisites

- Node.js 24.x
- pnpm 11.12.0
- Rust 1.97.1 (selected automatically by `rust-toolchain.toml`)
- The [Tauri Linux system dependencies](https://v2.tauri.app/start/prerequisites/#linux) for your distribution

## Setup and development

Install the locked JavaScript dependencies:

```bash
pnpm install --frozen-lockfile
```

Start the frontend development server on `http://localhost:1420`:

```bash
pnpm dev
```

## Validation

Run the complete frontend quality gate:

```bash
pnpm check
```

Inspect the native toolchain and compile the debug desktop application without producing a bundle:

```bash
pnpm tauri info
pnpm tauri build --debug --no-bundle
```

Run the Rust checks independently:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```
