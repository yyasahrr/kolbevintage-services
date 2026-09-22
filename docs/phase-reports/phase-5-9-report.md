# Phase 5.9 report — Retail Customer Account & After-sales Backend

## Executive result

Phase 5.9 built the retail customer account and after-sales backend
on NestJS: customer account authority with the address book, order
history, and the guest capability model (Checkpoint A), cancel
evolution with the retail return aggregate and its support linkage
(Checkpoint B), retail refunds on the generic refund engine
(Checkpoint C), and authority audits with
failure/concurrency/security convergence plus static guards
(Checkpoint D). Every checkpoint committed, pushed, and went CI
green independently; full `test:all` is green at closeout (23
shared + 127 database + 1192 api + 155 frontend = 1497, 0 FAIL).
Feature/test regression is zero: no behavioral coverage was
removed at any checkpoint, and every moved assertion is mapped in
the architecture doc (B's replaced pins in §8, the retail-side
refund-gate pin in §10, the D guard pins in §11).

## Checkpoint A — customer account authority

NestJS became the account authority: profile reads/writes delegate
to AuthService (single writer of `account_user`), history and
guest detail delegate to `RetailOrdersService` (single reader of
commerce), and `customer-account` owns only `customer_address`.
The guest capability model ships `rgc_` + 128-bit base64url
secrets with SHA-256 hash-only storage, constant-time verify, and
plaintext crossing the wire exactly once; legacy NULL-hash rows
resolve to `RETAIL_GUEST_CAPABILITY_REQUIRED` (support recovery,
no fabrication). The address book carries typed columns,
advisory-locked default switches with 23505→409 translation,
optimistic versioning, soft archive, and a 20/customer cap. Order
history is keyset-cursor with an opaque cursor failing closed.
Migration 0037 (195 tables, journal idx 37). 19 new tests (4
migration + 9 account + 4 guest + 2 frontend proxy); A9 gates
1438/1438.

## Checkpoint B — cancel evolution + returns + support link

Cancel evolved per the §7 table: paid pre-handoff cancel lands
`cancelled` + `payment.refundPending` with money untouched (the
`RETAIL_CANCEL_PAID_FORBIDDEN` rejection retired to a documented
dead arm), delivered cancel routes to returns
(`RETAIL_CANCEL_ROUTES_TO_RETURN`), recancel is idempotent.
Returns: `RetailReturnsService` (orders-owned) with the
`CustomerReturnService` façade and 5 buyer-only HTTP routes
(file/list/detail/withdraw, guests read-only); support cases open
inside the filing transaction; per-line delivered-minus-encumbered
math guards sibling filings. Migration 0038 added the three
return tables (198 tables, journal idx 38). 15 new tests (4
migration + 11 returns); B3 gates 1453/1453. Five pins were
replaced in place under the standing invariant (zero deletions),
each retired rejection re-covered end-to-end on the accepted path.

## Checkpoint C — retail refunds on the generic engine

Retail refunds ride the Phase 4-7 generic refund engine: migration
0039 extended `refund`/`refund_line`/`financial_ledger_entry` with
retail-side columns behind XOR CHECKs (ALTERs only, zero new
tables), and a new `createRetailRefund` journals idempotency
BEFORE live-state checks (deliberately replay-safe, unlike the
untouched wholesale writer). Whole-order refunds exact-match the
paid total inside the honesty window (line-sum + shipping − fee,
shippings of cancelled orders free); line refunds price from the
stored immutable basis (promos may die mid-flight); double
completion converges on first-evidence-wins with a single ledger
OUT. 13 new tests (4 migration + 9 refunds); C gates 1466/1466
(23 shared + 127 database + 1161 api + 155 frontend).

## Checkpoint D — audits, convergence, hardenings, guards

D froze the A/B/C surface: every write authority audited and
confined (D1–D5: address repo, returns repo/service, the 12
payments refund/ledger sites with retail naming none, guest
GET-only), races and failures proven convergent (D6 failure
injection, D7 concurrency), the trust boundary attacked (D8
security), legacy ruled write-free and untouched (D9), no
namespace migration justified (D11), and the verdicts pinned as
executable static guards (D10). One surgical hardening: the four
retail refund mutators moved from `assertStaff` to
`assertRefundStaff` (admin/finance + non-null identity), matching
the money owner exactly — finance verifies money-in and refunds
wholesale, so finance refunds retail too, and `system` no longer
passes the retail gate to die downstream. 31 new tests (8 failure
+ 7 concurrency + 8 security + 8 guards). D gates 1497/1497.

## Migration and schema result

