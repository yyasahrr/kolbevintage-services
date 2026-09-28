# Phase 4.8 — Domain Ownership Map (frozen in Phase 4.7.6)

Principle (unchanged since Phase 3.10): **one table, one writer**. Orchestrators own no tables and
coordinate owner services inside one transaction. Nothing below grants a module write access to a
table it does not own. Phase 4.8 has NOT started; the "future" rows are frozen intentions.

## 1. Ownership today (verified against `apps/api/src/modules/registry.ts`)

| Module | Owns (tables) | Publishes facts for settlement | Reads from (via owner services only) |
|--------|---------------|--------------------------------|--------------------------------------|
| **Orders** | `wholesale_order`, `wholesale_order_item`, `purchase_order`, `purchase_order_item`, `order_status_history`, `order_event`, `wholesale_order_request` | child identity (`seller_id`, `supplier_id`), immutable line snapshot (`pricing_unit`, `quantity`, `piece_quantity`, `unit_price`, `line_total`), status history (delivery trigger/actor) | Inventory (reservations), VIP (accepted terms) |
| **Payments** | `wholesale_proforma`, `wholesale_proforma_line`, `payment`, `payment_allocation`, `order_financial_release`, `financial_ledger_entry`, `refund`, `refund_allocation`, `refund_line`, `payment_provider_event` | commercial terms snapshot; verified cash & allocations; refunds with exact lines; releases; cash-evidence ledger | Orders (financial snapshot, locks), Fulfillment (registry dependency; exception linkage stored as FK) |
| **Finance (orchestrator)** | — (owns **no** tables) | decisions: confirm, verify, release, refund lifecycle, shipping fee supersede, provider intents; 4.7.6: exception/child consistency check for refunds | Payments, Orders, Compliance, Fulfillment, Payment provider registry |
| **Shipping** | `shipping_quote`, `shipment`, `shipment_item`, `shipment_event` (+ command idempotency use) | quantity-evidenced delivery (`shipment_item.piece_quantity` × `delivered`), quotes (buyer shipping charge) | Orders (shipping context, projections), Inventory (consumption), Suppliers, Finance (fee supersede) |
| **Fulfillment** | `fulfillment_exception`, `fulfillment_replacement_request` | exception ⇄ child ⇄ affected items (undelivered basis), explicit replacement linkage | Orders, Inventory, Suppliers, Supplier-team, VIP |
| **Compliance** | `supplier_compliance_profile/review/document/hold`, `supplier_contract_acceptance`, `supplier_bank_verification`, `legal_policy_document/acceptance`, `consent_event`, `business_legal_profile`, `business_compliance_credential`, `product_compliance_record/document`, `data_retention_policy`, `data_subject_request`, `legal_hold`, `transaction_compliance_snapshot` | `getSupplierSettlementEligibility` (approval, contract, verification, bank, holds) | Suppliers, Audit (never Orders/Payments/Offers/Catalog) |
| **Invoicing** | `commercial_invoice`, `commercial_invoice_line`, `fiscal_document`, `fiscal_submission_event`, `tax_configuration` | tax facts (`getTaxFactsForChild`), invoice evidence | Orders, Payments, Compliance |
| **Suppliers / Supplier-team** | `seller`, `supplier`, `supplier_member`, permissions | seller type (KOLBE singleton), memberships/roles | Auth |
| **settlement-readiness (4.7.6)** | — (owns **no** tables, writes nothing) | read-only readiness projection for admins | Orders, Payments, Shipping, Compliance, Invoicing (owner read methods added in 4.7.6) |
| Audit | `audit_log` | evidence of decisions | — |

Owner read methods added in Phase 4.7.6 (no locks, no writes):
`OrdersService.getChildOrderEconomicContext`, `OrdersService.listChildOrderIdsForOrder`,
`PaymentsService.getChildSettlementFacts`, `InvoicingService.getTaxFactsForChild`
(Shipping already exposed `getAllocatedQuantitiesForChild` / `listShipmentsForChild`; Compliance already
exposed `getSupplierSettlementEligibility`).

## 2. Ownership in Phase 4.8 (frozen)

| Module | Owns | Must NOT own / do |
|--------|------|-------------------|
| **Settlement** (new) | `settlement_account`, `settlement_journal`, `settlement_posting`, `commission_policy` (+ per-child `commission_snapshot`), `settlement_hold_policy`, `shipping_economics_policy` snapshot per child, `withdrawal_request`, `payout`, `payout_provider_event`, `settlement_reconciliation_run` | any Payments/Orders/Shipping/Compliance table; must not read `financial_ledger_entry` as a balance; must not derive amounts from `wholesale_order.grand_total` or `commercial_invoice.grand_total`; must not accept client-provided seller identity or `isExternalSupplier` |
| **Payments** | as today + reversal/chargeback provider event types and a `payment_reversal` fact (never editing a verified payment) | supplier balances, payouts |
| **Orders** | as today (+ optional `shipping_charge_to_buyer` … columns if the decision log puts them on the child; otherwise on the proforma/policy snapshot) | settlement amounts |
| **Shipping** | as today; `ShippingChargeFinalized` derives from quote selection + proforma supersede | economic owner inference from physical responsibility (forbidden) |
| **Compliance** | eligibility rules, bank destination verification, holds | balances; duplication of money rules |
| **Finance orchestrator** | still **no tables**; coordinates settlement commands (record entitlement, accept withdrawal) across owners in one transaction where needed | storing state; duplicating KYB/bank/hold rules |
| **Invoicing** | tax treatment (after TAX_REVIEW), self-billing/settlement statements as documents | payout basis |

## 3. Boundary rules that Phase 4.8 tests must keep passing

- `module-boundaries.test.ts`: no module names a table it does not own in SQL/Drizzle; the settlement
  module reads facts through owner services only.
- `architecture-freeze.test.ts`: no dependency cycles; Compliance never depends on Orders/Payments/
  Offers/Catalog; Inventory/Catalog never depend on Orders.
- `phase-4-5-single-writer.test.ts`: only owner modules mutate protected wholesale tables.
- 4.7.6 additions: readiness payloads never expose balance fields; readiness reads write nothing.

## 4. Who identifies the external supplier

`purchase_order.supplier_id` (copied server-side from `seller.supplier_id` at order creation; `NULL`
⇒ Kolbe). Settlement must key accounts on `supplier_id`, never on a request body flag. The Kolbe child
produces **no** supplier payable and **no** commission posting.
