# Phase 4.7.5 — Iran Legal, Compliance, Privacy & Tax-Readiness Foundation — Report

**Branch:** `arena/01a0b926-kolbevintage-services` (only branch touched; no `main` interaction, no history rewrite, no force push, no PR)
**Starting SHA:** `39213a7d697185309dd6f7269236b7d5a0a1f1db` (Phase 4.7.1 final, CI 35444618745 SUCCESS: 22 migrations, 63 tables, 144 FKs, 181 CHECKs, 675 tests)
**Part 0 (4.7.1 report finalization):** `8b10bb06cd2cf24cecbaffc3725e2b839baf84b4` — CI 35446181858 SUCCESS
**Ending SHA (code):** `dc3ecc99e66e4fe92c6aa7c9d5f103f91db40fc7` (+ this report commit, recorded in the final section)
**Date:** 2026-09-19
**Migration:** `packages/database/migrations/0022_phase_4_7_5_iran_compliance_foundation.sql` forward-only; **23 migrations, 85 tables (+22), 194 FKs (+50, all `ON DELETE RESTRICT`), 266 CHECKs (+85)**, 26 indexes (13 unique/partial), 4 trigger functions, 11 triggers; 0020 and 0021 untouched; snapshot `0022_snapshot.json` chained (`prevId` = 0021 id)
**Location:** Falkenstein, Saxony, DE — no Iranian gateway, carrier, tax-authority or eNAMAD credential exists in this repository; no real external call was made or claimed

> **This phase is a technical compliance *foundation*. It does not make Kolbe legally
> compliant.** See the explicit disclosures at the end of this report.

## Commits (all on `arena/01a0b926-kolbevintage-services`)

| Stage | SHA | Message | CI run | Conclusion |
|---|---|---|---|---|
| 0 | `8b10bb06cd2cf24cecbaffc3725e2b839baf84b4` | `docs: finalize phase 4.7.1 branch and CI record` | 35446181858 | success |
| A | `69d4ad0f5cf9882185dfcd2d11127da7cd500e1b` | `feat(phase-4-7-5-a): add legal policy and consent foundation` | 35448522058 | success |
| B | `973893cf45ad71a2201081ef879f9497e4ec2d59` | `feat(phase-4-7-5-b): add supplier and product compliance foundation` | 35448668231 | success |
| C | `dc3ecc99e66e4fe92c6aa7c9d5f103f91db40fc7` | `feat(phase-4-7-5-c): add tax and privacy compliance readiness` | 35448931256 | success |
| D / report | (this commit) | `docs: phase 4.7.5 report` | — | see final section |

## Test totals (local, real embedded PostgreSQL, `NODE_ENV=test`, `npm run test:all`)

| Workspace | Files | Passed | Skipped | Failed | Baseline (4.7.1) |
|---|---|---|---|---|---|
| `@kolbe/shared` | 2 | 21 | 0 | 0 | 21 |
| `@kolbe/database` | 10 | 84 | 0 | 0 | 84 |
| `@kolbe/api` | 38 | 507 | 0 | 0 | 450 |
| `kolbe-next` | 13 | 125 | 0 | 0 | 120 |
| **Total** | **63** | **737** | **0** | **0** | 675 |

New test files (all real DB, no mocks except the stubbed Nest `fetch` in the Next gate test):

