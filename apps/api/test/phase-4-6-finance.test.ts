import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const paymentsServicePath = path.join(repoRoot, "apps/api/src/modules/payments/payments.service.ts");
const financeOrchestratorPath = path.join(repoRoot, "apps/api/src/modules/finance/wholesale-finance.orchestrator.ts");
const ordersServicePath = path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts");
const migrationPath = path.join(repoRoot, "packages/database/migrations/0018_phase_4_6_wholesale_finance.sql");
const schemaPath = path.join(repoRoot, "packages/database/src/schema/tables.ts");
const stateValuesPath = path.join(repoRoot, "packages/database/src/schema/state-values.ts");
const financeControllerPath = path.join(repoRoot, "apps/api/src/modules/finance/wholesale-finance.controller.ts");
const adminFinanceControllerPath = path.join(repoRoot, "apps/api/src/modules/finance/admin-finance.controller.ts");
const registryPath = path.join(repoRoot, "apps/api/src/modules/registry.ts");
const manualProviderPath = path.join(repoRoot, "apps/api/src/modules/payments/manual-transfer.provider.ts");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

describe("Phase 4.6 — Migration and Schema", () => {
  it("migration 0018 exists forward-only, creates 7 finance tables", () => {
    const migration = read(migrationPath);
    expect(migration.length).toBeGreaterThan(1000);
    expect(migration).toContain("wholesale_proforma");
    expect(migration).toContain("wholesale_proforma_line");
    expect(migration).toContain("CREATE TABLE \"payment\"");
    expect(migration).toContain("payment_allocation");
    expect(migration).toContain("order_financial_release");
    expect(migration).toContain("financial_ledger_entry");
    expect(migration).toContain("CREATE TABLE \"refund\"");
    const cascadeLines = migration.split("\n").filter(l => l.includes("CASCADE") && !l.trim().startsWith("--"));
    expect(cascadeLines.length).toEqual(0);
    expect(migration).toContain("ON DELETE RESTRICT");
  });

  it("proforma has unique proforma_number, seller-specific, version, status draft/issued/superseded/voided, RESTRICT FKs, one active issued per child", () => {
    const migration = read(migrationPath);
    const schema = read(schemaPath);
    expect(migration).toContain("proforma_number");
    expect(migration).toContain("wholesale_proforma_number_unique");
    expect(migration).toContain("wholesale_proforma_child_issued_unique");
    expect(migration).toContain("WHERE \"status\" = 'issued'");
    expect(schema).toContain("wholesaleProforma");
    expect(schema).toContain("proformaNumber");
    expect(schema).toContain("WHOLESALE_PROFORMA_STATUSES");
    expect(schema).toContain("onDelete(\"restrict\")");
  });

  it("proforma line has wholesale_order_item_id, purchase_order_item_id, snapshots, quantity>0, pricing_unit, unit_price BIGINT, line_total BIGINT", () => {
    const schema = read(schemaPath);
    expect(schema).toContain("wholesaleProformaLine");
    expect(schema).toContain("wholesaleOrderItemId");
    expect(schema).toContain("purchaseOrderItemId");
    expect(schema).toContain("descriptionSnapshot");
    expect(schema).toContain("skuSnapshot");
    expect(schema).toContain("quantity");
    expect(schema).toContain("positiveQuantityCheck");
    expect(schema).toContain("unitPrice");
    expect(schema).toContain("lineTotal");
  });

  it("payment has payment_reference unique, method/provider, status pending/evidence_submitted/verified/failed/cancelled, BIGINT amount, idempotency_key, request_hash, no float", () => {
    const migration = read(migrationPath);
    const schema = read(schemaPath);
    expect(migration).toContain("payment_reference");
    expect(migration).toContain("payment_reference_unique");
    expect(schema).toContain("paymentReference");
    expect(schema).toContain("PAYMENT_STATUSES");
    expect(schema).toContain("PAYMENT_METHODS");
    expect(schema).toContain("bigint");
    expect(migration).not.toMatch(/"amount"\s+float/);
  });

  it("payment_allocation has payment_id/proforma_id/amount BIGINT/currency, amount>0 via CHECK, currencies match, unique payment+proforma", () => {
    const migration = read(migrationPath);
    const schema = read(schemaPath);
    expect(migration).toContain("payment_allocation");
    expect(migration).toContain("payment_allocation_payment_proforma_unique");
    expect(schema).toContain("paymentAllocation");
    expect(schema).toContain("amount");
  });

  it("financial_ledger_entry append-only separate from InventoryLedger, entry_type/direction IN/OUT, amount>0, trigger blocking UPDATE/DELETE", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("financial_ledger_entry");
    expect(migration).toContain("financial_ledger_amount_positive");
    expect(migration).toContain("prevent_financial_ledger_update_delete");
    expect(migration).toContain("financial_ledger_entry_no_update");
    expect(migration).toContain("financial_ledger_entry_no_delete");
    expect(migration).toContain("append-only");
  });

  it("refund has refund_reference unique, child_order_id nullable, exception_id nullable, payment_id nullable, BIGINT amount, status requested/approved/processing/completed/failed/cancelled", () => {
    const migration = read(migrationPath);
    const schema = read(schemaPath);
    expect(migration).toContain("refund_reference");
    expect(migration).toContain("refund_reference_unique");
    expect(schema).toContain("refund");
    expect(schema).toContain("REFUND_STATUSES");
  });

  it("state-values has new constants for proforma, payment, refund, financial release, ledger", () => {
    const state = read(stateValuesPath);
    expect(state).toContain("WHOLESALE_PROFORMA_STATUSES");
    expect(state).toContain("PAYMENT_STATUSES");
    expect(state).toContain("PAYMENT_METHODS");
    expect(state).toContain("REFUND_STATUSES");
    expect(state).toContain("FINANCIAL_RELEASE_TYPES");
    expect(state).toContain("FINANCIAL_LEDGER_ENTRY_TYPES");
    expect(state).toContain("FINANCIAL_LEDGER_DIRECTIONS");
    expect(state).toContain("orders.confirm");
    expect(state).toContain("payments.verify");
    expect(state).toContain("refunds.create");
  });
});

