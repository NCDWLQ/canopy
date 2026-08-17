# Canopy

Canopy 是一款**本地优先**的桌面 AI 对话应用。对话数据保存在本机 SQLite 数据库中，API 密钥通过系统密钥链安全存储，支持 OpenAI 兼容与 Anthropic 两类协议，并提供分支式对话树、流式生成与多 Provider 管理。

## 功能特性

- **对话树与分支** — 以树形结构组织消息，支持创建分支、编辑用户消息并重新生成回复
- **多 Provider 管理** — 配置多个模型服务（OpenAI 兼容 / Anthropic Messages），按会话选择 Provider 与模型
- **流式生成** — 实时展示助手回复与思考过程（thinking），支持取消进行中的生成
- **本地持久化** — 会话、消息树与 Provider 配置均存储在本机，无需云端账号
- **安全凭据** — API 密钥存入操作系统密钥链（Keyring），数据库中不保存明文密钥
- **会话归档** — 将不需要的会话移入归档，保持侧边栏整洁

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | [Tauri 2](https://v2.tauri.app/) |
| 前端 | React 19、TypeScript、Vite 8、Tailwind CSS 4、[shadcn/ui](https://ui.shadcn.com/) |
| 状态 | Zustand（前端）+ SQLite（持久化） |
| 后端 | Rust 1.97、sqlx、reqwest |
| 测试 | Vitest、Testing Library、cargo test |

## 环境要求

- **Node.js** 24.x
- **pnpm** 11.21.0（见 `package.json` 中的 `packageManager` 字段）
- **Rust** 1.97.1（由 `rust-toolchain.toml` 自动选择）
- **Tauri 系统依赖** — 按你的操作系统安装 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)

## 快速开始

### 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 开发模式

启动完整桌面应用（推荐）：

```bash
pnpm tauri dev
```

仅启动前端开发服务器（`http://localhost:1420`，不含 Tauri 后端）：

```bash
pnpm dev
```

首次运行桌面应用时，请在设置中配置 Provider（基础端点、模型、API 密钥），然后开始新对话。

## 质量检查

运行完整前端质量门禁：

```bash
pnpm check
```

单独运行各项检查：

```bash
pnpm format:check   # Prettier 格式
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # Vitest
pnpm build          # 生产构建
```

Rust 后端检查：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

编译调试版桌面应用（不打包）：

```bash
pnpm tauri info
pnpm tauri build --debug --no-bundle
```

## 项目结构

```
canopy/
├── src/                          # React 前端
│   ├── features/
│   │   ├── conversations/        # 对话树 UI、Composer、状态管理
│   │   └── providers/            # Provider 设置与模型选择
│   ├── components/ui/            # shadcn/ui 组件
│   └── lib/tauri/                # Tauri IPC 桥接（Zod 校验）
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── conversations/        # 对话 CRUD、树操作
│   │   └── providers/            # Provider 配置、HTTP 生成、凭据
│   ├── migrations/               # SQLite 迁移
│   └── tests/                    # 集成与契约测试
├── .trellis/                     # Trellis 工作流与编码规范
└── .github/workflows/            # CI 构建流水线
```

前端采用**按功能划分**的目录结构：业务逻辑放在 `features/<feature>/` 下，Tauri 调用统一经过 `lib/tauri/` 边界。后端按领域模块组织，命令层（commands）→ 服务层（service）→ 仓储层（repository）分层清晰。

更详细的编码约定见 `.trellis/spec/`。

## CI 构建

GitHub Actions 工作流 **Build desktop clients** 会在 PR、推送到 `main`、版本标签 `v*` 以及手动触发时，为以下平台构建安装包：

| 平台 | 产物 |
|------|------|
| Linux x64 | AppImage、deb |
| Windows x64 | exe（NSIS） |
| macOS Apple Silicon | dmg |
| macOS Intel | dmg |

构建产物为**未签名**版本，可从工作流运行的 **Artifacts** 区域下载。正式发布仍需各平台的代码签名与 macOS 公证。

## 许可证

[MIT](./LICENSE)
