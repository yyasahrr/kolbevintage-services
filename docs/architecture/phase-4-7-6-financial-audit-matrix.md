# Phase 4.7.6 — Financial Architecture Audit Matrix

**Status:** audit of the repository as it exists at the start of Phase 4.7.6 (branch
`arena/01a0b926-kolbevintage-services`, baseline 23 migrations / 85 tables / 194 FKs / 266 CHECKs /
737 tests). Every row was verified against the code, the DB constraints and — where marked — an
executable test. Old phase reports were **not** used as proof.

**Scope reminder.** Phase 4.8 (Supplier Wallet, Settlement & Payout) has **NOT** started. This matrix
proves what money is *received*, who *economically owns* it and what is still undefined. It does not
implement a wallet, a balance, a settlement batch, a withdrawal or a payout.

Legend for the property columns: ✅ true and verified · ❌ false · ◐ partially / by convention only ·
— not applicable. "Verified by" names the test that exercises the row (all Phase 4.7.6 tests run on a
real PostgreSQL through the 4.7.1 harness).

---

## 1. Money concepts

| # | Concept | Owner (module) | Source of truth (table / service) | Formula / derivation | Trigger (who/when) | Immutable | Idempotent | Concurrency-safe | Seller-specific | Refund/Shipping/Tax aware | Settlement-safe | Current defect? | 4.7.6 fix | 4.8 responsibility |
|---|---------|----------------|-----------------------------------|----------------------|--------------------|-----------|------------|------------------|-----------------|---------------------------|-----------------|-----------------|-----------|--------------------|
| 1 | **Parent order total** (`wholesale_order.grand_total`) | Orders | `wholesale_order` (`items_total`, `grand_total`) written once by `OrdersService.createWholesaleOrder` from the accepted-terms snapshots | Σ child `items_total`; buyer transaction, never a seller amount | Buyer creates order from accepted VIP requests | ✅ (`order_code` trigger-immutable; totals never updated after creation — later shipping fees live on the proforma, not here) | ✅ (`command_idempotency`) | ✅ (row locks) | ❌ (buyer-level by design) | ❌ (pre-shipping, pre-tax) | ✅ as *buyer* total only | No | — | Never used as a settlement input (FROZEN) |
| 2 | **Child order total** (`purchase_order.items_total/grand_total`) | Orders | `purchase_order` + `purchase_order_item` (created with the parent, one per seller) | Σ line totals of that seller's items | Same command as #1 | ✅ (`order_code` trigger; totals not updated) | ✅ | ✅ | ✅ (`seller_id`, `supplier_id NULL` ⇒ Kolbe) | ❌ | ◐ — identity and gross merchandise only | No | — | Settlement reads the **proforma line snapshot**, not this projection |
| 3 | **Item price snapshot** (`wholesale_order_item.unit_price/line_total/pricing_unit/quantity/piece_quantity`) | Orders (from VIP accepted-terms snapshot + `pricing.logic#resolvePrice`) | `wholesale_order_item` | `line_total = unit_price × (PIECE/PER_PIECE ? piece_quantity : quantity)` (`order.logic#calculateLineTotal`) | Order creation | ✅ (no code path updates it) | ✅ | ✅ | ✅ (`seller_id`, `supplier_id`) | — | ✅ | **Yes (unit basis):** `getOrderFinancialSnapshot` copied `quantity` (package count) into the proforma line even when the price is per piece ⇒ `unit_price × quantity ≠ line_total` for a package-sold, piece-priced line; refund lines would under-refund by the package multiplier. Reachable because a selected tier's `pricingUnit` overrides the offer unit (`resolvePrice` L205). Harness offers are PIECE-only so nothing caught it. | ✅ Snapshot quantity is now expressed in the pricing unit; issuance fails closed with `PROFORMA_LINE_BASIS_INCONSISTENT` (422). Test: `phase-4-7-6-financial-invariants` FI-3. | Add a DB CHECK on `wholesale_proforma_line (unit_price × quantity = line_total)` in the 4.8 migration |
| 4 | **Shipping fee (buyer charge)** | Shipping (quote) → Finance (orchestrates) → Payments (proforma supersede) | `shipping_quote.amount`; `wholesale_proforma.shipping_total` (new version via `supersedeProformaForShipping`) | new proforma `total = items_total + shipping_total`; earlier allocations follow the lineage | Supplier requests quote; **admin/finance** selects (`selectQuote`); may happen after payment ⇒ delta obligation | ✅ (superseded proforma immutable by trigger 0019) | ✅ (`claimCommand`) | ✅ | ✅ per child | ✅ refund-capped; ❌ tax | ❌ — **economic owner undefined** | Gap (not a money bug): only `shipping_responsibility` (physical) exists; no `shipping_charge_to_buyer/economic_recipient/cost_bearer/provider` semantics | Documented; readiness blocker `SHIPPING_ECONOMIC_OWNER_UNDEFINED` | Add the four shipping-economics fields + policy snapshot (BUSINESS_DECISION_REQUIRED) |
| 5 | **Tax** | Invoicing | `tax_configuration` (`VAT_RATE_PERCENT`, must be `active` + `VERIFIED`); `commercial_invoice.tax_total/tax_status/tax_basis_reference` | `tax_total = subtotal × round(percent×100) / 10000` (integer, bps) — invoice only | Admin issues the child invoice; absent config ⇒ `not_assessed`, 0 | ✅ (issued invoice immutable by trigger) | ✅ | ✅ | ✅ per child invoice | — | ❌ | **Inconsistency (TAX_REVIEW_REQUIRED):** invoice `grand_total = subtotal + shipping + tax` while the proforma/payment obligation never includes tax ⇒ with an active verified rate the invoice exceeds what the buyer was asked to pay (tax-inclusive vs exclusive pricing undecided). No verified rate exists today, so totals are equal. | No code change (must not guess). Test S11 demonstrates the gap; readiness blocker `TAX_TREATMENT_UNVERIFIED`; tax is **never** supplier cash | Decide inclusive/exclusive pricing and who remits (TAX_REVIEW_REQUIRED) before 4.8 posts any tax line |
| 6 | **Discount** | — | none | — | — | — | — | — | — | — | — | Not modelled (no discount field on order/proforma/invoice) | Documented | If introduced: order-level discounts must be split with `allocateProportionally` (largest remainder) and snapshotted per line (BUSINESS_DECISION_REQUIRED) |
| 7 | **Proforma** (`wholesale_proforma` + `wholesale_proforma_line`) | Payments | One `issued` proforma per child from `OrdersService.getOrderFinancialSnapshot` via `PaymentsService.issueProformasFromSnapshot`; versions via supersede | `items_total = Σ line_total`; `total_amount = items_total + shipping_total`; `terms_snapshot` JSON | Buyer confirm (`confirmOrder`) | ✅ issued financial fields trigger-immutable (0019); lines have no update path | ✅ (existing issued proforma reused) | ✅ (`FOR UPDATE`) | ✅ (`seller_id`, `supplier_id`, `child_order_id`) | ✅ shipping; ❌ tax | ✅ — **the commercial-terms snapshot** | See #3 | See #3 | Settlement basis = proforma **lines** (FROZEN) |
| 8 | **Payment** (`payment`) | Payments | Order-level row (`wholesale_order_id`), `method` (transfer/online/…), `provider`, `provider_reference` (UNIQUE per provider), `status` | Amount is what the buyer paid; verification either admin (`verifyPayment`) or provider webhook/reconciliation (TxA→provider→TxB) | Buyer submits; admin/provider verifies | ◐ status transitions only; amount/currency never edited (currency CHECK `IRR`) | ✅ (`command_idempotency` + `provider_reference` uniqueness) | ✅ (row locks; `already_final` on replays) | ❌ **order-level by design** | — | ◐ cash evidence only | No | — | Payment is *cash evidence*, never entitlement (FROZEN) |
| 9 | **Payment allocation** (`payment_allocation`) | Payments | Rows (payment → proforma) created at verification by `allocatePaymentToProformas` | Deterministic: smallest issued total first, then `issued_at`, `id`; capped per lineage; remainder stays **unallocated** | Verification | ✅ (no update path; `status` active) | ✅ | ✅ | ✅ via proforma → child | — | ✅ — the only seller-cash attribution | No | Readiness exposes `unallocatedOrderMoney` labelled "never supplier money" | 4.8 `ChildPaymentCovered` derives from Σ verified active allocations ≥ proforma total |
| 10 | **Refund** (`refund`) | Payments (created through Finance orchestrator) | `refund` (`child_order_id` nullable, `fulfillment_exception_id`), `refund_allocation` (source payments), `refund_line` (item/quantity basis) | Child-scoped ceiling = Σ verified active allocations of the child − live child refunds; amount = Σ line `unit_price × quantity` when lines given | Admin/finance create → approve → complete (evidence required) / provider execution | ✅ append-only by code (status transitions only) | ✅ | ✅ (verified payments locked `FOR UPDATE` per order) | ✅ when `child_order_id` set | ✅ | ✅ for child-scoped | **Yes:** an **order-scoped** refund (no child) was capped by *total verified − all refunds*, i.e. it could return money that is allocated to a child ⇒ not seller-attributable | ✅ Order-scoped ceiling = unallocated verified money − live order-scoped refunds; otherwise `REFUND_SCOPE_REQUIRED` (409). Source-payment capacity for order-scoped refunds = payment amount − its active allocations. Tests FI-9 | Post-settlement refunds become **adjustment postings** (FROZEN) |
| 11 | **Refund allocation / line** | Payments | `refund_allocation.amount` per source payment; `refund_line (wholesale_order_item_id, quantity, unit_price, line_total)` | Lines priced from the **active proforma line**; cumulative refunded qty ≤ ordered qty | Refund creation | ✅ | ✅ | ✅ | ✅ (item → `seller_id`) | ✅ | ✅ | **Yes (linkage):** `fulfillment_exception_id` was never checked against the refund's child ⇒ a cross-child exception link could mis-classify undelivered vs delivered quantity | ✅ `REFUND_EXCEPTION_CHILD_MISMATCH` (409) / `EXCEPTION_NOT_FOUND` (404) in `WholesaleFinanceOrchestrator.createRefund`. Test FI-9 | Return/RMA flow must carry an explicit delivery basis (FROZEN convention until then: exception-linked = undelivered) |
| 12 | **Financial release** (`order_financial_release`) | Payments (gate rows) / Finance (decision) | Types `payment_verified`, `credit_approved`, `cod_policy_approved`, `manual_authorized_release` | `payment_verified` only when every issued proforma is covered by verified allocations | Verification / admin credit / COD / manual | ✅ | ✅ | ✅ | ❌ order-level | — | ❌ — **release ≠ cash** | No (semantics correct) | Readiness: `financialReleaseWithoutCash`, blocker `PAYMENT_NOT_COLLECTED` | Settlement must key on cash coverage, never on a release row (FROZEN) |
| 13 | **Financial ledger** (`financial_ledger_entry`) | Payments | Append-only (triggers `financial_ledger_entry_no_update/no_delete`); `entry_type` `payment_verified` (IN, `child_order_id NULL`) and `refund_completed` (OUT, child may be set) | SUM(IN) − SUM(OUT) per **order** = net verified cash after completed refunds | Verification / refund completion | ✅ (DB trigger) | ✅ | ✅ | ❌ (IN rows are order-level) | ◐ | ❌ — **not a seller balance, not double-entry, not a GL** | No | Glossary + readiness `ledgerMeaning` | 4.8 creates a **separate balanced settlement subledger** (ADR) |
| 14 | **Commercial invoice** (`commercial_invoice`, `_line`) | Invoicing | Issued from the order snapshot + issued proforma; `subtotal/shipping_total/tax_total/grand_total`; `document_hash`, `source_snapshot_hash` | see #5 | Admin issues per child | ✅ (trigger `commercial_invoice_immutable_when_issued`, lines append-only) | ✅ | ✅ | ✅ | ✅ shipping, tax | ❌ — a *document*, never a payout basis | See #5 | Documented: payout must not be derived from invoice totals | Invoice remains evidence; settlement reads proforma lines + allocations + shipment items |
| 15 | **Fiscal document** (`fiscal_submission_event`, provider adapters) | Invoicing | Append-only submission evidence; fake provider blocked in production | — | Admin submits | ✅ | ✅ | ✅ | ✅ | — | — | No | — | No real Iranian tax API integration is claimed |
| 16 | **Compliance eligibility** | Compliance | `SupplierComplianceService.getSupplierSettlementEligibility(supplierId)` → `{eligible, reasons[], policy}` (profile, approval, contract, verification, bank, holds) | Rule set owned by Compliance (never duplicated) | On demand (read-only) | ◐ (derived; holds append-only) | ✅ | ✅ | ✅ | — | ✅ (gate input) | No | Readiness reuses it: `SUPPLIER_COMPLIANCE_BLOCKED`, `BANK_DESTINATION_NOT_VERIFIED` | 4.8 `ComplianceEligibilityChanged` event source |
| 17 | **Economic entitlement (seller/child/item/quantity)** | *none today* (read-only reconstruction in `settlement-readiness`) | `wholesale_proforma_line` (basis) + `shipment_item.piece_quantity` of `delivered` shipments (evidence) + `refund_line` (reductions) | per item: `deliveredUnits = floor(deliveredPieces / piecesPerUnit)`; `entitledUnits = max(0, min(deliveredUnits, orderedUnits − refundedUndelivered) − refundedDelivered)`; value = `unit_price × entitledUnits` | On demand | ✅ inputs immutable | ✅ (pure function of rows) | ✅ (reads only) | ✅ quantity-level | ✅ refunds; shipping/tax **excluded** | ◐ — sufficient **data**, no engine | Gap: status-only delivery (`POST /supplier/orders/:id/deliver`) carries no quantity evidence | Readiness blocker `DELIVERY_EVIDENCE_MISSING`; tests S3/S4/S13/S18/S19 | 4.8 `ChildQuantityDelivered` / `ChildQuantityRefunded` postings |
| 18 | **Commission** | — | none (no table, no config, no env) | FROZEN default before configuration: **0**; basis configurable & snapshotted; `basisPoints()` is the rounding primitive | — | — | — | — | — | — | — | Not modelled | `packages/shared/money.ts#basisPoints` + tests; readiness `commission.defaultBeforeConfiguration = "0"`, blocker `COMMISSION_POLICY_UNDEFINED` | Commission policy table + per-child snapshot (BUSINESS_DECISION_REQUIRED for rate/basis) |
| 19 | **Supplier payable** | — | none | — | — | — | — | — | — | — | — | Not modelled (correct: nothing may be called a payable yet) | Readiness `merchandiseEntitledPreview` labelled NOT A SETTLEMENT BALANCE | Settlement subledger account per supplier (ADR) |
| 20 | **Hold** | Compliance (compliance/legal holds) | `supplier_compliance_hold`, `legal_hold` (append-only, release-only transitions) | — | Admin | ✅ | ✅ | ✅ | ✅ | — | ✅ as gate input | No availability-hold policy exists (no duration anywhere) | Blocker `HOLD_POLICY_UNDEFINED`; no days hardcoded | Configurable hold policy (BUSINESS_DECISION_REQUIRED) |
| 21 | **Payout eligibility** | — (Compliance provides the compliance part) | #16 + cash coverage + delivery + refunds + configuration | see readiness contract | On demand | — | ✅ | ✅ | ✅ | ✅ | ◐ | — | `SettlementReadinessService` (read-only, admin) | 4.8 payout gate |
| 22 | **Payout** | — | none | — | — | — | — | — | — | — | — | Not modelled | — | Provider payout adapter (PROVIDER_CONTRACT_REQUIRED) |
| 23 | **Chargeback / dispute / reversal** | — | none (`payment_provider_event.event_type` has no reversal/chargeback/dispute value; a verified payment answers `already_final` to later provider events) | — | — | — | — | — | — | — | — | Gap: not representable | Documented; readiness `capabilities.chargebackFactsAvailable=false`; blocker `DISPUTE_OR_CHARGEBACK_HOLD` is defined but never raised | New provider event types + reversal fact (never mutate a verified payment) |

