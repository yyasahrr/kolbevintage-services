# Phase 4.8 — Decisions Log (frozen in Phase 4.7.6)

Classification key:
**FROZEN** — architectural rule, implemented or enforced by tests/docs now; Phase 4.8 must not change it.
**CONFIGURABLE** — shape frozen, value comes from versioned configuration with a snapshot per child; no
default other than the stated safe default.
**BUSINESS_DECISION_REQUIRED** — Kolbe management must decide; the code must not guess.
**LEGAL_REVIEW_REQUIRED / TAX_REVIEW_REQUIRED / PROVIDER_CONTRACT_REQUIRED** — external review; never
asserted from code.

No rate, fee, duration, threshold or legal statement in this file is a business value; where a
number appears it is the safe default *before configuration* (0) or a test fixture.

## A. Frozen architectural rules (already true or enforced in 4.7.6)

| Id | Rule | Where enforced / evidenced |
|----|------|----------------------------|
| A1 | The parent order is the **buyer** transaction; a child is the **seller** transaction. Settlement never keys on the parent paid amount. | FI-4, matrix #1/#2 |
| A2 | Economic entitlement is recorded at **seller / child / item / quantity** from **immutable snapshots** (proforma lines, shipment items, refund lines). | FI-3, FI-6, FI-13; readiness items |
| A3 | Kolbe first-party child ⇒ **no supplier payable, commission 0, excluded** from settlement. Identity = `seller_kolbe` singleton, `purchase_order.supplier_id IS NULL`. | FI-1, FI-12 (S1) |
| A4 | External supplier is identified **server-side**; no client-provided `isExternalSupplier`. | FI-1; readiness `identifiedBy` |
| A5 | Commission default **0** before configuration; basis CONFIGURABLE and **snapshotted per child**; not retroactive. | `basisPoints()`; S12; ADR posting rules |
| A6 | Shipping economics fields `shipping_charge_to_buyer / shipping_economic_recipient / shipping_cost_bearer / shipping_provider` with policies supplier-entitled \| Kolbe-retained \| carrier-pass-through \| subsidized \| zero \| unquoted; **never inferred** from physical `shipping_responsibility`. Until modelled: blocker `SHIPPING_ECONOMIC_OWNER_UNDEFINED`, fee posted nowhere. | S9/S10; event contract |
| A7 | Tax is **not supplier cash by default**; excluded from the basis; `TAX_TREATMENT_UNVERIFIED` while a rate is active or tax assessed. | S11 |
| A8 | **Payment ≠ entitlement.** Cash coverage (verified allocations ≥ payable) is a *precondition*, not an earning. | S3 (covered but not delivered ⇒ preview 0) |
| A9 | Milestone: **cash covered AND quantity-evidenced delivered ⇒ pending earnings**; availability after a **configurable hold** (no hard-coded days anywhere). | readiness blockers; `HOLD_POLICY_UNDEFINED` |
| A10 | Attribution is **quantity-level**: partial delivery earns only the delivered units; `entitledUnits = max(0, min(delivered, ordered − refundedUndelivered) − refundedDelivered)`. | FI-13 |
| A11 | Pre-settlement refund reduces **only the exact slice** (child/item/quantity, or unallocated money when order-scoped). | FI-9 (4.7.6 fix), S4 |
| A12 | Post-settlement refund = **debit adjustment / negative carry-forward**; history immutable; no payout reversal. | ADR posting rules; S13 |
| A13 | Replacement = explicitly linked **new** order; **no automatic transfer** of cash or entitlement. | S14 |
| A14 | Cancellation is **not** a payment, release, refund or settlement event. | S17, FI-19 |
| A15 | Chargeback readiness is **documented, not faked**: no provider event type exists; readiness reports `chargebackFactsAvailable=false`. | matrix #23; event `PaymentReversed` (future) |
| A16 | `unallocatedPaid` is **never supplier money**; refundable only order-scoped. | FI-9, S6 |
| A17 | **Release ≠ cash**: credit/COD/manual releases never create entitlement or cash facts. | FI-8, S7/S8 |
| A18 | `financial_ledger_entry` `SUM(IN) − SUM(OUT)` = net verified cash of the **order** after completed refunds; **never** a supplier balance; the ledger is single-entry cash evidence, not a GL. | FI-5; glossary |
| A19 | Withdrawal = a **payout request** of available settlement balance; payout = provider execution (TxA → provider → TxB). | concurrency model §2 |
| A20 | User-facing terms: **Pending earnings / Available for settlement / Settlement pending / Settled / Amount on hold**. Never "wallet balance", "withdrawable balance" or "supplier balance". | glossary; FI-20 forbids the fields |
| A21 | Admin overrides only as **explicit adjustment journals** with reason and actor; never editing prior rows. | ADR |
| A22 | Deterministic **integer bps** rounding (`basisPoints`, half-up default, explicit `down`), largest-remainder splits (`allocateProportionally`), Σ parts = amount. | FI-22 |
| A23 | **Currency mismatch rejected**; IRR only; **no FX**. | FI-9/S20; DB CHECKs |
| A24 | Settlement ledger = **separate balanced double-entry subledger** (`settlement_account/journal/posting`), append-only, `SUM(debits) = SUM(credits)`; not the statutory GL; not a retrofit of the payment ledger. | ADR |
| A25 | Status-only delivery is **not settlement evidence** (`DELIVERY_EVIDENCE_MISSING`). | FI-14 |
| A26 | Refund delivery basis convention until an RMA flow exists: exception-linked (same child) ⇒ undelivered; unlinked lines ⇒ delivered; amount-only ⇒ unspecified (reduces amount, raises notice). Conservative: never over-credits a supplier. | readiness; FI-10 |

