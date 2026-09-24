# Phase 5.12 — Backend Consolidation / Legacy Cutover

**Status:** Complete  
**Branch:** `arena/01a0c5f5-kolbevintage-services`  
**Phase start:** `7383aedebbb100ae26fe154c4794f9bce3404f02`

## Checkpoints and CI

| Checkpoint | Commit | GitHub Actions | Conclusion |
|---|---|---:|---|
| 5.12-A | `f3553fb830265a72619cc89feab8b86541f9594b` | `35907740482` | SUCCESS |
| 5.12-B | `53e925df01b065bda2ec642d2192a46d3fb64f37` | `35985698552` | SUCCESS |
| 5.12-C | `c3ef20eba8313992ff4bd8a6f9cce691e7c226f4` | `36009322627` | SUCCESS |

## Final authority model

All legacy business reads and commands enter through the Next compatibility
route and execute in their named Nest owner. Nest derives customer, VIP,
supplier, and Admin identity from the verified session and canonical
membership. The compatibility layer translates frozen paths, DTOs, responses,
cookies, and errors only. An unavailable canonical API returns
`503 CANONICAL_API_UNAVAILABLE`; there is no business SQL fallback.

Supplier application approval uses a transactional owner orchestrator for the
application, supplier, seller, initial membership, Auth role, and audit facts.
Catalog owns submissions and moderation. Offers owns RFQs, quotes, and integer
pricing. VIP and Auth own membership decisions and role effects. CMS owns the
allowlisted storefront presentation document. Support owns the combined
status/reply command. Analytics owns Admin operational-log reads and resolve.

The Next dispatcher contains no direct mutation of a business table. Its only
direct database writer is the bounded `POST /store/kolbe/logs/client`
infrastructure telemetry ingest into `system_log`. The Perfect Corp `try-on/*`
transport and quota edge is also intentionally retained. These edges do not
own business facts. Unreachable, read-only compatibility SQL remains scheduled
for physical removal with the compatibility surface in Phase 6.

## Final route inventory

| Classification | Count |
|---|---:|
| Total | 47 |
| NEXT_PROXY_TO_NEST | 42 |
| LEGACY_READ | 0 |
| LEGACY_WRITE | 0 |
| MISSING_CANONICAL_SEAM | 0 |
| DEPRECATED | 2 |
| REMOVE_LATER | 0 |
| STATIC/MOCK | 3 |

## Schema and verification

Fresh preflight and migration verification reported:

- migrations: 47/47
- tables: 199
- foreign keys: 461
- CHECK constraints: 589

GitHub Actions run `36009322627` completed successfully across all four
workspaces. The CI test totals were:

- `@kolbe/shared`: 2 files, 23 tests
- `@kolbe/database`: 26 files, 147 tests
- `@kolbe/api`: 126 files, 1,368 tests
- `kolbe-next`: 20 files, 201 tests

Focused Phase 5.12 verification passed with 20 canonical owner/security tests,
16 writer-cutover tests, 21 read-cutover tests, 9 Checkpoint A write-cutover
tests, and 7 VIP parity tests. The full local frontend run excluding only the
Windows-only hardcoded-port schema test passed 19 files and 196 tests; the full
20-file frontend suite passed in Linux CI. Typecheck, package builds, Next
production build, migration verify, preflight, and infrastructure verification
all passed.

## Explicit non-claims

- No frontend visual design or user flow was changed.
- No feature was silently removed; deprecated mutation routes return their
  explicit terminal contract.
- This checkpoint does not remove the full Next compatibility transport; that
  physical cleanup remains Phase 6 work.
- Phase 5.13 adversarial audit work was not started.

Phase 5.12 Backend Consolidation / Legacy Cutover is complete.

Phase 5.13 Full Backend Adversarial Audit has NOT started.