## 2. Identity and attribution chain (verified)

```
seller (type KOLBE|SUPPLIER; CHECK KOLBE ⇔ supplier_id IS NULL; unique KOLBE singleton `seller_kolbe`)
  └─ purchase_order (seller_id, supplier_id NULL ⇒ Kolbe first-party)          ← child = seller transaction
       └─ purchase_order_item → wholesale_order_item (seller_id, supplier_id, pricing_unit, quantity, piece_quantity, unit_price, line_total)
            ├─ wholesale_proforma_line (immutable commercial basis; quantity in pricing unit — 4.7.6 fix)
            ├─ shipment_item.piece_quantity  (shipment.status = 'delivered' ⇒ quantity evidence)
            └─ refund_line (quantity, unit_price, line_total; refund.child_order_id; refund.fulfillment_exception_id)
payment (ORDER level) → payment_allocation → wholesale_proforma (child) → seller      ← the only cash→seller link
```

The external-supplier signal is **server-side** (`purchase_order.supplier_id`, copied from the seller at
order creation). No API accepts an `isExternalSupplier` flag.

## 3. DB-level enforcement inventory relevant to money

| Guarantee | Mechanism | Migration |
|-----------|-----------|-----------|
| Kolbe singleton, seller/supplier consistency | CHECK + partial unique index on `seller` | 0005 |
| Order codes immutable | triggers | 0013 |
| `order_status_history`, `order_event` append-only | triggers | 0012 |
| Issued proforma financial fields immutable | trigger `wholesale_proforma_issued_immutable` (P0001) | 0019 |
| Ledger append-only | triggers `financial_ledger_entry_no_update/no_delete` | 0018 |
| Currency `IRR` only on every money table | CHECK `*_currency_allowed` (20 tables) | various |
| Money ranges, positive quantities | CHECK `moneyCheck` / `positiveQuantityCheck` | various |
| Invoice immutable when issued; lines append-only; fiscal events append-only | triggers | 0022 |
| Compliance holds release-only | triggers | 0022 |
| **Not enforced by DB (convention + tests):** `payment_allocation`, `refund_line`, `refund_allocation`, `shipment_item`, `wholesale_proforma_line` rows are never updated | no triggers | — (4.8 candidate) |