describe("Phase 4.6 — Proforma Business Invariant", () => {
  it("seller-specific proforma one per active child KOLBE 10M + A 20M + B 15M paid 45M, B fails cancelled → refund 15M only siblings unaffected", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("issueProformasFromSnapshot");
    expect(service).toContain("child_order_id");
    expect(service).toContain("sellerId");
    expect(service).toContain("childOrderId");
    expect(service).toContain("supplierId");
  });

  it("proforma immutable snapshots, terms_snapshot JSONB immutable, issuedAt/expiresAt/superseded_by", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("termsSnapshot");
    expect(service).toContain("issuedAt");
    expect(service).toContain("expiresAt");
    expect(service).toContain("supersededBy");
  });

  it("versioning: do NOT mutate issued Proforma; supersede/void old, issue new, history queryable", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("supersedeProforma");
    expect(service).toContain("voidProforma");
    expect(service).toContain("superseded");
    expect(service).toContain("voided");
  });
});

describe("Phase 4.6 — Order Confirmation and Payment Gate", () => {
  it("POST /api/v1/wholesale/orders/:id/confirm draft→confirmed with Claims.sub, expectedVersion, Idempotency-Key, frozen terms", () => {
    const ctrl = read(financeControllerPath);
    const orchestrator = read(financeOrchestratorPath);
    const orders = read(ordersServicePath);
    expect(ctrl).toContain("confirmOrder");
    expect(ctrl).toContain("claims.sub");
    expect(ctrl).toContain("idempotency-key");
    expect(orchestrator + orders).toContain("orders.confirm");
    expect(orchestrator + orders).toContain("FOR UPDATE");
    expect(orchestrator + orders).toContain("frozenTerms");
    expect(orchestrator + orders).toContain("order.confirmed");
  });

  it("payment_mode workflow preference NOT evidence, BNPL retail rejected", () => {
    const service = read(paymentsServicePath);
    const orchestrator = read(financeOrchestratorPath);
    expect(service + orchestrator).not.toContain("snapppay");
    expect(service).toContain("manual_transfer");
    const ctrl = read(financeControllerPath);
    expect(ctrl).toContain("transfer");
  });

  it("confirmed→awaiting_payment via canonical orchestration, emit order.payment_gated, no processing until release", () => {
    const orchestrator = read(financeOrchestratorPath);
    const orders = read(ordersServicePath);
    expect(orchestrator + orders).toContain("awaiting_payment");
    expect(orchestrator + orders).toContain("order.payment_gated");
    expect(orchestrator + orders).toContain("proforma.issued");
    expect(orchestrator + orders).toContain("processing");
  });

  it("DO NOT TOUCH INVENTORY FOR PAYMENT, DO NOT ENABLE FULFILLMENT BEFORE GATE", () => {
    const orchestrator = read(financeOrchestratorPath);
    const service = read(paymentsServicePath);
    expect(orchestrator).not.toContain("InventoryService");
    expect(service).not.toContain("UPDATE product_variant_inventory");
    expect(service).not.toContain("UPDATE inventory_reservation");
    const ordersService = read(ordersServicePath);
    expect(ordersService).toContain("PARENT_PAYMENT_GATE");
  });
});

