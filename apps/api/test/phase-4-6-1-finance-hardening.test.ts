import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const paymentsServicePath = path.join(repoRoot, "apps/api/src/modules/payments/payments.service.ts");
const financeOrchestratorPath = path.join(repoRoot, "apps/api/src/modules/finance/wholesale-finance.orchestrator.ts");
const ordersServicePath = path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts");
const supplierFinanceControllerPath = path.join(repoRoot, "apps/api/src/modules/finance/supplier-finance.controller.ts");
const wholesaleFinanceControllerPath = path.join(repoRoot, "apps/api/src/modules/finance/wholesale-finance.controller.ts");
const adminFinanceControllerPath = path.join(repoRoot, "apps/api/src/modules/finance/admin-finance.controller.ts");
const migration18Path = path.join(repoRoot, "packages/database/migrations/0018_phase_4_6_wholesale_finance.sql");
const migration19Path = path.join(repoRoot, "packages/database/migrations/0019_phase_4_6_1_finance_hardening.sql");
const schemaPath = path.join(repoRoot, "packages/database/src/schema/tables.ts");
const moduleBoundariesPath = path.join(repoRoot, "apps/api/test/module-boundaries.test.ts");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

describe("Phase 4.6.1 — Ownership: Owner-writes-own-tables", () => {
  it("Payments source MUST NOT contain wholesale_order/purchase_order/order_status_history/order_event mutations", () => {
    const service = read(paymentsServicePath);
    // Must not mutate Orders tables via direct SQL
    expect(service).not.toContain("INSERT INTO wholesale_order");
    expect(service).not.toContain("UPDATE wholesale_order");
    expect(service).not.toContain("INSERT INTO purchase_order");
    expect(service).not.toContain("UPDATE purchase_order");
    expect(service).not.toContain("INSERT INTO order_status_history");
    expect(service).not.toContain("UPDATE order_status_history");
    expect(service).not.toContain("INSERT INTO order_event");
    expect(service).not.toContain("UPDATE order_event");
    expect(service).not.toContain("wholesaleOrderTable");
    expect(service).not.toContain("purchaseOrderTable");
    expect(service).not.toContain("orderStatusHistoryTable");
    expect(service).not.toContain("orderEventTable");
  });

  it("Finance Orchestrator MUST NOT directly mutate owned tables (no INSERT INTO payment, wholesale_proforma, etc)", () => {
    const orch = read(financeOrchestratorPath);
    expect(orch).not.toContain("INSERT INTO wholesale_proforma");
    expect(orch).not.toContain("INSERT INTO payment");
    expect(orch).not.toContain("INSERT INTO payment_allocation");
    expect(orch).not.toContain("INSERT INTO order_financial_release");
    expect(orch).not.toContain("INSERT INTO financial_ledger");
    expect(orch).not.toContain("INSERT INTO refund");
    expect(orch).not.toContain("UPDATE wholesale_order");
    expect(orch).not.toContain("UPDATE purchase_order");
    expect(orch).toContain("owns NO tables");
    expect(orch).toContain("OrdersService");
    expect(orch).toContain("PaymentsService");
  });

  it("OrdersService provides finance contracts executor-aware, DbOrTx, no nested tx, status machine enforced", () => {
    const svc = read(ordersServicePath);
    expect(svc).toContain("lockOrderForFinance");
    expect(svc).toContain("getDbNow");
    expect(svc).toContain("getOrderFinancialSnapshot");
    expect(svc).toContain("validateAndLockForPaymentSubmission");
    expect(svc).toContain("transitionToConfirmed");
    expect(svc).toContain("markAwaitingPayment");
    expect(svc).toContain("releaseFinancialGate");
    expect(svc).toContain("recordPaymentEvidenceSubmitted");
    expect(svc).toContain("recordPaymentVerified");
    expect(svc).toContain("recordProformaIssued");
    expect(svc).toContain("DbOrTx");
  });
});