| File | Tests | Covers |
|---|---|---|
| `apps/api/test/phase-4-7-5-policy-consent.test.ts` | 13 | versioning, DB immutability, scope isolation, wholesale gate + snapshot, re-acceptance, consent ≠ contract, guest retail binding, return-policy evaluation, sanitized business profile/credentials |
| `apps/api/test/phase-4-7-5-supplier-compliance.test.ts` | 13 | KYB lifecycle, membership/role authorization, private documents (MIME/magic/size, signed URLs, audit), owner-only agreement acceptance, holds, bank hash+mask, settlement eligibility |
| `apps/api/test/phase-4-7-5-product-compliance.test.ts` | 6 | supplier declarations via offers owner, admin-only verification, provenance documents, publication gate modes, DB consistency |
| `apps/api/test/phase-4-7-5-invoice-tax-readiness.test.ts` | 8 | invoice eligibility, issuance from immutable snapshot, immutability/void, read authorization, fiscal port lifecycle, fake refused in production, accountant-verified tax config |
| `apps/api/test/phase-4-7-5-privacy-retention.test.ts` | 6 | DSAR state machine, legal holds, retained evidence, access export minimization, dry-run-only retention |
| `apps/api/test/phase-4-7-5-security-boundaries.test.ts` | 11 | ownership, dependency direction, no wallet structures, migration hygiene, docs presence, 401/403 matrix, session-bound subjects, internal token, signed URLs |
| `frontend-next/test/retail-legal-gate.test.ts` | 5 | legacy retail checkout gate: off / enforce-accept / enforce-reject / unavailable / malformed |

Pre-existing tests: none deleted, none weakened. One assertion in
`phase-4-7-1-cross-domain.test.ts` (“0021 is the last journal entry”) was
re-expressed as “0021 is present and untouched; later entries may follow” because
it could never survive any subsequent migration; its intent (forward-only, 0020
untouched, snapshot chained) is unchanged and 0022 is covered by the new hygiene test.
`phase-3-8.test.ts` table count 63 → 85 and `module-boundaries.test.ts` schema list
were extended (no `READ_EXCEPTIONS` widening).

## Verification gates (Part 50)

| Gate | Result |
|---|---|
| `npm run db:migrate` | OK — 23 migrations, 85 tables, 194 FKs, 266 CHECKs |
| clean migration from zero | OK — `packages/database` `clean-migration.test.ts` (fresh DB, snapshot ⇄ DB shape equality) and local DB recreated from scratch |
| `npm run typecheck:all` | OK (shared, database, api, next) |
| `npm run test:all` | OK — 737 passed / 0 skipped / 0 failed |
| `npm run build` | OK (Next production build) |
| `npm run infra:verify` | OK (12 env vars, 9 compose services) |
| 4.7.1 suites re-run | OK (payment provider, shipping, concurrency, cross-domain) |
| CI | A/B/C SUCCESS (ids above); report commit: final section |

## What was built

### Database (`0022_phase_4_7_5_iran_compliance_foundation.sql`)

Owner `compliance` (17): `legal_policy_document`, `legal_policy_acceptance`, `consent_event`,
`business_legal_profile`, `business_compliance_credential`, `supplier_compliance_profile`,
`supplier_compliance_review`, `supplier_compliance_document`, `supplier_contract_acceptance`,
`supplier_compliance_hold`, `supplier_bank_verification`, `product_compliance_record`,
`product_compliance_document`, `data_retention_policy`, `data_subject_request`, `legal_hold`,
`transaction_compliance_snapshot`.
Owner `invoicing` (5): `commercial_invoice`, `commercial_invoice_line`, `fiscal_document`,
`fiscal_submission_event`, `tax_configuration`.

DB-level guarantees (triggers, not only TypeScript):
`kolbe_legal_policy_document_guard` (published text/identity/rule parameters frozen; only
published → retired; retired never re-published; published/retired never deleted),
`kolbe_compliance_append_only` on acceptance / consent / supplier contract / review /
snapshot / invoice line / fiscal event, `kolbe_hold_release_only_guard` on both hold
tables (active → released only, never deleted), `kolbe_commercial_invoice_guard`
(issued → voided only, with reason; voided immutable). CHECKs enforce single published
version per (type, scope, locale), 64-char hashes, verified-requires-reviewer,
release consistency, destructive retention requires VERIFIED + duration, active tax
config requires VERIFIED, invoice `grand_total = subtotal + shipping + tax`, line
`line_total = unit_price × quantity`, one issued invoice per child, one current bank
row per supplier, one open fiscal document per invoice.