## 4. Defects fixed in Phase 4.7.6 (all with regression tests)

| Id | Defect | Fix | Test |
|----|--------|-----|------|
| D1 | Proforma line quantity not in pricing unit (package-sold, piece-priced line) ⇒ `unit_price × quantity ≠ line_total`; refund basis wrong | `getOrderFinancialSnapshot` uses `piece_quantity` for PIECE/PER_PIECE pricing; `issueProformasFromSnapshot` fails closed (`PROFORMA_LINE_BASIS_INCONSISTENT`, 422) | `phase-4-7-6-financial-invariants` › FI-3 |
| D2 | Order-scoped refunds could return seller-attributable (allocated) money | Ceiling = unallocated verified − live order-scoped refunds; `REFUND_SCOPE_REQUIRED` (409); source-payment capacity = unallocated part | FI-9 |
| D3 | Refund could cite a fulfillment exception of another child | `REFUND_EXCEPTION_CHILD_MISMATCH` (409), `EXCEPTION_NOT_FOUND` (404) | FI-9 |

## 5. Gaps explicitly *not* fixed (and why)

| Gap | Classification | Where it is recorded |
|-----|----------------|----------------------|
| Tax on invoice vs tax-free obligation | TAX_REVIEW_REQUIRED | `phase-4-8-decisions.md`, readiness `TAX_TREATMENT_UNVERIFIED` |
| Shipping economic owner | BUSINESS_DECISION_REQUIRED (+ schema in 4.8) | decisions log, readiness `SHIPPING_ECONOMIC_OWNER_UNDEFINED` |
| Status-only delivery accepted for order status | BUSINESS_DECISION_REQUIRED (whether admin-marked status may count) — technically FROZEN: **not** settlement evidence | readiness `DELIVERY_EVIDENCE_MISSING` |
| Chargeback / reversal representation | PROVIDER_CONTRACT_REQUIRED | event contract |
| Commission, hold, min payout, cadence | BUSINESS_DECISION_REQUIRED | decisions log |
| `finance` HTTP role | `account_user.role` CHECK has no `finance`; the claim exists but cannot be issued ⇒ admin-only surfaces in practice | readiness security test |

## 6. Migration statement

**Phase 4.7.6 required no schema migration.** All fixes are service-level; the recommended DB CHECK on
proforma line consistency and the shipping-economics fields belong to the Phase 4.8 forward-only
migration (never touching 0018–0022).