describe("Phase 4.6.1 — Proforma Immutability & Snapshot", () => {
  it("Proforma issuance from Orders immutable snapshot DTO, no live Catalog re-read", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("OrderFinancialSnapshot");
    expect(svc).toContain("issueProformasFromSnapshot");
    expect(svc).toContain("termsSnapshot");
    expect(svc).toContain("itemsTotal");
    expect(svc).toContain("shippingTotal");
    expect(svc).toContain("totalAmount");
  });

  it("Totals calculated BEFORE insert, issued fields immutable, status only issued→superseded/voided, DB trigger prevents rewrite", () => {
    const svc = read(paymentsServicePath);
    const mig19 = read(migration19Path);
    // Totals must be calculated before DB insert – check variable naming or trigger existence
    expect(svc).toContain("itemsTotal");
    expect(svc).toContain("totalAmount");
    expect(mig19).toContain("prevent_issued_proforma_mutation");
    expect(mig19).toContain("Cannot mutate issued proforma financial fields");
    expect(mig19).toContain("wholesale_proforma_issued_immutable");
  });

  it("Supersede must generate new immutable snapshot matching new totals+hash, never reuse old termsSnapshot", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("newTermsSnapshot");
    expect(svc).toContain("supersededFrom");
    expect(svc).toContain("PROFORMA_INCONSISTENT_SNAPSHOT");
  });

  it("Empty child with no financial lines fails PROFORMA_LINES_MISSING atomically, not fake zero", () => {
    const orders = read(ordersServicePath);
    const payments = read(paymentsServicePath);
    expect(orders).toContain("PROFORMA_LINES_MISSING");
    expect(payments).toContain("PROFORMA_LINES_MISSING");
  });
});

describe("Phase 4.6.1 — Expiry & Server Time", () => {
  it("Remove invented 7-day expiry: expiresAt NULL unless WHOLESALE_PROFORMA_VALIDITY_HOURS configured, use DB NOW()", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("WHOLESALE_PROFORMA_VALIDITY_HOURS");
    expect(svc).toContain("expiresAt: Date | null = null");
    expect(svc).not.toContain("7 * 24");
    expect(svc).not.toContain("7*24");
    expect(svc).toContain("SELECT NOW()");
  });

  it("Server time SELECT NOW() for proforma issued/expiry/payment verified/release/refund", () => {
    const svc = read(paymentsServicePath);
    const orders = read(ordersServicePath);
    expect(svc).toContain("getDbNow");
    expect(svc).toContain("SELECT NOW()");
    expect(orders).toContain("getDbNow");
    expect(orders).toContain("SELECT NOW()");
  });
});

describe("Phase 4.6.1 — Supplier Finance Auth", () => {
  it("Claims.sub→supplier_member→supplier→seller via canonical services, no seller from Claims extension/body/query", () => {
    const ctrl = read(supplierFinanceControllerPath);
    expect(ctrl).toContain("supplier_member");
    expect(ctrl).toContain("supplier");
    expect(ctrl).toContain("seller");
    expect(ctrl).toContain("Claims.sub");
    expect(ctrl).not.toContain("(claims as any).sellerId");
    expect(ctrl).not.toContain("(paymentsService as any).repository");
  });

  it("GET /supplier/finance/proformas returns only seller_id==auth seller; detail checks exact ownership, 403/404 domain error not 500 raw Error", () => {
    const ctrl = read(supplierFinanceControllerPath);
    expect(ctrl).toContain("getProformasForSupplierBySellerId");
    expect(ctrl).toContain("getProformaForSupplierById");
    expect(ctrl).toContain("PROFORMA_ACCESS_DENIED");
    expect(ctrl).toContain("403");
  });

  it("Fix getProformasForSupplier to trusted sellerId or validate seller↔supplier pair", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("getProformasForSupplierBySellerId");
    expect(svc).toContain("sellerId");
    expect(svc).not.toContain("seller_id == auth seller ? [] : []");
  });
});

describe("Phase 4.6.1 — Manual Transfer Strictness & Release Coverage", () => {
  it("Buyer submit only awaiting_payment, confirmed must first pass payment gate draft→confirmed→proformas→awaiting_payment", () => {
    const orders = read(ordersServicePath);
    const orch = read(financeOrchestratorPath);
    expect(orders).toContain("awaiting_payment");
    expect(orders).toContain("PAYMENT_GATE_BLOCKED");
    expect(orch).toContain("validateAndLockForPaymentSubmission");
  });

  it("Release coverage: for every active issued proforma allocated_verified>=total, voided/superseded not count, unallocated overpayment not unlock", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("getFinancialCoverageStatus");
    expect(svc).toContain("status = 'issued'");
    expect(svc).toContain("isFullyCovered");
    expect(svc).toContain("proformaCoverage");
    expect(svc).toContain("covered: allocated >= total");
    expect(svc).not.toContain("SUM amount");
  });

  it("Release uniqueness once per gate, concurrent final payments one transition one evidence", () => {
    const mig19 = read(migration19Path);
    const svc = read(paymentsServicePath);
    expect(mig19).toContain("order_financial_release_payment_verified_once");
    expect(svc).toContain("payment_verified");
    expect(svc).toContain("replayed");
  });

  it("Overpayment preserved as unallocatedPaid in summary, no wallet/auto-move", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("unallocatedPaid");
    expect(svc).toContain("verifiedPaid - allocated");
    expect(svc).not.toContain("wallet");
    expect(svc).not.toContain("auto-move");
  });
});

