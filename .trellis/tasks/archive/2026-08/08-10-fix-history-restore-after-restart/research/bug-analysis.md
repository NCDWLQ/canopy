# Bug Analysis: History unavailable after restart

## 1. Root Cause Category

- **Category**: B/D — Cross-Layer Contract and Test Coverage Gap
- **Specific cause**: SQLite writes and ID-based tree reads were complete, but
  no contract enumerated durable conversations after the in-memory Zustand
  projection was recreated. Existing tests carried an ID or preloaded the
  store, so none crossed a true cold-start discovery boundary.

## 2. Why Earlier Work Did Not Prevent It

1. Tree persistence tests proved same-pool write/read integrity but not
   file-backed close/reopen discovery.
2. Workspace tests preloaded a known conversation ID, bypassing startup.
3. Browser persistence was correctly forbidden, but the required SQLite-backed
   replacement discovery path remained explicitly out of scope.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | Add typed `list_conversations` from SQLite through UI | DONE |
| P0 | Test coverage | Reopen a file DB and restore from a fresh frontend store | DONE |
| P0 | Runtime state | Separate loading, empty, and error; reject stale epochs | DONE |
| P1 | Documentation | Record discovery and restore contracts in backend/frontend specs | DONE |
| P1 | Review guide | Add cold-start discovery checks to the cross-layer guide | DONE |

## 4. Systematic Expansion

- **Similar issues**: Any future durable aggregate whose only lookup key lives
  in a renderer store can fail identically after restart.
- **Design improvement**: Treat discovery/listing as part of persistence, not a
  later UI convenience.
- **Process improvement**: Every persistence slice needs a test beginning with
  a fresh process/store and no carried identifiers.

## 5. Knowledge Capture

- [x] Backend discovery and deterministic ordering documented.
- [x] Frontend typed boundary and hydration state contract documented.
- [x] Cross-layer cold-start checklist documented.
- [x] File-backed and fresh-store regressions added.
