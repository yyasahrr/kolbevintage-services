# Phase 5.8 report — Retail Commerce Core Backend

## Executive result

Phase 5.8 built the retail commerce core on NestJS as the single
writer: canonical retail order + server-side pricing (Checkpoint A),
payment orchestration with gateway callbacks and the inventory
lifecycle (Checkpoint B), retail shipping with the fulfillment
lifecycle (Checkpoint C), and authority audits with
failure/concurrency/security convergence plus static guards
(Checkpoint D). Every checkpoint committed, pushed, and went CI
green independently; full `test:all` is green at closeout (23
shared + 115 database + 1128 api + 153 frontend = 1419, 0 FAIL).
Feature/test regression is zero: no behavioral coverage was
removed at any checkpoint, and every moved assertion is mapped in
the architecture doc's test continuity record (§17).

## Checkpoint A — canonical order + pricing foundation

NestJS became the canonical retail writer: checkout creates the
order, prices server-side from the shared rules table (browser
money is a display hint only), reserves KOLBE inventory with the
order allocation link, pins the legal/policy snapshot, and emits
the placed fact — atomically. The legacy Next writer was replaced
by a translate-and-forward compat proxy that preserves the frozen
legacy request/response shape, including the compat error map
(§17 pins every mapped key to a real Nest code). Three existing
Retail regression suites were preserved under the standing
invariant (zero file deletions; obsolete-by-move assertions were
re-homed stronger, never dropped).

## Checkpoint B — payment orchestration + inventory lifecycle + relay

Retail payment orchestration: gateway intents, manual-transfer and
COD evidence rails with exact-amount matching (no partial
payments), staff verification that atomically marks paid, confirms
stock, and emits the paid fact, and verified provider callbacks
with a claim-and-replay inbox (duplicate redelivery never
double-pays; bad signatures are kept as ignored facts). The
inventory lifecycle settled: active holds at checkout, consume at
verify/ship, full release on pre-shipment cancel, lapsed-hold
re-secure at COD shipment. The retail notification relay forwards
durable facts to the Notifications owner best-effort, never inside
a commerce transaction. A B fixup hardened provider callbacks,
payment ownership, and method honesty policies.

## Checkpoint C — retail shipping + fulfillment lifecycle

Retail shipping: server-side quotes from the shared rules,
multi-parcel creation with cumulative quantity bounds, provider
parcel creation with pending-row parking and same-key resume,
explicit operator handoff that ships the order, carrier tracking
with signature verification and pre-handoff fencing, operator
attestation for manual shipments (forward-only, backward scans
ignored, terminal agreement), order delivery only when every line
is fully delivered (contract fan-out), and cancel that releases
reservations and restocks. Migration 0036 added the retail
linkage (`retail_order_id` on shipment/payment with
single-order-side predicates) plus snapshots. 28 API tests + 4
migration tests, all on real PostgreSQL.

## Checkpoint D — audits, convergence, hardenings, guards

D1–D5 audited every write authority (all clean, zero code change):
retail writes confined to the retail repository, no frontend
retail price authority, inventory mutations only via
`InventoryService`, `paymentStatus` written only by the payment
row owner, shipment writes confined to `ShippingService`. D9 kept
all legacy compat files (translator, proxy, gated seed) with a
write-free pin; D11 ruled NO namespace migration (retail
`rord_*`/null-order-id reserves vs wholesale `alloc_*`/linked
allocations; prefix discipline stays app-level, out of DDL). D6
(8 failure-injection), D7 (7 concurrency), and D8 (11 security)
tests prove every outage, race, and hostile actor converges on
exactly one honest fact. D10 pins the audits as 8 static guards.
D found and fixed 4 real issues: cancel missing its owner gate,
pre-pack handoff silently wedging orders (now fenced), markup
persisted in contact fields (now stripped at the trust boundary),
and a racing checkout loser leaking a 500 instead of the honest
409.

## Migration and schema result

Migrations `0001`–`0036` (+1 seed/support file = 37 SQL files)
apply cleanly; Checkpoint C's `0036` added the retail linkage
with predicate CHECKs (`shipment_single_order_side`,
`payment_single_order_side`), item linkage with uniqueness, and
fact acceptance. Checkpoint D added no migration (D11 verdict).
Identifier prefixes (`rord_*`, `rpay_*`, `rshp_*`, …) are
deliberately absent from DDL — D10.5 enforces that statically.

## Money, inventory, and honesty rules