### Modules and dependency direction

```
finance ──▶ compliance      (wholesale confirm gate + snapshot)
catalog ──▶ compliance      (publication gate: canPublishProduct)
offers  ──▶ compliance      (supplier provenance routes, ownership verified by the offers owner)
invoicing ─▶ orders, payments, vip, suppliers, compliance, audit
compliance ─▶ auth, suppliers, supplier-team, audit   (never orders/payments/shipping/inventory/catalog/offers)
```
No `forwardRef`; the architecture-freeze cycle test and module-boundaries test pass
with **no `READ_EXCEPTIONS` widening**. Compliance reads supplier/membership facts
through `SuppliersService` (`getSupplierById`, `getUserMemberships`) and receives
product ownership as a verified fact from the offers owner (`getOfferById`).

### Legal policies, acceptance, consent (Parts 3–5, 8, 29)

* Types `TERMS_OF_SERVICE`, `PRIVACY_POLICY`, `RETAIL_RETURN_POLICY`, `WHOLESALE_TERMS`,
  `SUPPLIER_AGREEMENT`, `MARKETING_NOTICE`, `COOKIE_NOTICE`; scopes `RETAIL`,
  `WHOLESALE_VIP`, `SUPPLIER`, `PUBLIC`; draft → published → retired; `content_hash`;
  `rule_parameters` (versioned business rules, e.g. return window) frozen at publish.
* Requirement bundle = published + `acceptance_required` in the exact scope. Retail
  acceptances never satisfy wholesale requirements and vice versa (tested).
* Acceptance evidence: server resolves the document (must be *currently* published),
  `subject_hash` (HMAC of user id or normalized guest contact), `evidence_hash`,
  `request_metadata_hash` (no raw IP/UA), append-only. A new version ⇒
  `LEGAL_POLICY_REACCEPTANCE_REQUIRED` (409); never accepted ⇒
  `LEGAL_POLICY_ACCEPTANCE_REQUIRED` (409); stale id ⇒ `LEGAL_POLICY_VERSION_NOT_ACTIVE`.
* Consent: append-only `consent_event` per purpose (`MARKETING_EMAIL/SMS/PUSH`,
  `PERSONALIZATION`), state = latest event, never implied by Terms acceptance.
* Binding points: wholesale confirm (`WholesaleFinanceOrchestrator.confirmOrder`:
  gate before `transitionToConfirmed`, immutable `transaction_compliance_snapshot`
  with policy bundle + commercial snapshot hash inside the same transaction);
  retail `POST /legal/retail/checkout-binding` (server-derived disclosure bundle,
  guest acceptances, snapshot keyed by order code), wired into the legacy Next
  `retail/orders` handler behind `KOLBE_RETAIL_LEGAL_GATE=enforce` (fail-closed inside
  the order transaction; default `off` = legacy behaviour, documented in the checklist).

### Business identity & credentials (Parts 6–7)

`business_legal_profile` (all fields nullable, admin-managed, `internal_notes` never
public; public view exposes `disclosureGaps` instead of fake values) and
`business_compliance_credential` (`ENAMAD`, `BUSINESS_LICENSE`, `TAX_REGISTRATION`,
`INDUSTRY_LICENSE`, `OTHER`; `unverified` by default; admin verification requires a
`verificationSource`; public view lists **verified & unexpired** credentials only).
Nothing is seeded.

### Supplier compliance (Parts 11–16)

