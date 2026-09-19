/**
 * Phase 4.8 — Checkpoint C Test Suite: Withdrawal Requests, Ledger Reservation,
 * Payout Engine (TxA -> Provider -> TxB), Fake & Manual Providers,
 * Crash Recovery, IDOR Protection, and HTTP API Contracts.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  supplierA,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import {
  createMixedOrder,
  deliverPieces,
  payByWebhook,
  prepareChild,
  sellerARef,
} from "./helpers/phase-4-7-6.harness";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { FakePayoutProvider } from "../src/modules/settlement/providers/fake-payout.provider";
import { SettlementDomainError } from "../src/modules/settlement/settlement.errors";

const TEST_DB = "kolbe_phase_4_8_payouts_test";

let h: Harness;
let ctx: SupplierContext;
let settlement: SettlementService;
let fakeProvider: FakePayoutProvider;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

function testIban(bban22: string): string {
  const numeric = `${bban22}1827` + "00";
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, "0");
  return `IR${check}${bban22}`;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 5_000_000n, priceB: 8_000_000n, onHand: 500 });
  settlement = h.app.get(SettlementService);
  fakeProvider = h.app.get(FakePayoutProvider);

  // پیکربندی پیش‌نیازهای انطباق برای تامین‌کننده A: پروفایل KYB، امضای قرارداد و تایید شبا بانکی
  const { SupplierComplianceService } = await import("../src/modules/compliance/supplier-compliance.service");
  const compliance = h.app.get(SupplierComplianceService);

  await compliance.upsertProfile({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    legalName: "شرکت تامین پیشرو الف",
    entityType: "company",
    representativeName: "علی رضایی",
    registrationNumber: "1234567890",
    nationalId: "10101010101",
  });
  await compliance.submitProfile({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA);
  await compliance.reviewProfile({ userId: ctx.userAdmin, role: "admin" }, ctx.supA, {
    decision: "approved",
    representativeAuthorityVerified: true,
  });

  const { ComplianceService } = await import("../src/modules/compliance/compliance.service");
  const compService = h.app.get(ComplianceService);
  const draft = await compService.createPolicyDraft({ userId: ctx.userAdmin, role: "admin" }, {
    policyType: "SUPPLIER_AGREEMENT",
    scope: "SUPPLIER",
    title: "Supplier Agreement",
    contentText: "agreement v1",
  });
  const agreementDoc = await compService.publishPolicy({ userId: ctx.userAdmin, role: "admin" }, draft.id);

  await compliance.acceptSupplierAgreement({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    policyDocumentId: agreementDoc.id,
  });

  const validIban = testIban("0620170000001234567890");
  const bank = await compliance.submitBankDestination({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    destinationKind: "iban",
    value: validIban,
    holderName: "شرکت تامین پیشرو الف",
  });
  await compliance.reviewBankDestination({ userId: ctx.userAdmin, role: "admin" }, bank.verification.id, {
    status: "verified",
    holderMatchStatus: "matched",
    verificationSource: "BANK_INQUIRY_MOCK",
  });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.8 — Checkpoint C: Withdrawal, Payout & Provider Engine", () => {
  let earnedOrderId: string;
  let earnedChildId: string;

  it("C1: Seed supplier earnings and release to available payable", async () => {
    // 1. ایجاد سفارش با ۲ قلم کالا برای تامین‌کننده A (۱۰,۰۰۰,۰۰۰ ریال)
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 2 },
    ]);
    earnedOrderId = order.id;
    const childA = childFor(ctx.sellerA)!;
    earnedChildId = childA.id;

    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 2, supplierA(ctx));

    await settlement.processChildEarnings(childA.id);

    // ایجاد سیاست مسدودی ۰ روزه جهت آزادسازی
    await settlement.createHoldPolicy({
      policyVersion: 20,
      name: "Immediate Hold Policy",
      holdDurationDays: 0,
    });

    await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supA,
      dryRun: false,
      idempotencyKey: makeId("idem_batch_c1"),
      executedBy: ctx.userAdmin,
    });

    const summary = await settlement.getSupplierSummary(ctx.supA);
    expect(BigInt(summary.availableForSettlement)).toBeGreaterThanOrEqual(10_000_000n);
  });

  it("C2: Withdrawal request creation and ledger-based reservation", async () => {
    const summaryBefore = await settlement.getSupplierSummary(ctx.supA);
    const availableBefore = BigInt(summaryBefore.availableBefore ?? summaryBefore.availableForSettlement);

    // 1. ثبت درخواست برداشت ۴,۰۰۰,۰۰۰ ریال
    const idemKey = makeId("idem_with_1");
    const withdrawal = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: 4_000_000n,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: idemKey,
    });

    expect(withdrawal.status).toBe("approved");
    expect(withdrawal.amount).toBe("4000000");
    expect(withdrawal.bankDestinationSnapshot.maskedValue).toBeDefined();

    // بررسی تغییر مانده در دفتر معین:
    // موجودی در دسترس ۴,۰۰۰,۰۰۰ ریال کاهش و مبلغ در حال تسویه ۴,۰۰۰,۰۰۰ ریال افزایش یافته است
    const summaryAfter = await settlement.getSupplierSummary(ctx.supA);
    expect(BigInt(summaryAfter.availableForSettlement)).toBe(availableBefore - 4_000_000n);
    expect(summaryAfter.settlementPending).toBe("4000000");

    // 2. تکرار درخواست با همان IdempotencyKey باید همان رکورد را بدون رزرو مجدد بازگرداند
    const replayed = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: 4_000_000n,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: idemKey,
    });
    expect(replayed.id).toBe(withdrawal.id);

    const summaryReplayed = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryReplayed.settlementPending).toBe("4000000");

    // 3. درخواست برداشت بیش از مانده در دسترس باید رد شود
    await expect(
      settlement.createWithdrawalRequest({
        supplierId: ctx.supA,
        amount: 100_000_000n,
        requestedByUserId: ctx.userAOwner,
        idempotencyKey: makeId("idem_with_excess"),
      }),
    ).rejects.toThrowError(SettlementDomainError);
  });

  it("C3: Payout execution — Fake provider success (TxA -> Provider outside lock -> TxB)", async () => {
    // ایجاد یک درخواست برداشت جدید ۲,۰۰۰,۰۰۰ ریالی
    const withdrawal = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: 2_000_000n,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: makeId("idem_with_c3"),
    });

    const summaryBefore = await settlement.getSupplierSummary(ctx.supA);
    const pendingPayoutBefore = BigInt(summaryBefore.settlementPending);

    // اجرای تسویه با Fake Provider
    fakeProvider.setScenario(withdrawal.id, "success");
    const payout = await settlement.executePayout({
      withdrawalRequestId: withdrawal.id,
      provider: "fake",
      initiatedBy: ctx.userAdmin,
      idempotencyKey: makeId("idem_pout_c3"),
    });

    expect(payout.status).toBe("succeeded");
    expect(payout.amount).toBe("2000000");
    expect(payout.providerReference).toMatch(/^FAKE-PO-/);

    // بررسی مانده: ۲,۰۰۰,۰۰۰ ریال از در حال تسویه کسر و به تسویه‌شده (settledAmount) منتقل شد
    const summaryAfter = await settlement.getSupplierSummary(ctx.supA);
    expect(BigInt(summaryAfter.settlementPending)).toBe(pendingPayoutBefore - 2_000_000n);
    expect(summaryAfter.settledAmount).toBe("2000000");

    // بررسی تبدیل وضعیت درخواست برداشت به converted_to_payout
    const updatedW = await settlement.getWithdrawalRequestById(withdrawal.id);
    expect(updatedW.status).toBe("converted_to_payout");
  });

  it("C4: Fake provider must fail closed in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const withdrawal = await settlement.createWithdrawalRequest({
        supplierId: ctx.supA,
        amount: 1_000_000n,
        requestedByUserId: ctx.userAOwner,
        idempotencyKey: makeId("idem_prod_fake"),
      });

      await expect(
        settlement.executePayout({
          withdrawalRequestId: withdrawal.id,
          provider: "fake",
          initiatedBy: ctx.userAdmin,
          idempotencyKey: makeId("idem_pout_prod"),
        }),
      ).rejects.toMatchObject({
        code: "FAKE_PAYOUT_PROVIDER_FORBIDDEN_IN_PRODUCTION",
      });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("C5: Payout failure returns funds to available balance (PAYOUT_REVERSED)", async () => {
    const summaryBefore = await settlement.getSupplierSummary(ctx.supA);
    const availableBefore = BigInt(summaryBefore.availableForSettlement);

    // درخواست برداشت ۱,۵۰۰,۰۰۰ ریال
    const withdrawal = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: 1_500_000n,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: makeId("idem_with_fail"),
    });

    // تنظیم درگاه تستی به وضعیت failure
    fakeProvider.setDefaultScenario("failure");

    const payout = await settlement.executePayout({
      withdrawalRequestId: withdrawal.id,
      provider: "fake",
      initiatedBy: ctx.userAdmin,
      idempotencyKey: makeId("idem_pout_fail"),
    });

    expect(payout.status).toBe("failed");
    expect(payout.errorMessage).toBeDefined();

    // وجوه به مانده در دسترس بازگشته است
    const summaryAfter = await settlement.getSupplierSummary(ctx.supA);
    expect(BigInt(summaryAfter.availableForSettlement)).toBe(availableBefore);

    fakeProvider.setDefaultScenario("success");
  });

  it("C6: Manual payout provider requires real external evidence (no dummy data)", async () => {
    const withdrawal = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: 1_000_000n,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: makeId("idem_with_manual"),
    });

    // 1. ارسال با شواهد نامعتبر (داده‌های صوری و خالی)
    await expect(
      settlement.executePayout({
        withdrawalRequestId: withdrawal.id,
        provider: "manual",
        manualEvidence: {
          referenceNumber: "123", // کمتر از ۴ حرف و صوری
          bankTrackingCode: "test", // صوری
          transferredAt: new Date().toISOString(),
          statementId: "",
        },
        initiatedBy: ctx.userAdmin,
        idempotencyKey: makeId("idem_pout_man_bad"),
      }),
    ).rejects.toMatchObject({
      code: "MANUAL_PAYOUT_EVIDENCE_INVALID",
    });

    // 2. ارسال با تاریخ در آینده
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await expect(
      settlement.executePayout({
        withdrawalRequestId: withdrawal.id,
        provider: "manual",
        manualEvidence: {
          referenceNumber: "REF-2026-998811",
          bankTrackingCode: "TRK-BME-991283",
          transferredAt: futureDate,
          statementId: "STMT-2026-09",
        },
        initiatedBy: ctx.userAdmin,
        idempotencyKey: makeId("idem_pout_man_fut"),
      }),
    ).rejects.toMatchObject({
      code: "MANUAL_PAYOUT_EVIDENCE_INVALID",
    });

    // 3. ارسال با شواهد واقعی و معتبر
    const validPayout = await settlement.executePayout({
      withdrawalRequestId: withdrawal.id,
      provider: "manual",
      manualEvidence: {
        referenceNumber: "REF-2026-881923",
        bankTrackingCode: "TRK-MELLAT-88192348",
        transferredAt: new Date().toISOString(),
        statementId: "STMT-2026-09-19",
        transferSlipUrl: "https://secure.kolbe.ir/documents/slips/slip_88192348.pdf",
      },
      initiatedBy: ctx.userAdmin,
      idempotencyKey: makeId("idem_pout_man_ok"),
    });

    expect(validPayout.status).toBe("succeeded");
    expect(validPayout.providerReference).toBe("TRK-MELLAT-88192348");
  });

  it("C7: Payout and Settlement Reconciliations", async () => {
    // اجرای تطبیق تراز تسویه
    const projRec = await settlement.reconcileSettlementProjection(ctx.supA, ctx.userAdmin);
    expect(projRec.status).toBe("completed");
    expect(projRec.discrepancyCount).toBe(0);

    // اجرای تطبیق وضعیت تسویه‌های معلق
    const payoutRec = await settlement.reconcileProcessingPayouts({
      maxAgeMinutes: 0,
      triggeredBy: ctx.userAdmin,
    });
    expect(payoutRec.runId).toBeDefined();
  });

  it("C8: HTTP Surface & IDOR / Role-Based Access Boundaries", async () => {
    const ownerToken = cookie(ctx.userAOwner, "supplier");
    const salesToken = cookie(ctx.userASales, "supplier");
    const intruderToken = cookie(ctx.userBOwner, "supplier");
    const adminToken = cookie(ctx.userAdmin, "admin");

    // 1. کاربر بدون کلید عطف در متد POST خطا می‌گیرد (IDEMPOTENCY_KEY_REQUIRED)
    const noIdem = await api()
      .post("/api/v1/supplier/financial-account/withdrawals")
      .set("Cookie", ownerToken)
      .send({ amount: "500000" });
    expect(noIdem.status).toBe(400);
    expect(noIdem.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");

    // 2. تامین‌کننده B نمی‌تواند به اطلاعات حساب تامین‌کننده A دسترسی داشته باشد (IDOR)
    const idorRes = await api()
      .get(`/api/v1/supplier/financial-account/summary?supplierId=${ctx.supA}`)
      .set("Cookie", intruderToken);
    expect(idorRes.status).toBe(403);
    expect(idorRes.body.error).toBe("SUPPLIER_MEMBERSHIP_REQUIRED");

    // 3. نقش فروش (Sales) اجازه دسترسی به حساب مالی تامین‌کننده را ندارد
    const salesRes = await api()
      .get("/api/v1/supplier/financial-account/summary")
      .set("Cookie", salesToken);
    expect(salesRes.status).toBe(403);
    expect(salesRes.body.error).toBe("SUPPLIER_ROLE_NOT_AUTHORIZED");

    // 4. نقش مالک (Owner) تامین‌کننده A مجاز است و پاسخ فاقد هرگونه BigInt خام است
    const ownerRes = await api()
      .get("/api/v1/supplier/financial-account/summary")
      .set("Cookie", ownerToken);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.currency).toBe("IRR");
    expect(typeof ownerRes.body.availableForSettlement).toBe("string");
    expect(typeof ownerRes.body.pendingEarnings).toBe("string");

    // 5. ادمین می‌تواند خلاصه هر تامین‌کننده‌ای را دریافت کند
    const adminRes = await api()
      .get(`/api/v1/admin/settlement/suppliers/${ctx.supA}/summary`)
      .set("Cookie", adminToken);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.supplierId).toBe(ctx.supA);

    // 6. غیرادمین اجازه دسترسی به روت‌های ادمین را ندارد
    await api()
      .get(`/api/v1/admin/settlement/suppliers/${ctx.supA}/summary`)
      .set("Cookie", ownerToken)
      .expect(403);
  });
});
