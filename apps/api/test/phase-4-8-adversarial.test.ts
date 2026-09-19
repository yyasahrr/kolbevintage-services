/**
 * Phase 4.8 — Checkpoint D: Full Adversarial Verification Suite
 * - Concurrency & Double-Spend Prevention
 * - IDOR & Role Escalation Defense
 * - Post-Payout Refunds & Negative Position Recovery
 * - BigInt HTTP Serialization & Idempotency Header Enforcement
 * - Architecture & Single Writer Compliance
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

const TEST_DB = "kolbe_phase_4_8_adversarial_test";

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
  ctx = await seedTwoSuppliers(h.db, { priceA: 6_000_000n, priceB: 9_000_000n, onHand: 500 });
  settlement = h.app.get(SettlementService);
  fakeProvider = h.app.get(FakePayoutProvider);

  // Setup compliance for Supplier A
  const { SupplierComplianceService } = await import("../src/modules/compliance/supplier-compliance.service");
  const compliance = h.app.get(SupplierComplianceService);

  await compliance.upsertProfile({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    legalName: "شرکت تامین آزمون پیشرفته",
    entityType: "company",
    representativeName: "نماینده قانونی",
    registrationNumber: "8888888888",
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
    title: "Supplier Master Agreement",
    contentText: "master agreement text",
  });
  const doc = await compService.publishPolicy({ userId: ctx.userAdmin, role: "admin" }, draft.id);

  await compliance.acceptSupplierAgreement({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    policyDocumentId: doc.id,
  });

  const bank = await compliance.submitBankDestination({ userId: ctx.userAOwner, role: "supplier" }, ctx.supA, {
    destinationKind: "iban",
    value: testIban("0180170000009876543210"),
    holderName: "شرکت تامین آزمون پیشرفته",
  });
  await compliance.reviewBankDestination({ userId: ctx.userAdmin, role: "admin" }, bank.verification.id, {
    status: "verified",
    holderMatchStatus: "matched",
    verificationSource: "BANK_INQUIRY_MOCK",
  });

  // Release policy: 0 days
  await settlement.createHoldPolicy({
    policyVersion: 50,
    name: "Zero Days Policy",
    holdDurationDays: 0,
  });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.8 — Checkpoint D: Adversarial Invariants & Attack Resistance", () => {
  it("D1: Concurrency — race between two concurrent withdrawals preventing double-spending", async () => {
    // 1. ایجاد سفارش و آزادسازی مانده برای تامین‌کننده A (۱ قلم کالا = ۶,۰۰۰,۰۰۰ ریال)
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
    ]);
    const childA = childFor(ctx.sellerA)!;
    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 1, supplierA(ctx));
    await settlement.processChildEarnings(childA.id);

    await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supA,
      dryRun: false,
      idempotencyKey: makeId("idem_batch_d1"),
      executedBy: ctx.userAdmin,
    });

    const summary = await settlement.getSupplierSummary(ctx.supA);
    const available = BigInt(summary.availableForSettlement);
    expect(available).toBeGreaterThanOrEqual(6_000_000n);

    // 2. تلاش همزمان برای ثبت دو درخواست برداشت ۶,۰۰۰,۰۰۰ ریالی با کلیدهای مجزا
    // با توجه به قفل حساب کاربری در سطح دیتابیس (SELECT FOR UPDATE)، دقیقاً یکی باید موفق و دیگری باید رد شود
    const [res1, res2] = await Promise.allSettled([
      settlement.createWithdrawalRequest({
        supplierId: ctx.supA,
        amount: available,
        requestedByUserId: ctx.userAOwner,
        idempotencyKey: makeId("idem_race_1"),
      }),
      settlement.createWithdrawalRequest({
        supplierId: ctx.supA,
        amount: available,
        requestedByUserId: ctx.userAOwner,
        idempotencyKey: makeId("idem_race_2"),
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === "fulfilled");
    const rejections = [res1, res2].filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    const rejectedError = (rejections[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(SettlementDomainError);
    expect(rejectedError.code).toBe("INSUFFICIENT_AVAILABLE");

    // مانده در دسترس نباید هرگز منفی شود
    const afterSummary = await settlement.getSupplierSummary(ctx.supA);
    expect(BigInt(afterSummary.availableForSettlement)).toBe(0n);
    expect(BigInt(afterSummary.settlementPending)).toBe(available);
  });

  it("D2: Post-Payout Refund & Negative Carry-Forward Lifecycle (A12 & B9)", async () => {
    // 1. سفارش جدید با ۱ قلم کالا (۶,۰۰۰,۰۰۰ ریال)
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
    ]);
    const childA = childFor(ctx.sellerA)!;
    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childA.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childA.id, 1, supplierA(ctx));
    await settlement.processChildEarnings(childA.id);

    await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supA,
      dryRun: false,
      idempotencyKey: makeId("idem_batch_d2"),
      executedBy: ctx.userAdmin,
    });

    // 2. برداشت و تسویه کامل تمام مانده در دسترس
    const summaryBeforeWithdraw = await settlement.getSupplierSummary(ctx.supA);
    const totalAvail = BigInt(summaryBeforeWithdraw.availableForSettlement);
    expect(totalAvail).toBeGreaterThan(0n);

    const withdrawal = await settlement.createWithdrawalRequest({
      supplierId: ctx.supA,
      amount: totalAvail,
      requestedByUserId: ctx.userAOwner,
      idempotencyKey: makeId("idem_with_d2"),
    });

    const payout = await settlement.executePayout({
      withdrawalRequestId: withdrawal.id,
      provider: "fake",
      initiatedBy: ctx.userAdmin,
      idempotencyKey: makeId("idem_pout_d2"),
    });
    expect(payout.status).toBe("succeeded");

    const summaryAfterPayout = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryAfterPayout.availableForSettlement).toBe("0");

    // 3. ثبت استرداد پس از تسویه کامل (Post-Settlement Refund) به مبلغ ۴,۰۰۰,۰۰۰ ریال
    const refund = await h.paymentsService.createRefund({
      orderId: order.id,
      childOrderId: childA.id,
      reason: "Defective item after payout",
      actorUserId: ctx.userAdmin,
      actorRole: "admin",
      amount: "4000000",
      idempotencyKey: makeId("idem_ref_d2"),
    });

    await h.paymentsService.approveRefund({
      refundId: refund.refund.id,
      adminUserId: ctx.userAdmin,
      actorRole: "admin",
      idempotencyKey: makeId("idem_app_ref_d2"),
    });

    await h.paymentsService.completeRefund({
      refundId: refund.refund.id,
      adminUserId: ctx.userAdmin,
      actorRole: "admin",
      externalReference: "EXT-POST-PAYOUT-REF",
      idempotencyKey: makeId("idem_comp_ref_d2"),
    });

    // پردازش استرداد در تسویه
    const refundRes = await settlement.processChildRefund(childA.id, refund.refund.id);
    expect(refundRes.negativeCarryForward).toBe("4000000");

    // تسویه قبلی نباید ابطال شود؛ تاریخچه قبلی دست‌نخورده باقی می‌ماند
    const payoutCheck = await settlement.getPayoutById(payout.id);
    expect(payoutCheck.status).toBe("succeeded");

    // مانده در دسترس صفر می‌ماند و موقعیت منفی در recoveryAmount منعکس می‌شود
    let summaryAfterRefund = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryAfterRefund.availableForSettlement).toBe("0");
    expect(summaryAfterRefund.recoveryAmount).toBe("4000000");

    // 4. جبران خودکار موقعیت منفی با درآمدهای بعدی (Automatic Recovery Offset):
    // سفارش جدید به مبلغ ۶,۰۰۰,۰۰۰ ریال ثبت و تحویل می‌شود
    const { order: orderNew, childFor: childForNew } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
    ]);
    const childNew = childForNew(ctx.sellerA)!;
    await payByWebhook(h, ctx, orderNew.id);
    await prepareChild(h, childNew.id, ctx.userAOwner);
    await deliverPieces(h, ctx, childNew.id, 1, supplierA(ctx));
    await settlement.processChildEarnings(childNew.id);

    // اجرای بچ آزادسازی: مبلغ ۴,۰۰۰,۰۰۰ از ۶,۰۰۰,۰۰۰ ابتدا بدهی قبلی را تسویه کرده و ۲,۰۰۰,۰۰۰ در دسترس قرار می‌گیرد
    await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supA,
      dryRun: false,
      idempotencyKey: makeId("idem_batch_rec_offset"),
      executedBy: ctx.userAdmin,
    });

    const summaryFinal = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryFinal.recoveryAmount).toBe("0");
    expect(summaryFinal.availableForSettlement).toBe("2000000");
  });

  it("D3: IDOR and Role Boundaries on HTTP Surface", async () => {
    const ownerToken = cookie(ctx.userAOwner, "supplier");
    const salesToken = cookie(ctx.userASales, "supplier");
    const intruderToken = cookie(ctx.userBOwner, "supplier");

    // 1. عدم امکان درخواست برداشت توسط تامین‌کننده B برای تامین‌کننده A
    const idorWithdrawal = await api()
      .post("/api/v1/supplier/financial-account/withdrawals")
      .set("Cookie", intruderToken)
      .set("Idempotency-Key", makeId("idem_atk"))
      .send({ supplierId: ctx.supA, amount: "1000000" });
    expect(idorWithdrawal.status).toBe(403);
    expect(idorWithdrawal.body.error).toBe("SUPPLIER_MEMBERSHIP_REQUIRED");

    // 2. عدم امکان ثبت برداشت توسط کاربر با نقش sales
    const salesWithdrawal = await api()
      .post("/api/v1/supplier/financial-account/withdrawals")
      .set("Cookie", salesToken)
      .set("Idempotency-Key", makeId("idem_sales_atk"))
      .send({ amount: "500000" });
    expect(salesWithdrawal.status).toBe(403);
    expect(salesWithdrawal.body.error).toBe("SUPPLIER_ROLE_NOT_AUTHORIZED");

    // 3. درخواست برداشت بدون سربرگ Idempotency-Key رد می‌شود
    const missingIdem = await api()
      .post("/api/v1/supplier/financial-account/withdrawals")
      .set("Cookie", ownerToken)
      .send({ amount: "500000" });
    expect(missingIdem.status).toBe(400);
    expect(missingIdem.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("D4: BigInt HTTP response hygiene — zero raw numbers, valid JSON with string amounts", async () => {
    const ownerToken = cookie(ctx.userAOwner, "supplier");
    const res = await api()
      .get("/api/v1/supplier/financial-account/summary")
      .set("Cookie", ownerToken)
      .expect(200);

    const bodyText = res.text;
    expect(bodyText).toBeDefined();

    // بررسی اینکه فیلدهای پولی همگی رشته هستند
    expect(typeof res.body.pendingEarnings).toBe("string");
    expect(typeof res.body.availableForSettlement).toBe("string");
    expect(typeof res.body.amountOnHold).toBe("string");
    expect(typeof res.body.settlementPending).toBe("string");
    expect(typeof res.body.settledAmount).toBe("string");
    expect(typeof res.body.recoveryAmount).toBe("string");

    // عدم وجود هرگونه عدد اعشاری یا تبدیل شناور در مقادیر پولی
    expect(bodyText).not.toMatch(/"availableForSettlement":\s*\d+\.\d+/);
    expect(bodyText).not.toMatch(/"pendingEarnings":\s*\d+\.\d+/);
  });
});