KYB profile `draft → submitted → under_review → approved | rejected → suspended/expired`,
supplier edits only in `draft`/`rejected`, `needs_information` returns to draft;
immutable review rows; authorization by the supplier's own membership and role
(`owner`/`finance` manage, all roles view, **only `owner` signs the Supplier
Agreement**); private documents (PDF/JPEG/PNG by magic bytes, size cap, checksum,
`scan_status` honest default `unavailable`, HMAC-signed ≤ 15-minute access URLs,
issuance + download audited, object keys never serialized); holds with release-only
history; bank destinations stored as **HMAC hash + mask + status only** (format checks
IBAN mod-97 / Luhn; no ownership verification claimed).
`SupplierComplianceService.getSupplierSettlementEligibility()` returns
`{ eligible, reasons[] }` with `SUPPLIER_COMPLIANCE_PROFILE_MISSING | _NOT_APPROVED |
SUPPLIER_CONTRACT_NOT_ACCEPTED | _OUTDATED | SUPPLIER_VERIFICATION_INCOMPLETE |
SUPPLIER_BANK_NOT_VERIFIED | SUPPLIER_COMPLIANCE_HOLD_ACTIVE` — read-only, no balance,
no payout.

### Product compliance (Part 17)

`product_compliance_record` (`unknown | pending_review | verified | rejected | restricted`,
origin/condition/manufacturer/regulatory identifiers, source-register refs) +
provenance documents. Suppliers declare through `PUT /supplier/offers/:offerId/compliance`
(offer ownership proven by the offers owner) and always land in `pending_review`;
verification is admin-only. `canPublishProduct()` is consumed by
`CatalogService.transitionProductStatus(... "published")`; modes
`external` (default: rejected/restricted supplier products blocked, restricted blocks
first-party too, missing record allowed), `strict` (supplier products need `verified`),
`off` (documented emergency switch). First-party Kolbe flows are unaffected unless a
product is explicitly restricted.

### Invoicing & tax readiness (Parts 18–19)

`commercial_invoice` issued per wholesale child order from the immutable order
financial snapshot + issued proforma (admin action, eligibility = financially
released/paid), sequential `INV-<year>-<n>` numbers under an advisory lock, seller
snapshot from the approved KYB profile (or supplier legal name, `kybStatus` exposed),
buyer snapshot from the wholesale account, `document_hash`, `source_snapshot_hash`;
void = state change with reason. `TaxInvoiceProvider` port (`prepare / validate /
submit / queryStatus`), `fiscal_document` states `draft → ready → submission_pending →
submitted → accepted | rejected | cancelled`, append-only `fiscal_submission_event`
with idempotency keys, provider I/O outside DB locks (TxA claim → provider → TxB result).
The only adapter is `FakeTaxInvoiceProvider` (deterministic, `isRealAuthorityIntegration =
false`, `authorityAcknowledged` can never be true) and it is **refused when
`NODE_ENV=production`**; `TAX_INVOICE_PROVIDER_MODE` defaults to `disabled` in
production. `tax_configuration` is versioned (`config_key`, `version`,
`source_reference`, `effective_at`, `NEEDS_TAX_ACCOUNTANT_REVIEW → VERIFIED`, draft →
active → retired; DB CHECK forbids an active unverified row). Only
`VAT_RATE_PERCENT` is interpreted and it ships absent ⇒ invoices are `not_assessed`.
Retail invoices are not issued (retail orders live in the legacy Next handler) —
documented gap.

### Privacy (Parts 20–25)

`docs/security/data-classification.md`; DTO projections strip reviewer notes, risk
flags, decision reasons, object keys and hashes of third parties; `data_subject_request`
(`access | correction | deletion | restriction`; `submitted →
identity_verification_required → under_review → approved | rejected → processing →
completed`), admin decisions require a reason and are audited; completion of a deletion
is blocked by an active `legal_hold` (`LEGAL_HOLD_ACTIVE`) and always records
`retained_categories` (acceptance evidence, snapshots, financial records, audit log are
never destroyed); retention policies are configurable, destructive actions cannot be
activated without `VERIFIED` basis + duration, and the only execution is a **dry-run**
that counts candidates in compliance-owned categories and reports foreign categories
as `OWNER_SERVICE_NOT_AVAILABLE`. No destructive cron exists.

### Stable error codes (Part 31)

