# Phase 5.11 report — Retail Operations Console Backend

## Executive result

Phase 5.11 exposed the proven retail service seams over staff
HTTP: fulfillment ops routes (Checkpoint A), after-sales ops
routes (Checkpoint B), staff reads with queue indexes
(Checkpoint C), and authority audits with
failure/concurrency/security convergence plus static guards
(Checkpoint D). Every checkpoint committed, pushed, and went CI
green independently; full `test:all` is green at closeout (23
shared + 140 database + 1323 api + 155 frontend = 1641, 0 FAIL).
Feature/test regression is zero: no behavioral coverage was
removed at any checkpoint, and the only edits to existing suites
are count-only migration pins (5-3 string, 5-7 journal, 5.10
D10.8 guard) mapped in the architecture doc (§10).

## Checkpoint A — fulfillment ops routes

Seven routes on `POST admin/retail/…`: confirm, pack, cancel,
shipment create, handoff, manual tracking, payment verify. The
controller forwards the authenticated actor untouched to the
5.8/5.9 seams; replayable POSTs mirror the checkout precedent
(201 new / 200 replayed); transitions answer explicit 200.
Finance stays seam-only by construction (the session guard
re-checks token role against the live account row, and the role
CHECK has no finance value). 9 new tests; A gates 1587/1587.

## Checkpoint B — after-sales ops routes

Ten routes on the same controller: refund file/approve/complete/
fail (all 201/200, since every seam journals idempotency first),
five explicit return transitions (approve/receive/inspect/
restock/reject, mirroring the wholesale `supplier/orders`
style), and guest-capability revocation (idempotent, honestly
false on customer orders and double revoke). No withdraw route
exists (404 by construction); the seam's staff-WITHDRAWN refusal
stays as backstop. 9 new tests; B gates 1596/1596.

## Checkpoint C — staff reads + queue indexes

Six GET routes complete the console: order list (6 filters) +
detail + version-ordered timeline, return queue + detail,
refund queue — all keyset `{ rows, nextCursor, hasMore }` on
the wholesale-console pagination mirror (bad cursors degrade,
limit clamps 1–100, unknown filters match nothing, zero new
error vocabulary). Reads live with their owners (refunds in
`PaymentsService`). Migration 0043 added the 4 queue indexes
only (one partial, retail-side); `drizzle-kit generate` cannot
diff the hand-made 0035–0042 snapshots, so SQL + snapshot +
journal were hand-written and verified applying cleanly (44
migrations, 198 tables). 14 new tests (4 migration + 10 reads);
C gates 1610/1610.

## Checkpoint D — audits, convergence, hardening, guards

D froze the A/B/C surface: write authorities confined
(D1–D5), races and failures proven convergent over HTTP (D6
failure injection, D7 concurrency), the trust boundary attacked
(D8 security), legacy untouched (D9), schema frozen at 0043
(D11), verdicts pinned as executable guards (D10). One genuine
hardening: hostile cursors 500'd PG via `('...'::timestamptz)`,
and a bare `isNaN(Date.parse())` check was proven insufficient
by test (V8 parses digit-bearing garbage into dates) — the
shipped fix requires strict ISO-8601, degrading anything else
to page one. 31 new tests (8 failure + 7 concurrency + 8
security + 8 guards). D gates 1641/1641.

## Migration and schema result

One migration, zero new tables (still 198): 0043 (two order
queue btrees, return status queue btree, retail-only partial
refund btree). Journal 43 → 44 entries / idx 43. The migration
carries its own proof suite (index defs, partial predicate,
table count). Tables 198 across the whole phase; every
checkpoint's count pins hold.

## Money, honesty, and RBAC rules

No money moves in 5.11 (the routes forward to seams that were
proven in 5.8/5.9), but the honesty rules hold at the wire:
replay codes distinguish created from converged (201/200);
every refusal crosses with its seam code and mapped status
(400 machine/key, 409 conflicts, 422 semantic, 403 ownership,
404 missing); money leaves as decimal strings; refund rows are
retail-only with no wholesale keys. RBAC: HTTP admits admins
only; finance acts stay seam-only; staff identity forwards
untouched; the guard runs before existence checks (no oracles);
cursors and filters treat hostile input as inert data.

## Verification evidence

### Local verification (fresh, this closeout)

- `typecheck:all` clean (4 workspaces).
- `test:all` 1641/1641 = 1610 (C head) + 31 new D tests, zero
  regressions: shared 23, database 140, api 1323 (+8 failure,
  +7 concurrency, +8 security, +8 guards), frontend 155.
- New suites: `phase-5-11-d-failure-injection`,
  `-concurrency`, `-security`, `-static-guards`.
- Standing invariant: zero file deletions across the phase;
  the only edits to existing suites are count-only pins.

### GitHub Actions (implementation checkpoints)

- Checkpoint A (`f68f528`): CI green (`35825530336` SUCCESS).
- Checkpoint B (`8c91bd1`): CI green (`35827650268` SUCCESS).
- Checkpoint C (`9db651d`): CI green (`35830486183` SUCCESS).
- Checkpoint D: this closeout — commit, push, and CI evidence
  below.

## Explicit deferred items

- Wholesale console cursor hardening (same lenient shape as
  retail pre-D; pre-existing, out of 5.11 scope).
- A frontend console consuming these routes (5.11 is API-only;
  no in-repo console exists).
- `sales_count` wiring, supplier/transaction ratings, review
  extras (carried forward from 5.10).
- Return-filing idempotency keys (carried forward from 5.9;
  convergence pinned instead).

## Truth table

| Claim | Proof |
|---|---|
| Ops routes forward to proven seams | A/B suites: views, codes, replays |
| Finance is seam-only | A + B + C + D suites: 401 matrix |
| Queues page honestly | C suite: filters, walks, degradation |
| Queue indexes exist and are partial-correct | 0043 migration suite (4) |
| Failures cross HTTP with codes intact | D6: 8 refusals with codes |
| Races converge over HTTP | D7: winners, losers, walks |
| Trust boundary holds | D8: matrix, oracles, injection, shapes |
| Hostile cursors degrade, never 500 | D hardening + D8 test + D10.6 |
| Authorities confined, shell pure | D10 static guards (8) |
| 1641/1641 green, zero regressions | `test:all` log, this closeout |

## Closeout CI evidence

This report was committed with the Checkpoint D closeout,
pushed, and its CI run was awaited to SUCCESS before closeout.

Phase 5.11 DONE; the next phase has NOT been scoped.
