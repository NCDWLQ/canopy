# Define Canopy Week One Foundation

## Goal

Create an executable first-week work framework for Canopy, an open-source desktop LLM client whose conversation branches are first-class data and whose model context contains only the path from the root node to the active node.

## Background

- The official product name is **Canopy**.
- Canopy is starting from an empty product repository with Trellis scaffolding already initialized.
- The MVP must prove the tree-native conversation model before adding broader visualization or synchronization capabilities.

## Requirements

### Product scope

- Provide a sidebar outline tree for navigating a conversation.
- Allow a user to create a branch from any assistant response.
- Editing a historical message must create a new branch without overwriting existing history, preserving traceability.
- Model requests must inject context only from the root node through the currently active node.
- Conversation branches must be represented directly by the persistence and state models rather than simulated as copied conversations.

### Fixed technology choices

- Open-source license: MIT.
- Desktop shell: Tauri 2.x with Rust and the operating-system webview.
- Frontend: React, Vite, TypeScript, shadcn/ui, Radix UI, and Tailwind CSS.
- Client tree state: Zustand, including parent/child relations and the active node.
- Persistence: local-first SQLite through the Tauri SQL plugin, with no self-hosted backend. Rust repositories use the plugin-managed `sqlx` SQLite pool and expose domain operations through typed Tauri commands; the frontend cannot execute SQL directly.
- Model integration: an OpenAI-compatible provider abstraction that does not bind the product to one vendor.
- Core records:
  - `Node`: `id`, self-referencing `parent_id`, `conversation_id`, `role`, `content`, `model`, `created_at`, JSON metadata, and `is_archived`.
  - `Conversation`: `id`, `title`, and `root_node_id`.

### First-week planning outputs

- Define a small, ordered first-week delivery framework rather than attempting the entire MVP at once.
- Establish minimum executable specs for:
  - frontend component structure;
  - `Node` and `Conversation` schema plus recursive-CTE path-query rules;
  - cross-layer error handling;
  - testing strategy.
- Define the Rust repository and Tauri-command boundary without introducing an ORM or a second SQLite connection pool.
- Make the shadcn/Radix frontend implementation independently assignable by the developer to a dedicated agent with explicit file ownership and mocked typed contracts; this task does not dispatch that product-development agent.

## Acceptance Criteria

- [x] The first-week plan is decomposed into small, ordered, independently verifiable outcomes.
- [x] The frontend spec assigns ownership for the tree navigator, message/thread view, branch actions, provider settings, and shared primitives.
- [x] The database spec defines constraints and indexes for `Node` and `Conversation`, including root consistency and non-destructive history.
- [x] The database spec includes a deterministic recursive CTE contract for loading only the root-to-active-node path.
- [x] The error-handling spec defines typed boundaries from SQLite/provider/Rust failures through Tauri commands to actionable UI states.
- [x] The testing spec covers unit, component, Rust/integration, migration, and root-to-active-path regression tests at an MVP-appropriate level.
- [x] The database access spec keeps SQL in Rust repositories, uses the Tauri SQL plugin's managed pool and migrations, and does not grant frontend SQL execution permissions.
- [x] The first-week framework defines a conflict-free frontend-agent workstream, its dependency on shared DTO contracts, and its integration acceptance gate.
- [x] All planning artifacts clearly keep V2 capabilities out of the first-week and MVP scope.

## Out of Scope

- Canvas-style conversation visualization.
- References across branches.
- Summary compression for long paths.
- Optional self-hosted synchronization.
- Full production implementation of the MVP during this planning task.
