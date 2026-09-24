# Phase 5.13 Full Backend Adversarial Audit

Start SHA: `b269b0fe34bc1838aca79f4f9e2eb3f2d6531bf6`

This document is the live evidence register for the final backend gate. Findings are classified only as **CONFIRMED DEFECT**, **HARDENING GAP**, **DOCUMENTED ACCEPTED RISK**, or **FALSE POSITIVE**. A confirmed defect is not closed until its reproduction, root cause, minimal fix, and regression test are recorded.

## Evidence register

| ID | Classification / severity | Domain | Attack or failure scenario | Reproduction and result | Fix checkpoint | Regression evidence | Residual risk |
|---|---|---|---|---|---|---|---|
| A-001 | CONFIRMED DEFECT / high | Supplier tenancy | An authenticated non-admin guesses a supplier ID and reads its member roster; the same caller can create a supplier authority row. | Source inspection reproduced both routes with default authentication only: `GET /suppliers/:id/members` and `POST /suppliers` had neither role nor ownership checks. The member query filters only by attacker-controlled `supplierId`. | A: restrict both surfaces to admin role plus `wholesale:membership:view/manage`. | `phase-5-13-authz-adversarial.test.ts` pins both role and permission gates. | Supplier self-service membership remains available only through tenant-aware supplier-team surfaces. |
| A-002 | CONFIRMED DEFECT / high | Admin authorization | A restricted admin invokes Phase 5.12 compatibility writers because they checked the broad `admin` role but did not invoke granular RBAC. | Source reproduction found ungated writes in operational logs, CMS settings, supplier decisions, VIP account decisions, RFQ creation, bulk pricing, and catalog moderation. A restricted admin session therefore reached the service layer. | A: add `AdminPermissionGuard` and an existing catalog permission matched to each operation. | `phase-5-13-authz-adversarial.test.ts` verifies denial semantics and pins every compatibility writer permission. | The permission catalog remains intentionally coarse for compatibility endpoints; operations inherit the closest established domain permission. |
| A-003 | FALSE POSITIVE / none | CMS preview | Public preview routes could appear to expose unpublished CMS data. | Each preview route verifies a short-lived HMAC token bound to both target type and revision ID using timing-safe comparison, and returns 404 on failure. | None. | Existing CMS preview tests plus source verification in `cms-preview.service.ts` and `cms-public.controller.ts`. | Possession of a valid preview URL grants access until its bounded expiry, by design. |
| A-004 | CONFIRMED DEFECT / high — CLOSED | Orders/VIP domain boundary | GitHub Actions run `36019931474` failed `architecture-freeze.test.ts` because `vip.service.ts` directly read the Orders-owned `wholesale_order_request` table during request conversion. | The VIP service imported `wholesaleOrderRequest` to detect an existing link and to validate the newly created link, crossing the ownership boundary and coupling VIP to Orders persistence. | A: Orders now checks existing links, creates and validates request-to-order links through `OrdersRepository`, then invokes the VIP-owned accepted-to-ordered transition in the same transaction. VIP no longer imports or queries the link table. | `architecture-freeze.test.ts`, `phase-5-13-orders-vip-boundary.test.ts`, and the existing Phase 4.3/4.3.1 conversion, concurrency, rollback, replay, version, expiry, hash, and account-isolation cases passed. GitHub Actions run `36063833627` succeeded: API 128 files / 1,385 tests; repository 176 files / 1,756 tests. | Database uniqueness on `wholesale_order_request.request_id`, deterministic request/account locks, and the encompassing transaction remain authoritative against duplicate conversion and orphan state. |

## Baseline evidence

- Continuation branch and local/remote head matched the required start SHA.
- Migration verification: 47/47 migrations, 199 tables, 461 foreign keys, 589 CHECK constraints.
- Preflight, typecheck, package build, infrastructure verification, and production Next build passed before modification.
- The full local suite cannot bind its hard-coded secondary PostgreSQL port in this Windows sandbox (`EACCES` on `127.0.0.1:55432`). The existing PostgreSQL verification instance on port 54329 is healthy; Linux GitHub Actions remains the required full-suite gate.

The register will be extended at each checkpoint with executed evidence, commit SHA, CI run, and remaining risk.

## CI-recovery local regression evidence

- The wholesale conversion suites passed locally: 24/24 tests across `orders-phase-4-3.test.ts` and `orders-phase-4-3-1.test.ts`, including single conversion, concurrent idempotency, link correctness, rollback/orphan protection, replay, version, expiry, hash, and account/buyer isolation.
- The previously suspected advisory-lock case, `guarantees single-worker execution under heavy concurrent attempts`, reproduced in 4/4 isolated Windows runs (no randomized seed): `executed.length` was 2 instead of 1. No retry, sleep, assertion weakening, or unrelated fix is included in this CI-recovery change; GitHub Actions remains the cross-platform gate.
- The previously suspected notification-cleanup case, `C27 isolates notification failure from commerce truth`, was **NOT REPRODUCED** in 3/3 isolated runs.
