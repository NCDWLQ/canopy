# Canopy Week One Foundation Implementation Plan

## Scope

This task publishes the minimum project-specific Trellis specs and the first-week delivery framework. It does not scaffold or implement the Canopy application.

## Ordered Checklist

1. Rewrite `.trellis/spec/frontend/component-guidelines.md` with the feature/component boundaries, props conventions, shadcn/Radix ownership, IPC isolation, accessibility requirements, and dedicated frontend-agent write scope from `design.md`.
2. Rewrite `.trellis/spec/backend/database-guidelines.md` with the Rust `sqlx` repository boundary, plugin-managed pool rule, physical SQLite schema, migration rules, indexes, immutable-node invariants, and recursive CTE contract.
3. Rewrite `.trellis/spec/backend/error-handling.md` with the Rust error taxonomy, serializable Tauri command error, logging/redaction boundary, TypeScript normalization, and UI presentation rules.
4. Rewrite both frontend and backend `quality-guidelines.md` files with their layer-specific portions of the testing strategy and cross-layer regression requirements.
5. Update frontend/backend spec indexes from `To fill` to `Initial` for only the completed files; leave unrelated scaffold specs untouched.
6. Re-read the five specs together and verify that component -> bridge -> command -> service -> repository -> SQLite data flow has one owner at each boundary.

## Validation

```bash
python3 ./.trellis/scripts/task.py validate 08-09-canopy-week-one-foundation
rg -n "\(To be filled by the team\)|TBD" \
  .trellis/spec/frontend/component-guidelines.md \
  .trellis/spec/frontend/quality-guidelines.md \
  .trellis/spec/backend/database-guidelines.md \
  .trellis/spec/backend/error-handling.md \
  .trellis/spec/backend/quality-guidelines.md
rg -n "recursive|root_node_id|parent_id|CommandError|Testing Requirements" \
  .trellis/spec/frontend .trellis/spec/backend
```

The first `rg` command must return no matches. The second is an inspection aid and must show ownership of every required contract.

## Review Gates

- Confirm no frontend spec permits direct SQL or raw `invoke` calls from components.
- Confirm schema rules prevent cross-conversation parents and more than one root.
- Confirm root-to-active queries fail closed instead of injecting full history.
- Confirm edits are insert-only branches, not updates to historical content.
- Confirm tests assert absence of sibling content, not merely presence of ancestors.
- Confirm errors cannot expose credentials, prompts, raw provider responses, or local database paths.
- Confirm the frontend agent can build against typed fixtures without editing Rust, Zustand, or IPC ownership files, and that the main session owns integration changes.

## Risk and Rollback Points

- If Tauri SQL plugin state types change, retain the repository/service contract and replace only the pool adapter.
- If the selected migration execution path cannot preserve deferred root integrity, stop and revise the schema contract before product implementation; do not silently weaken `root_node_id` or cross-conversation constraints.
- Spec edits are independent documentation changes and can be reverted file by file without affecting product data.