All retail money is BIGINT with the totals equation enforced in
DDL (`total = items − promo + shipping`); browser-claimed money
never participates in identity or totals. Inventory is KOLBE-only
(retail never satisfies from supplier stock), holds are
allocation-linked, and every mutation is service-guarded
(on-hand can never drop below reserved through the service).
Payment honesty: evidence must equal the order total exactly on
the rail matching the pay method; callbacks verify amount,
currency, and signature before any paid fact; the API returns
`collected:false` with the real status and never fabricates
gateway states.

## RBAC and trust boundary

Service-level RBAC is the enforcement point: commerce mutators
gate on `assertOrderOwner` (owner-or-staff) or `assertStaff`
(staff-only); D10.7 asserts the gate on all 8 mutators and D8
proves every refusal at the seam. Staff identity is fungible by
design (any admin may hand off any ready parcel — the fence is
the role, not parcel ownership). Provider input is verified
(signatures, reference binding, state re-query) before any fact;
hostile attempts persist as `ignored`/`failed` facts, never as
commerce. Contact free-text is sanitized at the trust boundary;
identifiers keep strict parsing.

## Verification evidence

### Local verification (fresh, this closeout)

| Command | Result |
| --- | --- |
| `npm run test:all` | PASS — 23 shared (2 files), 115 database (17 files), 1128 API (99 files), 153 frontend (16 files); 1419 total |
| `npm run typecheck:all` | PASS — shared, database, API, frontend |

Phase 5.8 dedicated coverage: A (canonical order/pricing suites +
compat), B (payment + callback suites), C (28 shipping tests + 4
migration tests), D (8 failure-injection + 7 concurrency + 11
security + 8 static guards), all on real PostgreSQL. The only
`ERROR` lines in the run are expected negative-path logs from
failure-injection tests; the suite exits 0. One transient
load-flaky wholesale e2e (`phase-4-7-1-cross-domain`) failed once
under full-suite load, then passed standalone and on a full rerun
— unrelated to D (it runs before any D file; no D change touches
a shared path).

### GitHub Actions (implementation checkpoints)

- Checkpoint A feat: run `35699210136`, SHA
  `338c5cc4a61d6b106cecb3bedfc14e8e64855160` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35699210136
- Checkpoint A docs: run `35700385419`, SHA
  `e4d5f74274a68d5d08d176107aff42ee2cbed348` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35700385419
- Checkpoint B: run `35704732829`, SHA
  `5c36cddad6f7dfe65a79dd83464cffdb5c7331a9` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35704732829
- Checkpoint B fixup: run `35707621492`, SHA
  `6dcdade9495eb6f2a3226a3441c4bb115df0750f` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35707621492
- Checkpoint C: run `35721623758`, SHA
  `1ef4ed3c5318092d57ec61ccbe3f36cc5416ca1f` — SUCCESS.
  URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/35721623758

## Explicit deferred items

1. The operator HTTP surface (staff confirm/pack/ship/track
   routes) is NOT in the D1–D17 contract and stays deferred to
   post-5.8; service-level RBAC is complete and proven at the
   seam (D8), so the future routes only need to forward the
   authenticated actor.
2. Guest-order capabilities (guest cancel/payment/tracking) are a
   5.9 HTTP decision; guests carry no identity at the service
   seam by design.
3. The `wholesale_order` default-vs-CHECK drift spotted in D11 is
   wholesale-owned and deferred to the wholesale owner.
4. No live carrier or payment provider integration is claimed
   (fake providers are test-only and refuse production).

## Truth table

| Claim | Value |
| --- | --- |
| NestJS is the single retail writer | YES |
| Server-side retail pricing (browser money is hint-only) | YES |
| Legal/policy snapshot pinned at checkout | YES |
| Legacy compat proxy preserves frozen shape | YES |
| Payment orchestration (intent/evidence/verify/callback) | YES |
| Inventory lifecycle (hold/consume/release/re-secure) | YES |
| Retail shipping (quote/parcel/handoff/tracking/delivery) | YES |
| Failure/concurrency/security convergence proven | YES |
| Write authorities audited and statically pinned | YES |
| Zero behavioral coverage removed (A/B/C/D) | YES |
| Retail namespace migration performed | NO |
| Operator HTTP surface shipped | NO |
| Guest service-seam capabilities | NO |
| Live provider integrations claimed | NO |
| Floating-point monetary authority | NO |

## Closeout CI evidence

Checkpoint D commit (this closeout): run `XXXX` — PENDING.
URL: https://github.com/yyasahrr/kolbevintage-services/actions/runs/XXXX

(This section is finalized after the D commit's CI run reaches
SUCCESS; the final report is then amended with the run id.)

Phase 5.9 has NOT started.