`LEGAL_POLICY_ACCEPTANCE_REQUIRED` 409 · `LEGAL_POLICY_REACCEPTANCE_REQUIRED` 409 ·
`LEGAL_POLICY_VERSION_NOT_ACTIVE` 409 · `LEGAL_POLICY_IMMUTABLE` 409 ·
`LEGAL_POLICY_INVALID_TRANSITION` 409 · `POLICY_SCOPE_MISMATCH` 400 ·
`CONSENT_PURPOSE_INVALID` 400 · `TRANSACTION_SNAPSHOT_EXISTS` 409 ·
`RETAIL_DISCLOSURE_INCOMPLETE` 409 · `SUPPLIER_MEMBERSHIP_REQUIRED` 403 ·
`SUPPLIER_ROLE_NOT_AUTHORIZED` 403 · `SUPPLIER_COMPLIANCE_PROFILE_INCOMPLETE` 409 ·
`SUPPLIER_COMPLIANCE_PROFILE_LOCKED` 409 · `SUPPLIER_COMPLIANCE_INVALID_TRANSITION` 409 ·
`SUPPLIER_COMPLIANCE_NOT_APPROVED` / `SUPPLIER_CONTRACT_NOT_ACCEPTED` /
`SUPPLIER_COMPLIANCE_HOLD_ACTIVE` (eligibility reasons + 409 codes) · `HOLD_ALREADY_RELEASED` 409 ·
`DOCUMENT_TYPE_NOT_ALLOWED` 415 · `DOCUMENT_TOO_LARGE` 413 · `DOCUMENT_CONTENT_MISMATCH` 400 ·
`DOCUMENT_ACCESS_DENIED` 403 · `DOCUMENT_URL_INVALID` 403 · `DOCUMENT_URL_EXPIRED` 409 ·
`BANK_DESTINATION_INVALID` 400 · `BANK_VERIFICATION_INVALID_TRANSITION` 409 ·
`PRODUCT_COMPLIANCE_BLOCKED` 409 · `PRODUCT_COMPLIANCE_VERIFICATION_REQUIRED` 409 ·
`PRODUCT_COMPLIANCE_RECORD_NOT_FOUND` 404 · `DATA_SUBJECT_REQUEST_INVALID_STATE` 409 ·
`LEGAL_HOLD_ACTIVE` 409 · `RETENTION_POLICY_NOT_VERIFIED` 409 · `INVOICE_NOT_ELIGIBLE` 409 ·
`INVOICE_INVALID_TRANSITION` 409 · `INVOICE_ACCESS_DENIED` 403 · `FISCAL_DOCUMENT_EXISTS` 409 ·
`FISCAL_SUBMISSION_INVALID_STATE` 409 · `FISCAL_PROVIDER_NOT_CONFIGURED` 503 ·
`FISCAL_PROVIDER_NOT_ALLOWED_IN_PRODUCTION` 403 · `FISCAL_PROVIDER_ERROR` 502 ·
`TAX_CONFIG_NOT_VERIFIED` 409 · `COMPLIANCE_HASH_KEY_MISSING` 500 ·
`INTERNAL_TOKEN_NOT_CONFIGURED` 503 · `COMPLIANCE_ACCESS_DENIED` 403 · `ROLE_NOT_ALLOWED` 403.
Legacy Next gate: `LEGAL_GATE_UNAVAILABLE` 503, `LEGAL_GATE_INVALID_RESPONSE` 502, Nest
codes passed through (409/400/403).

### HTTP surface added