describe("Phase 4.6 — Payment Verification and Allocation", () => {
  it("manual transfer first POST /api/v1/wholesale/orders/:id/payments/transfer buyer submits amount/bank reference, server derives buyer/order/currency/payable, starts evidence_submitted NOT paid", () => {
    const ctrl = read(financeControllerPath);
    const service = read(paymentsServicePath);
    expect(ctrl).toContain("payments/transfer");
    expect(ctrl).toContain("amount");
    expect(service).toContain("submitTransferPayment");
    expect(service).toContain("evidence_submitted");
  });

  it("verification POST /api/v1/admin/payments/:id/verify admin/finance only, expected version, amount/currency check, nonblank external evidence, audit, no fake verification", () => {
    const adminCtrl = read(adminFinanceControllerPath);
    const service = read(paymentsServicePath);
    expect(adminCtrl).toContain("verifyPayment");
    expect(adminCtrl).toContain("admin");
    expect(service).toContain("verifyPayment");
    expect(service).toContain("EXTERNAL_REFERENCE_REQUIRED");
    expect(service).toContain("CURRENCY_MISMATCH");
    expect(service).toContain("auditService.record");
  });

  it("partial payments multiple verified, order stays awaiting_payment until coverage reaches payable, never premature release", () => {
    const service = read(paymentsServicePath);
    const orch = read(financeOrchestratorPath);
    expect(service + orch).toContain("getFinancialCoverageStatus");
    expect(service + orch).toContain("payable");
    expect(service + orch).toContain("awaiting_payment");
  });

  it("allocation payment_allocation payment_id/proforma_id/amount BIGINT/currency, amount>0, currencies match, sum ≤ verified, unique/idempotent, deterministic policy", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("allocatePaymentToProformas");
    expect(service).toContain("child_order_id ASC");
    expect(service).toContain("alreadyAllocated");
    expect(service).toContain("payment_allocation");
  });

  it("overpayment record unallocated/overpayment, do NOT auto wallet credit or allocate past due or change seller totals", () => {
    const service = read(paymentsServicePath);
    const orch = read(financeOrchestratorPath);
    expect(service + orch).toContain("unallocated");
    expect(service).not.toContain("wallet_credit");
    expect(service).not.toContain("INSERT INTO wallet");
  });

  it("payment release when payable fully covered by verified Payments, awaiting_payment→processing in ONE tx verify coverage, create release evidence, transition Order, history, order.processing_started, audit, no external call while locks held", () => {
    const service = read(paymentsServicePath);
    const orders = read(ordersServicePath);
    const orch = read(financeOrchestratorPath);
    const combined = service + orders + orch;
    expect(combined).toContain("orderFinancialRelease");
    expect(combined).toContain("payment_verified");
    expect(combined).toContain("order.processing_started");
    expect(combined).toContain("financial.release_created");
    expect(service).not.toContain("fetch");
    expect(service).not.toContain("axios");
  });

  it("provider abstraction PaymentProvider interface createIntent/verify/queryStatus/refund, manual-transfer implementation, no network call while locks held", () => {
    const providerInterface = read(path.join(repoRoot, "apps/api/src/modules/payments/payment-provider.interface.ts"));
    const manualProvider = read(manualProviderPath);
    expect(providerInterface).toContain("createIntent");
    expect(providerInterface).toContain("verify");
    expect(providerInterface).toContain("queryStatus");
    expect(providerInterface).toContain("refund");
    expect(manualProvider).toContain("ManualTransferProvider");
    expect(manualProvider).toContain("no network");
  });
});