## B. Configurable (shape frozen, value pending)

| Id | Item | Shape | Safe default before configuration | Owner of the decision |
|----|------|-------|-----------------------------------|-----------------------|
| B1 | Commission rate | integer bps (0–10000) per policy version; optional per-category/per-supplier overrides; rounding mode | **0** | BUSINESS_DECISION_REQUIRED |
| B2 | Commission basis | one of: merchandise entitled value (net of refunds) \| gross ordered value \| merchandise + shipping (only if shipping policy = supplier-entitled) — snapshotted per child | none (must be chosen before any non-zero rate) | BUSINESS_DECISION_REQUIRED (do **not** guess) |
| B3 | Availability hold | duration or milestone-based rule per policy version; per-supplier override allowed | none (blocker until set) | BUSINESS_DECISION_REQUIRED (+ LEGAL_REVIEW for return-window alignment) |
| B4 | Minimum payout amount | integer IRR | none | BUSINESS_DECISION_REQUIRED |
| B5 | Withdrawal limits | per-request max, daily/monthly caps, count limits | none | BUSINESS_DECISION_REQUIRED (+ LEGAL_REVIEW for AML thresholds) |
| B6 | Settlement cadence | on-request only \| scheduled windows (no automatic scheduler in 4.8 without explicit approval) | on-request only | BUSINESS_DECISION_REQUIRED |
| B7 | Payout fee owner | supplier-deducted \| Kolbe-absorbed \| split (bps) | none | BUSINESS_DECISION_REQUIRED + PROVIDER_CONTRACT_REQUIRED (actual fee) |
| B8 | Shipping economic policy per child | A6 policy set, snapshotted | `unquoted`/`UNDEFINED` blocker | BUSINESS_DECISION_REQUIRED |
| B9 | Negative-position recovery | carry-forward against future earnings \| invoice supplier \| both, with thresholds | carry-forward (no cash demand) | BUSINESS_DECISION_REQUIRED + LEGAL_REVIEW_REQUIRED |
| B10 | Commission reversal on refunds | reverse commission on refunded slice yes/no/partial | reverse in full (safe for supplier) — pending confirmation | BUSINESS_DECISION_REQUIRED |
| B11 | Rounding residue owner | Kolbe residue account | Kolbe | FROZEN shape, value confirmed by finance |

## C. Decisions required before Phase 4.8 can post real money

| Id | Question | Classification | Notes from the audit |
|----|----------|----------------|----------------------|
| C1 | Collection model: does Kolbe collect buyer funds and pay suppliers (platform collection), or does a provider split at payment time? | LEGAL_REVIEW_REQUIRED + PROVIDER_CONTRACT_REQUIRED | Current code is platform collection (order-level payment); no split-payment provider is integrated, none may be claimed. |
| C2 | Tax treatment: are proforma prices tax-inclusive or exclusive; who remits VAT; is the invoice `grand_total` allowed to exceed the obligation? | TAX_REVIEW_REQUIRED | Today: invoice adds tax on top while the obligation excludes it (S11). |
| C3 | Entitlement milestone details: does buyer acceptance / return window matter beyond carrier delivery? | BUSINESS_DECISION_REQUIRED + LEGAL_REVIEW_REQUIRED | Technical evidence exists only for carrier/admin delivered shipments. |
| C4 | Hold policy value(s) | BUSINESS_DECISION_REQUIRED | none hard-coded. |
| C5 | Post-settlement refund recovery (B9) | BUSINESS_DECISION_REQUIRED + LEGAL_REVIEW_REQUIRED | |
| C6 | Negative position handling & supplier communication | BUSINESS_DECISION_REQUIRED | |
| C7 | Rounding rule confirmation (half-up on bps; residue to Kolbe) | FROZEN technically; finance to confirm | `basisPoints` tests |
| C8 | Minimum payout / limits / cadence (B4–B6) | BUSINESS_DECISION_REQUIRED | |
| C9 | Payout fee owner and actual provider fees | PROVIDER_CONTRACT_REQUIRED | no provider fee may be invented. |
| C10 | Provider split vs platform collection for future providers | PROVIDER_CONTRACT_REQUIRED | |
| C11 | Chargeback/dispute process and hold duration | PROVIDER_CONTRACT_REQUIRED + LEGAL_REVIEW_REQUIRED | no chargeback fact exists today. |
| C12 | Whether admin status-only delivery may ever count as delivery for settlement | BUSINESS_DECISION_REQUIRED | technically frozen as *not evidence* until decided otherwise with an explicit adjustment path. |
| C13 | Legality of marketplace payouts to suppliers under Iranian regulation (licensing, AML/KYB thresholds) | LEGAL_REVIEW_REQUIRED | never asserted from code; compliance eligibility is a gate, not a legal opinion. |
| C14 | Self-billing / settlement statement document requirements | TAX_REVIEW_REQUIRED + LEGAL_REVIEW_REQUIRED | Invoicing owns documents. |

## D. Things Phase 4.8 must NOT do (restated from the mandate)

Implement a customer wallet or top-up; a supplier-to-supplier transfer; a real provider split payment;
an automatic settlement scheduler without explicit approval; a mutable balance column; a payout
without provider evidence; any real Iranian payment/carrier/tax API claim; any legal assertion.