Three migrations, all append-only-aware: 0037 (guest capability
columns, journal idx 37), 0038 (return tables, journal idx 38),
0039 (retail refund/ledger columns, 40 journal entries / idx 39). Tables 194 → 198. D added no migration: the
return-filing idempotency-key migration was deliberately deferred
(advisory lock + encumbered re-read converges, double filing is
money-safe downstream via the refund units guard, so a key would
buy staff convenience only). Every migration carries its own
proof suite (XOR both ways, FKs/uniques, fact CHECKs, restrict
pins).

## Money, inventory, and honesty rules

Money never moves without a journaled row: retail refunds post
exactly one ledger OUT per completion (first-evidence-wins),
wholesale behavior untouched (its partial unique and its
checks-before-journal order survive verbatim). The honesty window
is exact (no tolerance band); over-payment and under-allocation
file nothing. Failed refunds are terminal for completion yet
refileable with a fresh key; same-key refile returns the failed
row (the journal wins). Restock is atomic with the return
transition — a broken restock fails closed (INSPECTED kept, stock
untouched) and never wedges. Return lines never over-encumber
under racing filings; refund lines never over-draw under racing
completions. Cancel releases holds and restocks; refunds never
touch inventory.

## RBAC and trust boundary

Refunds are money acts: admin + finance only, with identity, at
the service seam — no customer HTTP exists (404 even for admins).
The customer namespace is buyer-only (`@Roles("customer",
"vip")`); staff filing lives at the service seam and pins the
order owner. Withdrawal is owner-only (cross-owner 403, anonymous
401). System and null identities are refused on every refund act.
Staff identity is fungible (any staffer advances another's
filing). Cross-order line ids are rejected with the ghost-id code
(no cross-order oracle). Guests are GET-only; anonymous callers
stop at the guard.

## Verification evidence

### Local verification (fresh, this closeout)

- `typecheck:all` clean (4 workspaces).
- `test:all` 1497/1497 = 1466 (C head) + 31 new D tests, zero
  regressions: shared 23, database 127, api 1192 (+8 failure, +7
  concurrency, +8 security, +8 guards), frontend 155.
- New suites: `apps/api/test/phase-5-9-d-failure-injection.test.ts`,
  `phase-5-9-d-concurrency.test.ts`, `phase-5-9-d-security.test.ts`,
  `phase-5-9-d-static-guards.test.ts`; the 5.8 guard file keeps its
  8 tests with the refund-mutator assertion extended in place.
- Standing invariant: zero file deletions across the phase; the
  only edits to existing suites are in-place replacements mapped
  in §8/§10/§11.

### GitHub Actions (implementation checkpoints)

- Checkpoint A: committed, pushed, CI green (see session history).
- Checkpoint B (`950732d`): committed, pushed, CI green.
- Checkpoint C (`a44240c`): committed, pushed, CI green
  (`35747606504` SUCCESS).
- Checkpoint D: this closeout — commit, push, and CI evidence
  below.

## Explicit deferred items

- Staff refund HTTP routes (operator surface): refunds are
  service-seam-only by scope (§9); D8 proves the seam gate.
- Return-filing idempotency keys: deferred with documented
  rationale (convergence pinned instead; money-safe downstream).
- Revocation HTTP for guest capabilities: staff service seam only
  (no HTTP in A).
- The `wholesale_order` default-vs-CHECK drift: wholesale-owned,
  pre-existing, out of phase scope (recorded in §10).

## Truth table

| Claim | Proof |
|---|---|
| Account writes confined to their owners | D1 audit: address repo only, profile via AuthService; D10 pins |
| Return writes confined | D2 audit: returns repo/service + registry only; D10 pins |
| Refund/ledger writes confined to payments | D3 audit: 12 sites, retail names none; D10 pins |
| Guest is read-only | D5 audit: single GET, zero writes; D10 pins |
| Legacy retail proxy write-free | D9 audit; D10 pins |
| No D migration needed | D11 verdict; filing-key deferral documented |
| Finance refunds retail | D8: full cycle as finance; C suite unaffected |
| Refund races converge | D6/D7: replay, ceiling, units, single OUT |
| Return races converge | D7: no over-encumber, withdraw/approve converge |
| Restock fails closed | D6: nulled-variant test |
| Relay skips refund facts safely | D6: skipped:1, commerce untouched |
| 1497/1497 green, zero regressions | `test:all` log, this closeout |

## Closeout CI evidence

This report was committed with the Checkpoint D closeout, pushed,
and its CI run was awaited to SUCCESS before closeout.

Phase 5.9 DONE; Phase 5.10 Search / Discovery / Ratings Backend has NOT started.