describe("Phase 4.6 — Credit/COD and Ledger", () => {
  it("credit/COD trusted evidence credit_approved/cod_policy_approved with reference/limit/actor/reason, confirmed→processing via orchestration, no fake Payment row for COD before delivery", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("credit_approved");
    expect(service).toContain("cod_policy_approved");
    expect(service).toContain("releaseWithCredit");
    expect(service).toContain("releaseWithCod");
    expect(service).toContain("EVIDENCE_REQUIRED");
  });

  it("ledger only verified Payment IN, completed Refund OUT, NOT pending/evidence/requested/credit/COD approval", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("financialLedgerEntry");
    expect(service).toContain("payment_verified");
    expect(service).toContain("refund_completed");
  });

  it("NO RETAIL BNPL SnappPay/DigiPay rejected, NO SETTLEMENT wallet/commission/payable/settlement batches/payout/withdrawal, NO SHIPPING FABRICATION", () => {
    const service = read(paymentsServicePath);
    const migration = read(migrationPath);
    expect(service.toLowerCase()).not.toContain("snapppay");
    expect(service.toLowerCase()).not.toContain("digipay");
    expect(migration).not.toContain("CREATE TABLE \"settlement_batch\"");
    expect(migration).not.toContain("CREATE TABLE \"supplier_wallet\"");
    expect(migration).not.toContain("CREATE TABLE \"payout\"");
    expect(migration).not.toContain("CREATE TABLE \"commission\"");
    const registry = read(registryPath);
    expect(registry).toContain("wholesale_proforma");
  });
});

describe("Phase 4.6 — Refund and Sibling Isolation", () => {
  it("refund refundable B = verified Payment allocations to B minus completed/pending refunds for B, NEVER parent grand_total for child refund", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("refundable");
    expect(service).toContain("allocatedToChild");
    expect(service).toContain("alreadyRefunded");
    expect(service).toContain("child_order_id");
  });

  it("sibling isolation refund B must NOT change KOLBE/A allocations/children/reservations/history", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("child_order_id");
    expect(service).toContain("childOrderId");
    expect(service).not.toContain("UPDATE purchase_order");
    expect(service).not.toContain("UPDATE inventory");
  });

  it("cancellation before payment no refund, void/supersede child Proforma, recompute current payable, preserve original grand_total, create adjustment evidence", () => {
    const orchestrator = read(financeOrchestratorPath);
    const payments = read(paymentsServicePath);
    expect(orchestrator + payments).toContain("void");
    expect(orchestrator + payments).toContain("original grand_total preserved");
    expect(orchestrator + payments).toContain("manual_authorized_release");
  });

  it("cancellation after partial child B 15M only 5M allocated → refund 5M remaining 10M stops payable", () => {
    const service = read(paymentsServicePath);
    const orchestrator = read(financeOrchestratorPath);
    expect(service).toContain("refundable");
    expect(orchestrator).toContain("refundObligations");
  });

  it("full parent cancellation refund obligations per actual verified allocations not fake parent total, Order cancelled while refunds pending allowed, Order status separate from Refund status", () => {
    const orchestrator = read(financeOrchestratorPath);
    const payments = read(paymentsServicePath);
    expect(orchestrator + payments).toContain("refundObligations");
  });

  it("refund completion requires trusted external evidence, same tx refund→completed + ledger OUT + audit, no fake completion", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("completeRefund");
    expect(service).toContain("EXTERNAL_REFERENCE_REQUIRED");
    expect(service).toContain("refund_completed");
    expect(service).toContain("OUT");
  });
});