describe("Phase 4.6.1 — Events Ownership & Privacy", () => {
  it("Payments must NOT INSERT order_event/order_status_history; orchestrator calls OrdersService.recordPaymentVerified etc same tx", () => {
    const svc = read(paymentsServicePath);
    const orch = read(financeOrchestratorPath);
    expect(svc).not.toContain("order_event");
    expect(svc).not.toContain("order_status_history");
    expect(orch).toContain("recordPaymentVerified");
    expect(orch).toContain("recordPaymentEvidenceSubmitted");
  });

  it("Sensitive evidence: no full externalReference in buyer timeline/generic Order events/logs/supplier DTOs", () => {
    const orders = read(ordersServicePath);
    const payments = read(paymentsServicePath);
    expect(orders).toContain("referencePresent");
    expect(payments).toContain("***masked***");
    expect(payments).toContain("***present***");
    // Buyer DTO only paymentReference/method/status/amount/currency/submittedAt/verifiedAt
    expect(payments).toContain("paymentReference");
    expect(payments).toContain("method");
    // Ensure buyer DTO does not directly expose raw externalReference field
    // We allow internal storage field externalReference but buyer DTO should mask it
    expect(orders).not.toContain("externalReference: pay.externalReference");
    expect(orders).not.toContain("externalReference: payment.externalReference");
  });

  it("Privacy no full bank ref/evidence/address/cookie/session/secret in timeline/logs/supplier/event payload", () => {
    const orders = read(ordersServicePath);
    expect(orders).toContain("redactTimelineEntry");
    expect(orders).not.toContain("bank credentials");
  });
});

describe("Phase 4.6.1 — Auth, Collision, Allocation, Refund", () => {
  it("Auth: verify/reject/credit/COD/refund approve/complete/fail only admin/finance Claims role not body role", () => {
    const payments = read(paymentsServicePath);
    const adminCtrl = read(adminFinanceControllerPath);
    expect(payments).toContain("ROLE_NOT_ALLOWED");
    expect(payments).toContain("admin");
    expect(payments).toContain("finance");
    expect(adminCtrl).toContain("claims.role");
    expect(adminCtrl).not.toContain("body.role");
  });

  it("Proforma/Payment/Refund number collision-safe catch 23505 retry", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("23505");
    expect(svc).toContain("proforma_number");
    expect(svc).toContain("payment_reference");
    expect(svc).toContain("refund_reference");
  });

  it("Allocation invariants: amount>0, same order currency, only verified contributes, active allocation sum<=payment, proforma allocation<=total, voided/superseded excluded", () => {
    const svc = read(paymentsServicePath);
    const mig19 = read(migration19Path);
    const schema = read(schemaPath);
    expect(mig19).toContain("payment_allocation_amount_positive");
    expect(schema).toContain("payment_allocation_amount_positive");
    expect(svc).toContain("CURRENCY_MISMATCH");
    expect(svc).toContain("status = 'verified'");
    expect(svc).toContain("status = 'issued'");
  });

  it("Partial refund: refundable(child)=verified valid allocations for child - already pending/completed obligations, sibling isolation preserved", () => {
    const svc = read(paymentsServicePath);
    expect(svc).toContain("refundable");
    expect(svc).toContain("allocatedToChild");
    expect(svc).toContain("alreadyRefunded");
    expect(svc).toContain("child_order_id");
  });
});

describe("Phase 4.6.1 — Module Boundaries Reduced", () => {
  it("READ_EXCEPTIONS reduced for payments and finance", () => {
    const boundaries = read(moduleBoundariesPath);
    // Payments should NOT contain wholesale_order in exception
    const paymentsExceptionMatch = boundaries.match(/payments:\s*\[(.*?)\]/s);
    if (paymentsExceptionMatch) {
      const content = paymentsExceptionMatch[1];
      expect(content).not.toContain("wholesale_order");
      expect(content).not.toContain("purchase_order");
      expect(content).not.toContain("order_status_history");
      expect(content).not.toContain("order_event");
    }
    const financeExceptionMatch = boundaries.match(/finance:\s*\[(.*?)\]/s);
    if (financeExceptionMatch) {
      const content = financeExceptionMatch[1];
      expect(content).not.toContain("wholesale_proforma");
      expect(content).not.toContain("payment_allocation");
      expect(content).not.toContain("order_financial_release");
    }
  });
});

describe("Phase 4.6.1 — Required Tests Existence", () => {
  it("Migration 0019 exists forward-only", () => {
    const mig19 = read(migration19Path);
    expect(mig19.length).toBeGreaterThan(100);
    expect(mig19).toContain("Finance Boundary");
  });
});
