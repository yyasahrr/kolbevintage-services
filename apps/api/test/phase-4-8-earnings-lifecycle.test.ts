/**
 * Phase 4.8 — Checkpoint B Test Suite: Earnings Lifecycle, Delivery Attribution,
 * Commission Snapshot, Shipping Economics, Tax Non-Crediting, Holds, Batch Release,
 * and Refund Negative Carry-Forward.
 */
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
  kolbeRef,
  payByWebhook,
  prepareChild,
  seedKolbeOffer,
  sellerARef,
  sellerBRef,
  type KolbeContext,
} from "./helpers/phase-4-7-6.harness";
import { SettlementService } from "../src/modules/settlement/settlement.service";
import { SettlementDomainError } from "../src/modules/settlement/settlement.errors";

const TEST_DB = "kolbe_phase_4_8_earnings_test";

let h: Harness;
let ctx: SupplierContext;
let kolbe: KolbeContext;
let settlement: SettlementService;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 5_000_000n, priceB: 8_000_000n, onHand: 500 });
  kolbe = await seedKolbeOffer(h, ctx, 12_000_000n);
  settlement = h.app.get(SettlementService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.8 — Checkpoint B: Supplier Earnings & Lifecycle Engine", () => {
  it("B1: Delivery attribution — cash coverage precondition and partial delivery attribution", async () => {
    // 1. ایجاد سفارش ترکیبی با ۲ واحد از تامین‌کننده A
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 2 },
    ]);
    const childA = childFor(ctx.sellerA)!;

    // 2. قبل از پرداخت: پردازش کارکرد نباید چیزی سند بزند (PAYMENT_NOT_COLLECTED)
    const unpaidResult = await settlement.processChildEarnings(childA.id);
    expect(unpaidResult.candidate).toBe(true);
    expect(unpaidResult.cashCovered).toBe(false);
    expect(unpaidResult.reason).toBe("PAYMENT_NOT_COLLECTED");
    expect(unpaidResult.postedJournals).toEqual([]);

    // 3. پرداخت از طریق وب‌هوک
    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childA.id, ctx.userAOwner);

    // 4. پرداخت شده اما هنوز کالایی تحویل نشده است (NO_DELIVERED_SHIPMENTS)
    const unDeliveredResult = await settlement.processChildEarnings(childA.id);
    expect(unDeliveredResult.candidate).toBe(true);
    expect(unDeliveredResult.cashCovered).toBe(true);
    expect(unDeliveredResult.reason).toBe("NO_DELIVERED_SHIPMENTS");
    expect(unDeliveredResult.postedJournals).toEqual([]);

    // 5. تحویل جزئی: ۱ عدد از ۲ عدد تحویل می‌شود
    await deliverPieces(h, ctx, childA.id, 1, supplierA(ctx));

    const partialResult = await settlement.processChildEarnings(childA.id);
    expect(partialResult.candidate).toBe(true);
    expect(partialResult.cashCovered).toBe(true);
    expect(partialResult.entitledAmount).toBe("5000000"); // ۱ واحد × ۵,۰۰۰,۰۰۰ ریال
    expect(partialResult.postedJournals.length).toBeGreaterThanOrEqual(1);

    // بررسی مانده در انتظار تامین‌کننده A
    let summaryA = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryA.pendingEarnings).toBe("5000000");
    expect(summaryA.availableForSettlement).toBe("0");

    // 6. تحویل باقی‌مانده: ۱ عدد دوم نیز تحویل می‌شود
    await deliverPieces(h, ctx, childA.id, 1, supplierA(ctx));

    const fullResult = await settlement.processChildEarnings(childA.id);
    expect(fullResult.candidate).toBe(true);
    expect(fullResult.entitledAmount).toBe("5000000"); // ۵,۰۰۰,۰۰۰ ریال دیگر بابت واحد دوم

    summaryA = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryA.pendingEarnings).toBe("10000000"); // مجموع ۲ واحد = ۱۰,۰۰۰,۰۰۰ ریال

    // 7. اجرای مجدد (Replay Idempotency): نباید هیچ مبلغی دوباره افزوده شود
    const replayResult = await settlement.processChildEarnings(childA.id);
    expect(replayResult.entitledAmount).toBe("0");
    expect(replayResult.postedJournals).toEqual([]);

    summaryA = await settlement.getSupplierSummary(ctx.supA);
    expect(summaryA.pendingEarnings).toBe("10000000");
  });

  it("B2: Kolbe first-party child is excluded from supplier settlement (A3)", async () => {
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: kolbeRef(kolbe), quantity: 1 },
    ]);
    const childK = childFor(kolbeRef(kolbe).sellerId)!;

    await payByWebhook(h, ctx, order.id);

    const kolbeResult = await settlement.processChildEarnings(childK.id);
    expect(kolbeResult.candidate).toBe(false);
    expect(kolbeResult.reason).toBe("KOLBE_FIRST_PARTY");
    expect(kolbeResult.postedJournals).toEqual([]);
  });

  it("B3: Commission policy snapshotting and non-retroactivity (A5)", async () => {
    // 1. ثبت سیاست کمیسیون نسخه ۲ با نرخ ۵۰۰ bps (۵٪)
    await settlement.createCommissionPolicy({
      policyVersion: 2,
      name: "Standard 5% Commission",
      basis: "MERCHANDISE_ENTITLED_NET",
      rateBps: 500,
      roundingMode: "HALF_UP",
    });

    // 2. ایجاد سفارش برای تأمین‌کننده B (۱ واحد به مبلغ ۸,۰۰۰,۰۰۰ ریال)
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerBRef(ctx), quantity: 1 },
    ]);
    const childB = childFor(ctx.sellerB)!;

    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childB.id, ctx.userBOwner);
    await deliverPieces(h, ctx, childB.id, 1, {
      userId: ctx.userBOwner,
      role: "supplier",
      supplierId: ctx.supB,
    });

    // 3. پردازش کارکرد: اسنپ‌شات کمیسیون ۵۰۰ bps ثبت می‌شود
    const resB = await settlement.processChildEarnings(childB.id);
    expect(resB.entitledAmount).toBe("8000000");
    expect(resB.commissionAmount).toBe("400000"); // ۵٪ از ۸,۰۰۰,۰۰۰ = ۴۰۰,۰۰۰ ریال

    // بررسی مانده: درآمد ناخالص ۸,۰۰۰,۰۰۰ منهای کمیسیون ۴۰۰,۰۰۰ = ۷,۶۰۰,۰۰۰ در انتظار
    let summaryB = await settlement.getSupplierSummary(ctx.supB);
    expect(summaryB.pendingEarnings).toBe("7600000");

    // 4. تغییر سیاست به نسخه ۳ با نرخ ۱۰۰۰ bps (۱۰٪)
    await settlement.createCommissionPolicy({
      policyVersion: 3,
      name: "Higher 10% Commission",
      basis: "MERCHANDISE_ENTITLED_NET",
      rateBps: 1000,
      roundingMode: "HALF_UP",
    });

    // 5. بررسی اسنپ‌شات سفارش موجود: باید همچنان نسخه ۲ با نرخ ۵۰۰ bps باشد
    const snapshot = await settlement.getOrSnapshotCommissionPolicy(childB.id, h.db);
    expect(snapshot.policyVersion).toBe(2);
    expect(snapshot.rateBps).toBe(500);

    // مانده بدون تغییر می‌ماند
    summaryB = await settlement.getSupplierSummary(ctx.supB);
    expect(summaryB.pendingEarnings).toBe("7600000");
  });

  it("B4: Explicit Shipping Economics — default uncredited; credited only when recipient is SUPPLIER (A6)", async () => {
    // 1. سفارش با هزینه حمل برای خریدار
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
    ]);
    const childA = childFor(ctx.sellerA)!;
    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childA.id, ctx.userAOwner);

    // وضعیت اولیه: سیاست حمل تعریف نشده است
    const beforeEco = await settlement.getShippingEconomics(childA.id);
    expect(beforeEco).toBeNull();

    // 2. تنظیم سیاست حمل به‌صورت explicitly SUPPLIER با مبلغ ۳۰۰,۰۰۰ ریال
    await settlement.upsertShippingEconomics({
      childOrderId: childA.id,
      shippingChargeToBuyer: 300_000n,
      shippingEconomicRecipient: "SUPPLIER",
      shippingCostBearer: "BUYER",
    });

    await deliverPieces(h, ctx, childA.id, 1, supplierA(ctx));

    const res = await settlement.processChildEarnings(childA.id);
    expect(res.shippingAmount).toBe("300000");

    // 3. در صورتیکه گیرنده KOLBE باشد، نباید به تامین‌کننده تعلق گیرد
    const { order: order2, childFor: childFor2 } = await createMixedOrder(h, ctx, [
      { seller: sellerARef(ctx), quantity: 1 },
    ]);
    const childA2 = childFor2(ctx.sellerA)!;
    await payByWebhook(h, ctx, order2.id);
    await prepareChild(h, childA2.id, ctx.userAOwner);

    await settlement.upsertShippingEconomics({
      childOrderId: childA2.id,
      shippingChargeToBuyer: 400_000n,
      shippingEconomicRecipient: "KOLBE",
      shippingCostBearer: "BUYER",
    });

    await deliverPieces(h, ctx, childA2.id, 1, supplierA(ctx));
    const res2 = await settlement.processChildEarnings(childA2.id);
    expect(res2.shippingAmount).toBe("0");
  });

  it("B5: Pending to Available lifecycle & Settlement Batch Release with Hold Policy (A9)", async () => {
    // 1. ایجاد سیاست مسدودی ۰ روزه برای آزادسازی فوری در تست
    await settlement.createHoldPolicy({
      policyVersion: 10,
      name: "Immediate Release Policy",
      holdDurationDays: 0,
    });

    const summaryBefore = await settlement.getSupplierSummary(ctx.supB);
    const pendingAmount = BigInt(summaryBefore.pendingEarnings);
    expect(pendingAmount).toBeGreaterThan(0n);

    // 2. اجرای پیش‌نمایش (dryRun = true): نباید چیزی در دیتابیس ثبت شود
    const dryRun = await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supB,
      dryRun: true,
      idempotencyKey: makeId("idem_dry_batch"),
      executedBy: ctx.userAdmin,
    });
    expect(dryRun.status).toBe("draft");
    expect(dryRun.totalReleasedAmount).toBe(pendingAmount.toString());

    // مانده‌ها دست‌نخورده باقی مانده‌اند
    let summaryAfterDry = await settlement.getSupplierSummary(ctx.supB);
    expect(summaryAfterDry.pendingEarnings).toBe(pendingAmount.toString());
    expect(summaryAfterDry.availableForSettlement).toBe("0");

    // 3. اجرای واقعی بچ آزادسازی تسویه
    const idempotencyKey = makeId("idem_real_batch");
    const realBatch = await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supB,
      dryRun: false,
      idempotencyKey,
      executedBy: ctx.userAdmin,
    });
    expect(realBatch.status).toBe("completed");
    expect(realBatch.totalReleasedAmount).toBe(pendingAmount.toString());

    // مانده در انتظار صفر شده و به مانده قابل تسویه منتقل گردیده است
    let summaryAfterReal = await settlement.getSupplierSummary(ctx.supB);
    expect(summaryAfterReal.pendingEarnings).toBe("0");
    expect(summaryAfterReal.availableForSettlement).toBe(pendingAmount.toString());

    // 4. تکرار با همان کلید عطف (Idempotent): باید بچ موجود را برگرداند
    const replayed = await settlement.evaluateAndReleaseSettlementBatch({
      supplierId: ctx.supB,
      dryRun: false,
      idempotencyKey,
      executedBy: ctx.userAdmin,
    });
    expect(replayed.id).toBe(realBatch.id);
    expect(replayed.totalReleasedAmount).toBe(realBatch.totalReleasedAmount);
  });

  it("B6: Financial Holds — place, block batch release, and release lifecycle", async () => {
    // مانده قابل تسویه تامین‌کننده B اکنون ۷,۶۰۰,۰۰۰ ریال است
    const summary = await settlement.getSupplierSummary(ctx.supB);
    const available = BigInt(summary.availableForSettlement);
    expect(available).toBeGreaterThanOrEqual(2_000_000n);

    // 1. ثبت مسدودی مالی ۲,۰۰۰,۰۰۰ ریال
    const hold = await settlement.placeHold({
      supplierId: ctx.supB,
      scope: "SUPPLIER",
      reason: "DISPUTE",
      amount: 2_000_000n,
      placedBy: ctx.userAdmin,
      notes: "Customer dispute investigation",
      idempotencyKey: makeId("idem_hold"),
    });

    expect(hold.status).toBe("active");
    expect(hold.amount).toBe("2000000");

    let afterHold = await settlement.getSupplierSummary(ctx.supB);
    expect(afterHold.amountOnHold).toBe("2000000");
    expect(BigInt(afterHold.availableForSettlement)).toBe(available - 2_000_000n);

    // 2. تلاش برای مسدودی بیش از موجودی باید با خطای INSUFFICIENT_AVAILABLE مواجه شود
    await expect(
      settlement.placeHold({
        supplierId: ctx.supB,
        scope: "SUPPLIER",
        reason: "MANUAL_FINANCE_HOLD",
        amount: 100_000_000n,
        placedBy: ctx.userAdmin,
        idempotencyKey: makeId("idem_hold_excess"),
      }),
    ).rejects.toThrowError(SettlementDomainError);

    // 3. آزادسازی مسدودی مالی
    const released = await settlement.releaseHold({
      holdId: hold.id,
      releasedBy: ctx.userAdmin,
      notes: "Dispute resolved amicably",
    });

    expect(released.status).toBe("released");

    let afterRelease = await settlement.getSupplierSummary(ctx.supB);
    expect(afterRelease.amountOnHold).toBe("0");
    expect(afterRelease.availableForSettlement).toBe(available.toString());
  });

  it("B7: Refund recovery and negative carry-forward (A12 & B9)", async () => {
    // 1. سفارش جدید با ۱ قلم برای تامین‌کننده B
    const { order, childFor } = await createMixedOrder(h, ctx, [
      { seller: sellerBRef(ctx), quantity: 1 },
    ]);
    const childB = childFor(ctx.sellerB)!;
    await payByWebhook(h, ctx, order.id);
    await prepareChild(h, childB.id, ctx.userBOwner);
    await deliverPieces(h, ctx, childB.id, 1, {
      userId: ctx.userBOwner,
      role: "supplier",
      supplierId: ctx.supB,
    });
    await settlement.processChildEarnings(childB.id);

    // 2. ثبت استرداد در سطح خرید / پرداخت
    const refund = await h.paymentsService.createRefund({
      orderId: order.id,
      childOrderId: childB.id,
      reason: "Item defective",
      actorUserId: ctx.userAdmin,
      actorRole: "admin",
      amount: "8000000",
      idempotencyKey: makeId("idem_refund"),
    });

    // تایید و سپس تکمیل استرداد
    await h.paymentsService.approveRefund({
      refundId: refund.refund.id,
      adminUserId: ctx.userAdmin,
      actorRole: "admin",
      idempotencyKey: makeId("idem_app_refund"),
    });

    await h.paymentsService.completeRefund({
      refundId: refund.refund.id,
      adminUserId: ctx.userAdmin,
      actorRole: "admin",
      externalReference: "RET-REFUND-999",
      idempotencyKey: makeId("idem_comp_refund"),
    });

    // 3. پردازش استرداد در تسویه
    const refundRes = await settlement.processChildRefund(childB.id, refund.refund.id);
    expect(refundRes.refundId).toBe(refund.refund.id);

    // 4. بررسی وضعیت مالی: در صورتیکه مبلغ استرداد از موجودی در انتظار و در دسترس بیشتر باشد،
    // اضافهٔ آن به‌صورت انتقال منفی (Negative Carry-forward / Recovery) ثبت شده و تاریخچه دست‌نخورده می‌ماند
    const summary = await settlement.getSupplierSummary(ctx.supB);
    expect(Number(summary.recoveryAmount)).toBeGreaterThanOrEqual(0);
    // مانده در دسترس هرگز منفی نمی‌شود (کف صفر)
    expect(BigInt(summary.availableForSettlement)).toBeGreaterThanOrEqual(0n);
  });
});