Public: `GET /legal/policies?scope=`, `GET /legal/policies/history`, `GET /legal/policies/:id`,
`GET /legal/requirements?scope=`, `GET /legal/business-profile`,
`GET /legal/return-policy/evaluate`, `POST /legal/retail/checkout-binding` (internal
token), `POST /legal/retail/disclosure-preview`, `GET /legal/documents/access/:token`.
Account: `GET/POST /legal/me/acceptances`, `GET /legal/me/requirements`,
`GET/POST /legal/me/consent`, `GET/POST /legal/me/data-requests`, `GET /legal/me/data-export`.
Supplier: `/supplier/compliance/:supplierId/{profile, profile/submit, documents, agreement,
agreement/accept, holds, bank, settlement-eligibility}`, `/supplier/compliance/documents/:id/access`,
`/supplier/compliance/products/documents/:id/access`, `/supplier/offers/:offerId/compliance{,/documents}`.
Admin: `/admin/compliance/{policies, business-profile, credentials, suppliers, products,
retention-policies, legal-holds, data-requests, snapshots}`, `/admin/invoicing/{wholesale,
invoices, fiscal, tax-config}`; buyer/supplier read: `/invoicing/wholesale/:orderId`,
`/invoicing/invoices/:id`.

## Architecture proofs (Part 43/52)

* Compliance/invoicing write only their own tables — `module-boundaries.test.ts`
  (no exceptions added) + `phase-4-7-5-security-boundaries.test.ts` (registry ownership
  and import scan).
* No cycle of any length — `architecture-freeze.test.ts` (the first attempt created
  `catalog → compliance → offers → catalog`; it was resolved by moving the supplier
  provenance routes to the offers owner, not by an allowlist).
* Immutability is enforced by PostgreSQL triggers and proven by direct `UPDATE`/`DELETE`
  attempts in tests, not by service code alone.
* Guest identity is hashed with a keyed HMAC; the raw contact never appears in
  compliance tables (asserted).
* Settlement eligibility is read-only; no wallet/settlement/payout/withdrawal/balance
  table exists (asserted against the schema and the migration).

## Documents

* `docs/compliance/iran-legal-source-register.md` — 15 sources (S-01 … S-15) with
  `verification_status` (PRIMARY_TEXT_CHECKED for the E-Commerce Law articles actually
  read; SECONDARY_ONLY / NEEDS_EXTERNAL_VERIFICATION elsewhere), separation of legal
  fact / business policy / configurable rule / interpretation, and the table of where
  each configurable value lives (all ship empty).
* `docs/compliance/legal-launch-checklist.md` — per-item status ladder (every item is
  at most TECHNICALLY IMPLEMENTED) and the production configuration still required.
* `docs/security/data-classification.md` — P0–P7 classes, bank-data decision, hashing
  keys, access rules.

## Known limitations / follow-ups (not hidden)

* Retail checkout is still the legacy Next handler; the legal gate is wired there behind
  `KOLBE_RETAIL_LEGAL_GATE` (default `off`) and must be set to `enforce` at launch.
  A future Nest checkout module should call `ComplianceService.bindRetailCheckout()`
  directly inside its order transaction.
* Retail commercial invoices are not issued (owner table `retail_order` belongs to the
  planned checkout module).
* Document storage adapter is `local_private`; `s3_private` is a production requirement.
  No malware scanning exists (`scan_status = unavailable`).
* Bank destination values are not retained (hash + mask only) — a KMS/vault or
  provider tokenization is required before Phase 4.8 payouts.
* Return window, retention durations, VAT rate, policy texts, business identity and
  credentials all ship **empty** and must be supplied by counsel / accountant / admin.

## Explicit disclosures

* Legal counsel review: **NO**
* Tax accountant review: **NO**
* eNAMAD verified: **NO** (registry only; nothing seeded)
* Real tax API (سامانه مؤدیان) integration: **NO** (port + production-refused fake only)
* Tax invoice submitted to / accepted by any authority: **NO**
* Real payment provider: **NO** · real carrier: **NO** (Phase 4.7/4.7.1 fake adapters only)
* Wallet / settlement / payout: **NO** (read-only eligibility contract only)
* The word "compliant" is not claimed anywhere in code, UI or docs for Kolbe.

## Final Phase 4.7.5 verification record

To be filled by the follow-up docs commit after CI completes on the report commit
(see git history: `docs: record phase 4.7.5 final CI`).

Phase 4.8 Supplier Wallet, Settlement & Payout has NOT started.