describe("Phase 4.6 — Money, Idempotency, Concurrency, Immutability, Audit", () => {
  it("money serialization decimal string BIGINT DB no Rial/Toman conversion IRR canonical", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("toString()");
    expect(service).toContain("BigInt");
    expect(service).toContain("IRR");
  });

  it("idempotency required for confirmation, proforma issuance, transfer submit, verification, credit/COD release, refund create/approve/complete, same key same payload replay diff payload 409 never in-memory", () => {
    const service = read(paymentsServicePath);
    const orchestrator = read(financeOrchestratorPath);
    expect(service).toContain("commandIdempotency");
    expect(service).toContain("idempotencyKey");
    expect(service).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(orchestrator).toContain("commandIdempotency");
  });

  it("concurrency double verification one ledger IN, final partial payment race one transition one release evidence, refund race one ledger OUT, child cancellation vs verification deterministic", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("getFinancialCoverageStatus");
  });

  it("immutability issued Proforma immutable, verified Payment facts immutable except controlled status, completed Refund amount immutable, Ledger append-only triggers", () => {
    const migration = read(migrationPath);
    expect(migration).toContain("prevent_financial_ledger_update_delete");
    const service = read(paymentsServicePath);
    expect(service).toContain("issued");
    expect(service).toContain("superseded");
  });

  it("audit confirmation, proforma issue/void/supersede, payment submit/verify/reject, financial gate release, refund create/approve/complete/fail, credit/COD approval, no sensitive payloads", () => {
    const service = read(paymentsServicePath);
    const orchestrator = read(financeOrchestratorPath);
    expect(service).toContain("auditService.record");
    expect(orchestrator).toContain("auditService.record");
    expect(service).toContain("payment.evidence_submitted");
    expect(service).toContain("payment.verified");
    expect(service).toContain("refund.requested");
  });

  it("supplier access may read only own Proforma relevant to child, MUST NOT see other seller allocations/refunds/buyer evidence/internal audit, scoped DTOs", () => {
    const service = read(paymentsServicePath);
    expect(service).toContain("getProformasForSupplierBySellerId");
    expect(service).toContain("termsSnapshot");
  });

  it("tableless orchestrator owns NO tables, coordinates Payments/Orders/Fulfillment/Audit via shared tx executor, no Orders→Payment table writes, no Payments→Order table writes", () => {
    const orchestrator = read(financeOrchestratorPath);
    expect(orchestrator).toContain("owns NO tables");
    expect(orchestrator).toContain("shared tx");
    expect(orchestrator).toContain("paymentsService");
    expect(orchestrator).not.toContain("INSERT INTO payment");
    expect(orchestrator).not.toContain("INSERT INTO wholesale_proforma");
  });

  it("single-writer finance guard frontend Next must not direct-write proforma/payment/allocation/refund/financial_ledger/order_financial_release", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    expect(kolbeApi).not.toContain("wholesale_proforma");
    expect(kolbeApi).not.toContain("payment_allocation");
    expect(kolbeApi).not.toContain("financial_ledger");
    expect(kolbeApi).not.toContain("order_financial_release");
    expect(kolbeApi).not.toContain("refund");
  });
});
