# Quality Guidelines

> Backend quality gates for Canopy's week-one tree and provider-path proof.

---

## Overview

Week one proves the tree-native persistence model and the exact model context;
it does not attempt production packaging or broad end-to-end coverage. Each
ordered backend outcome must leave an independently verifiable artifact:

1. Register the Tauri SQL plugin, managed database, migrations, and baseline
   Rust lint/test commands.
2. Apply the schema and prove conversation creation, append, branching, and the
   root-to-active recursive query against real SQLite.
3. Expose typed service/Tauri command operations and the stable `CommandError`
   contract, including non-destructive edits.
4. Integrate the real typed bridge with the separately built UI fixtures and
   normalized Zustand model.
5. Build one OpenAI-compatible request only from a validated active path and
   pass the branch-isolation regression suite.

Canvas visualization, cross-branch references, path summarization, optional
self-hosted sync, provider breadth, and broad packaging automation are V2 or
post-week-one work.

## Forbidden Patterns

- A second production SQLite pool, direct frontend SQL, or webview SQL
  `select`/`execute` permissions.
- Raw SQL outside Rust repositories, interpolated SQL values, or an ORM added
  without a separately approved design.
- Business transactions in Tauri command functions or persistence invariants
  duplicated in React/TypeScript.
- Mutating historical node content/parentage or implementing a branch by
  copying an entire conversation.
- Building a provider request from a conversation scan, cached UI order, or an
  unvalidated/partial recursive result.
- Returning library errors or unstable strings across IPC, logging secrets or
  prompts, or branching UI behavior on an error message.
- Mock-only repository tests for migration, foreign-key, trigger, transaction,
  or recursive-CTE behavior.
- Tests that prove ancestors are present but never prove sibling content is
  absent.

## Required Patterns

- Format/lint/type/test commands are recorded in the application scaffold and
  run for changed code. Rust code must pass its configured formatter, lints,
  and tests before integration.
- Production repositories receive the plugin-managed `sqlx::SqlitePool`; a
  test-only database factory may create a temporary pool but must exercise the
  same repository code and ordered migrations.
- Shared command names, request/success DTOs, `CommandError`, and normalized
  frontend projections have one owner in the main integration workstream.
  Backend changes update their Rust side and contract fixtures rather than
  creating private variants.
- Tests use deterministic opaque IDs and explicit timestamps/order assertions.
  They do not depend on wall-clock timing or unordered SQLite results.
- Provider request construction accepts the validated ordered path type, not a
  generic node list. This makes an invalid path unrepresentable at that layer.
- Every regression checks the externally meaningful result as well as the
  internal operation: stored rows, returned order, serialized DTO/error, or
  emitted provider messages.

## Testing Requirements

### Rust unit tests

Cover domain validation, service transaction decisions, central error mapping,
command-error serialization, and OpenAI-compatible request construction from a
validated ordered path. Include empty/invalid content rules selected by the
domain contract, supported roles, cancellation, provider mapping, and redaction.

### SQLite repository and migration tests

Run the real ordered migrations against a fresh temporary SQLite database with
foreign keys enabled. Exercise the same repositories used by production.
At minimum, prove:

- a conversation and future designated root commit atomically;
- rollback leaves neither half of a failed conversation/root creation;
- child ordering is deterministic by `created_at, id`;
- cross-conversation parents, self-parenting, and multiple structural roots
  fail;
- the designated root cannot have a parent, cannot be inserted as archived,
  and cannot be archived later;
- immutable node fields reject updates while eligible archive changes work;
- deleting any node is rejected; archiving remains the non-destructive removal
  operation;
- branch/edit inserts a sibling and leaves the original node and all existing
  descendants byte-for-byte unchanged;
- a released-schema fixture upgrades forward once one exists; until the first
  release, a clean database can apply the initial migration from scratch.

### Root-to-active regression (release gate)

Build a fixture with a root, at least one shared ancestor, and two sibling
branches containing unique sentinel content. For each active leaf, assert:

1. the path is ordered root to active;
2. every ancestor occurs exactly once;
3. the selected leaf occurs exactly once;
4. no node or sentinel content from the sibling branch occurs;
5. the provider request contains exactly the same ordered role/content sequence.

Also assert fail-closed errors for a missing/archived active node, archived
ancestor, wrong conversation ID, wrong designated root, broken adjacency, and a
  corrupt/cyclic fixture constructed by a test-only corruption setup. The
  cycle-safe recursive query must terminate and return `tree_integrity`.
No failure may fall back to a conversation scan or emit a provider request.

### Cross-layer contract tests

Use shared success/error fixtures at the IPC boundary. Rust serialization and
the TypeScript decoder must agree on command names, field casing, nullable
fields, timestamps, error codes, details, and retryability. Integration is not
accepted merely because mocked UI fixtures render; the real bridge must satisfy
the same fixtures and the end-to-end branch-isolation assertion.

The main integration workstream owns TypeScript bridge/Zustand unit tests,
cross-layer fixtures, and real-command wiring. The dedicated frontend component
workstream owns React Testing Library coverage for outline selection, keyboard
navigation, branch/edit intent, and loading/empty/error states. Backend and
component agents do not independently redefine shared DTOs.

## Code Review Checklist

- [ ] The plugin owns production database creation and migrations; only one
      compatible SQLite/sqlx stack is resolved (`cargo tree`).
- [ ] SQL is parameterized and confined to repositories; multi-step invariants
      and transactions live in services.
- [ ] Schema constraints and triggers enforce root ownership, one root,
      immutable history, and same-conversation parentage.
- [ ] Root-to-active loading validates the complete chain and fails closed.
- [ ] Edits insert a branch and preserve the original node and descendants.
- [ ] Stable typed errors cross IPC and logs/serialized payloads contain no
      credentials, prompts, raw provider bodies, or database paths.
- [ ] Real-migration tests cover constraints, rollback, and recursive queries.
- [ ] The sibling-absence assertion reaches the final provider payload.
- [ ] Shared DTO fixtures match the frontend bridge before integration is
      declared complete.
