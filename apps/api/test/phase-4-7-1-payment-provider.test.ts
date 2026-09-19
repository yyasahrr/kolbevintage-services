/**
 * Phase 4.7.1 — Stage A: payment provider correctness (real PostgreSQL, real Nest app).
 *
 * Every assertion inspects DB state (payment, payment_allocation, financial_ledger_entry,
 * order_financial_release, wholesale_order, order_event, payment_provider_event,
 * refund, refund_allocation, refund_line). Mock call counts are never the oracle.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootHarness,
  confirmToAwaitingPayment,
  count,
  createFakeIntent,
  createOrder,
  expectDomainError,
  fakeWebhookBody,
  makeId,
  one,
  q,
  seedTwoSuppliers,
  signedFakeHeaders,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_4_7_1_payment_test";

let h: Harness;
let ctx: SupplierContext;

async function paidOrderReady(opts: { qtyA?: number; qtyB?: number } = {}) {
  const { order, childA, childB } = await createOrder(h, ctx, opts);
  await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
  const intent = await createFakeIntent(h, order.id, ctx.userBuyer);
  return { order, childA, childB, ...intent };
}

async function ledgerIn(paymentId: string) {
  return count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE payment_id = $1 AND direction = 'IN' AND entry_type = 'payment_verified'`, [paymentId]);
}

async function verifiedViaWebhook(opts: { qtyA?: number; qtyB?: number } = {}) {
  const ready = await paidOrderReady(opts);
  const res = await h.paymentProviderOrchestrator.ingestWebhook({
    provider: "fake",
    request: { headers: signedFakeHeaders(), body: fakeWebhookBody(ready.providerReference, { eventId: makeId("evt") }) },
  });
  expect(res.outcome.status).toBe("processed");
  return ready;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.1 — A. Payment provider canonical path", () => {

  it("A1 — webhook drives verify → allocations → ledger IN → coverage → release → order gate, and only then marks the event processed", async () => {
    const { order, paymentId, providerReference } = await paidOrderReady({ qtyA: 10 });
    const before = await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(before.status).toBe("awaiting_payment");

    const res = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-a1-" + paymentId }) },
    });
    expect(res.duplicate).toBe(false);
    expect(res.outcome.status).toBe("processed");

    const pay = await one(h.pool, `SELECT * FROM payment WHERE id = $1`, [paymentId]);
    expect(pay.status).toBe("verified");
    expect(pay.external_reference).toBe(providerReference);
    expect(pay.provider_state).toBe("success");

    const allocs = await q(h.pool, `SELECT amount FROM payment_allocation WHERE payment_id = $1 AND status = 'active'`, [paymentId]);
    const allocSum = allocs.reduce((s, a) => s + BigInt(a.amount), 0n);
    expect(allocSum).toBe(BigInt(pay.amount));
    expect(allocSum).toBe(10_000_000n);

    expect(await ledgerIn(paymentId)).toBe(1);

    const releases = await q(h.pool, `SELECT release_type FROM order_financial_release WHERE order_id = $1`, [order.id]);
    expect(releases.map((r) => r.release_type)).toEqual(["payment_verified"]);

    const after = await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(after.status).toBe("processing");

    const events = await q(h.pool, `SELECT event_type, payload FROM order_event WHERE aggregate_id = $1 ORDER BY created_at ASC`, [order.id]);
    const types = events.map((e) => e.event_type);
    expect(types).toContain("payment.verified");
    expect(types).toContain("payment.provider_verified");
    expect(types).toContain("order.processing_started");
    // No provider reference or secret leaks into order events
    for (const e of events) expect(JSON.stringify(e.payload)).not.toContain(providerReference);

    const ev = await one(h.pool, `SELECT status, processed_at, safe_metadata FROM payment_provider_event WHERE provider = 'fake' AND external_event_id = $1`, ["evt-a1-" + paymentId]);
    expect(ev.status).toBe("processed");
    expect(ev.processed_at).not.toBeNull();
    expect(JSON.stringify(ev.safe_metadata)).not.toContain("x-fake-signature");
  });

  it("A2/A3 — the same provider event delivered 6× concurrently: one inbox row, one verification, one ledger entry, one release", async () => {
    const { order, paymentId, providerReference } = await paidOrderReady({ qtyA: 3 });
    const body = fakeWebhookBody(providerReference); // no eventId → deterministic payload fingerprint
    const results = await Promise.all(
      Array.from({ length: 6 }, () => h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body } })),
    );
    const processed = results.filter((r) => r.outcome.status === "processed" && !r.duplicate);
    expect(processed.length).toBe(1);
    expect(results.filter((r) => r.duplicate).length).toBe(5);

    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_payment_reference = $1`, [providerReference])).toBe(1);
    expect(await ledgerIn(paymentId)).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_status_history WHERE order_id = $1 AND to_status = 'processing'`, [order.id])).toBe(1);
    const pay = await one(h.pool, `SELECT status, version FROM payment WHERE id = $1`, [paymentId]);
    expect(pay.status).toBe("verified");
    expect(pay.version).toBe(1); // 0 (intent) → 1 (verified): no double transition
  });

  it("A2 — identity is never time-based: two deliveries of the same payload minutes apart collapse to one event", async () => {
    const { providerReference } = await paidOrderReady({ qtyA: 1 });
    const body = fakeWebhookBody(providerReference, { status: "pending" });
    const first = await h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body } });
    await new Promise((r) => setTimeout(r, 20));
    const second = await h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body } });
    expect(first.outcome.eventId).toBe(second.outcome.eventId);
    expect(second.duplicate).toBe(true);
    const ev = await one(h.pool, `SELECT external_event_id FROM payment_provider_event WHERE id = $1`, [first.outcome.eventId]);
    expect(ev.external_event_id.startsWith("fp_")).toBe(true);
  });

  it("A4 — provider outage during processing ⇒ event `failed`, payment untouched; reconciliation later completes the canonical path", async () => {
    const { order, paymentId, providerReference } = await paidOrderReady({ qtyA: 2 });
    h.fakePayment.failNextStatusQueries(1);
    const res = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-a4-" + paymentId }) },
    });
    expect(res.outcome.status).toBe("failed");
    const ev1 = await one(h.pool, `SELECT status, failure_reason FROM payment_provider_event WHERE id = $1`, [res.outcome.eventId]);
    expect(ev1.status).toBe("failed");
    expect(ev1.failure_reason).toContain("outage");
    const pay1 = await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId]);
    expect(pay1.status).toBe("pending");
    expect(await ledgerIn(paymentId)).toBe(0);

    const summary = await h.paymentProviderOrchestrator.reconcile({ limit: 50 });
    expect(summary.eventsProcessed + summary.paymentsVerified).toBeGreaterThanOrEqual(1);
    const ev2 = await one(h.pool, `SELECT status FROM payment_provider_event WHERE id = $1`, [res.outcome.eventId]);
    expect(ev2.status).toBe("processed");
    const pay2 = await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId]);
    expect(pay2.status).toBe("verified");
    expect(await ledgerIn(paymentId)).toBe(1);
    const ord = await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id]);
    expect(ord.status).toBe("processing");
  });

  it("A6 — provider-reported amount / currency mismatch ⇒ PAYMENT_PROVIDER_*_MISMATCH, event failed, nothing verified", async () => {
    const wrongAmount = await paidOrderReady({ qtyA: 1 });
    h.fakePayment.setScenario(wrongAmount.paymentId, "wrong_amount");
    const r1 = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(wrongAmount.providerReference, { eventId: "evt-a6-amt-" + wrongAmount.paymentId }) },
    });
    expect(r1.outcome.status).toBe("failed");
    expect((r1.outcome as any).reason).toContain("PAYMENT_PROVIDER_AMOUNT_MISMATCH");
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [wrongAmount.paymentId])).status).toBe("pending");
    expect(await ledgerIn(wrongAmount.paymentId)).toBe(0);

    const wrongCurrency = await paidOrderReady({ qtyA: 1 });
    h.fakePayment.setScenario(wrongCurrency.paymentId, "wrong_currency");
    const r2 = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(wrongCurrency.providerReference, { eventId: "evt-a6-cur-" + wrongCurrency.paymentId }) },
    });
    expect(r2.outcome.status).toBe("failed");
    expect((r2.outcome as any).reason).toContain("PAYMENT_PROVIDER_CURRENCY_MISMATCH");

    // Webhook payload claiming a different amount than our payment row is rejected before any provider call.
    const claimed = await paidOrderReady({ qtyA: 1 });
    const r3 = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(claimed.providerReference, { eventId: "evt-a6-claim-" + claimed.paymentId, amount: "1" }) },
    });
    expect(r3.outcome.status).toBe("failed");
    expect((r3.outcome as any).reason).toContain("PAYMENT_PROVIDER_AMOUNT_MISMATCH");
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [claimed.paymentId])).status).toBe("pending");
  });

  it("A6 — non-final provider state (pending) never verifies: event `ignored`, payment pending", async () => {
    const { paymentId, providerReference } = await paidOrderReady({ qtyA: 1 });
    h.fakePayment.setScenario(paymentId, "pending");
    const res = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-a6-pending-" + paymentId }) },
    });
    expect(res.outcome.status).toBe("ignored");
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId])).status).toBe("pending");
    expect(await ledgerIn(paymentId)).toBe(0);
  });

  it("A5 — provider reference is unique per provider (DB) and resolution is provider-scoped", async () => {
    const { paymentId, providerReference } = await paidOrderReady({ qtyA: 1 });
    const dup = await expectDomainError(
      h.pool.query(
        `INSERT INTO payment (id, payment_reference, wholesale_order_id, method, provider, status, amount, currency, provider_reference, submitted_by, submitted_at, version, created_at, updated_at)
         SELECT 'pay_dup_' || id, 'PAY-DUP-' || substr(md5(id),1,8), wholesale_order_id, method, provider, 'pending', amount, currency, provider_reference, submitted_by, submitted_at, 0, NOW(), NOW()
         FROM payment WHERE id = $1`,
        [paymentId],
      ),
    );
    expect(dup.code).toBe("23505");
    expect(String(dup.constraint || dup.message)).toContain("payment_provider_reference_unique");

    expect(await h.paymentsService.findPaymentByProviderReference("manual", providerReference)).toBeNull();
    expect((await h.paymentsService.findPaymentByProviderReference("fake", providerReference)).id).toBe(paymentId);

    const unknown = await h.paymentProviderOrchestrator.ingestWebhook({
      provider: "fake",
      request: { headers: signedFakeHeaders(), body: fakeWebhookBody("FAKE-DOES-NOT-EXIST", { eventId: "evt-a5-unknown-" + paymentId }) },
    });
    expect(unknown.outcome.status).toBe("failed");
    expect((unknown.outcome as any).reason).toContain("PAYMENT_NOT_FOUND");
  });

  it("A7 — the callback (browser redirect) never verifies and writes nothing", async () => {
    const { paymentId, providerReference } = await paidOrderReady({ qtyA: 1 });
    const res = await request(h.app.getHttpServer())
      .get(`/api/v1/payments/providers/fake/callback`)
      .query({ authority: providerReference, status: "OK" })
      .expect(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.verificationPending).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(providerReference);
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId])).status).toBe("pending");
    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_payment_reference = $1`, [providerReference])).toBe(0);
  });

  it("HTTP — webhook is public but adapter-authenticated: bad signature ⇒ 403 and no inbox row; manual has no webhook channel ⇒ 403 PROVIDER_NOT_ALLOWED", async () => {
    const { paymentId, providerReference } = await paidOrderReady({ qtyA: 1 });
    const bad = await request(h.app.getHttpServer())
      .post(`/api/v1/payments/providers/fake/webhook`)
      .set("x-fake-signature", "wrong")
      .send(fakeWebhookBody(providerReference, { eventId: "evt-http-bad-" + paymentId }))
      .expect(403);
    expect(bad.body.error).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_event_id = $1`, ["evt-http-bad-" + paymentId])).toBe(0);

    const manual = await request(h.app.getHttpServer())
      .post(`/api/v1/payments/providers/manual/webhook`)
      .send({ providerReference, status: "success" })
      .expect(403);
    expect(manual.body.error).toBe("PROVIDER_NOT_ALLOWED");

    const unknown = await request(h.app.getHttpServer()).post(`/api/v1/payments/providers/nope/webhook`).send({}).expect(404);
    expect(unknown.body.error).toBe("PAYMENT_PROVIDER_UNKNOWN");

    const good = await request(h.app.getHttpServer())
      .post(`/api/v1/payments/providers/fake/webhook`)
      .set(signedFakeHeaders())
      .send(fakeWebhookBody(providerReference, { eventId: "evt-http-good-" + paymentId }))
      .expect(200);
    expect(good.body.status).toBe("processed");
    expect(JSON.stringify(good.body)).not.toContain(providerReference);
    expect((await one(h.pool, `SELECT status FROM payment WHERE id = $1`, [paymentId])).status).toBe("verified");
  });

  it("A8/A9 — webhook vs reconciliation racing on the same payment: exactly one verification, one release, both settle", async () => {
    const { order, paymentId, providerReference } = await paidOrderReady({ qtyA: 4 });
    const [wh, rec] = await Promise.all([
      h.paymentProviderOrchestrator.ingestWebhook({
        provider: "fake",
        request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-a9-" + paymentId }) },
      }),
      h.paymentProviderOrchestrator.reconcile({ limit: 50 }),
    ]);
    expect(wh.outcome.status).toBe("processed");
    expect(rec.paymentsChecked).toBeGreaterThanOrEqual(0);
    expect(await ledgerIn(paymentId)).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'payment.verified'`, [order.id])).toBe(1);
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");
    // Reconciliation idempotency keys are deterministic (no timestamps)
    const keys = await q(h.pool, `SELECT idempotency_key FROM command_idempotency WHERE scope_type = 'payment' AND scope_id = $1`, [paymentId]);
    for (const k of keys) expect(k.idempotency_key).toMatch(/^(webhook:fake:|reconcile:)/);
    // Running reconciliation again is a no-op for this payment
    await h.paymentProviderOrchestrator.reconcile({ limit: 50 });
    expect(await ledgerIn(paymentId)).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
  });

  it("Concurrency — provider re-sends success under two different event ids at once: one verification, second is already_final", async () => {
    const { order, paymentId, providerReference } = await paidOrderReady({ qtyA: 2 });
    const [r1, r2] = await Promise.all([
      h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-dup1-" + paymentId }) } }),
      h.paymentProviderOrchestrator.ingestWebhook({ provider: "fake", request: { headers: signedFakeHeaders(), body: fakeWebhookBody(providerReference, { eventId: "evt-dup2-" + paymentId }) } }),
    ]);
    expect([r1.outcome.status, r2.outcome.status]).toEqual(["processed", "processed"]);
    expect(await ledgerIn(paymentId)).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM payment_allocation WHERE payment_id = $1`, [paymentId])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM payment_provider_event WHERE external_payment_reference = $1 AND status = 'processed'`, [providerReference])).toBe(2);
  });

  it("A10 — fake providers are rejected at the resolve boundary when NODE_ENV=production (payment + shipping)", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const p = await expectDomainError(Promise.resolve().then(() => h.paymentRegistry.resolve("fake")));
      expect(p.code).toBe("PROVIDER_NOT_ALLOWED");
      expect(p.status).toBe(403);
      const s = await expectDomainError(Promise.resolve().then(() => h.shippingRegistry.resolve("fake")));
      expect(s.code).toBe("PROVIDER_NOT_ALLOWED");
      expect(s.status).toBe(403);
      // manual remains resolvable in production
      expect(h.paymentRegistry.resolve("manual").name).toBe("manual");
      expect(h.shippingRegistry.resolve("manual").name).toBe("manual");
      const { providerReference } = await paidOrderReady({ qtyA: 1 }).catch(() => ({ providerReference: null as any }));
      // an intent cannot be created against the fake provider in production
      expect(providerReference).toBeNull();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("D5 — per-proforma coverage: A=10M, B=20M; a verified 20M covers A fully and B partially → stays awaiting_payment; the remaining 10M releases the gate", async () => {
    const { order, childA, childB } = await createOrder(h, ctx, { qtyA: 10, qtyB: 10 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const submit1 = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: "20000000", bankReference: "BANK-REF-D5-1", idempotencyKey: makeId("idem_t1"), actorRole: "buyer" });
    const v1 = await h.financeOrchestrator.verifyPayment({ paymentId: submit1.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-REF-D5-1", idempotencyKey: makeId("idem_v1"), actorRole: "admin" });
    expect(v1.coverage.isFullyCovered).toBe(false);
    const byChild = await q(h.pool, `SELECT wp.child_order_id, SUM(pa.amount)::text AS sum FROM payment_allocation pa JOIN wholesale_proforma wp ON wp.id = pa.proforma_id WHERE pa.payment_id = $1 GROUP BY wp.child_order_id`, [submit1.payment.id]);
    const allocA = byChild.find((r) => r.child_order_id === childA.id);
    const allocB = byChild.find((r) => r.child_order_id === childB!.id);
    expect(allocA?.sum).toBe("10000000");
    expect(allocB?.sum).toBe("10000000");
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("awaiting_payment");
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(0);
    const summary1 = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(summary1.currentPayable).toBe("10000000");
    expect(summary1.unallocatedPaid).toBe("0");

    const submit2 = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: "10000000", bankReference: "BANK-REF-D5-2", idempotencyKey: makeId("idem_t2"), actorRole: "buyer" });
    const v2 = await h.financeOrchestrator.verifyPayment({ paymentId: submit2.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-REF-D5-2", idempotencyKey: makeId("idem_v2"), actorRole: "admin" });
    expect(v2.coverage.isFullyCovered).toBe(true);
    expect((await one(h.pool, `SELECT status FROM wholesale_order WHERE id = $1`, [order.id])).status).toBe("processing");
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1 AND release_type = 'payment_verified'`, [order.id])).toBe(1);
  });

  it("D5 — overpayment stays unallocated (no wallet, no auto-move) and never counts toward another proforma", async () => {
    const { order } = await createOrder(h, ctx, { qtyA: 10 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const submit = await h.financeOrchestrator.submitTransfer({ orderId: order.id, buyerUserId: ctx.userBuyer, amount: "30000000", bankReference: "BANK-REF-OVER", idempotencyKey: makeId("idem_t3"), actorRole: "buyer" });
    await h.financeOrchestrator.verifyPayment({ paymentId: submit.payment.id, adminUserId: ctx.userAdmin, externalReference: "BANK-REF-OVER", idempotencyKey: makeId("idem_v3"), actorRole: "admin" });
    const allocSum = (await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS sum FROM payment_allocation WHERE payment_id = $1`, [submit.payment.id])).sum;
    expect(allocSum).toBe("10000000");
    const summary = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(summary.unallocatedPaid).toBe("20000000");
    expect(summary.currentPayable).toBe("0");
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'payment.overpaid'`, [order.id])).toBe(1);
  });
});

describe("Phase 4.7.1 — A. Refund correctness (A11–A14)", () => {
  async function refundableOrder(opts: { qtyA?: number; qtyB?: number } = { qtyA: 5 }) {
    return verifiedViaWebhook(opts);
  }

  it("A13 — a refund is mapped onto its verified source payment(s): SUM(refund_allocation) == refund.amount; over-refund and invalid source are rejected", async () => {
    const { order, childA, paymentId } = await refundableOrder({ qtyA: 5 }); // 5 × 1,000,000
    const r = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "1500000", reasonCode: "damaged", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    const allocs = await q(h.pool, `SELECT payment_id, amount FROM refund_allocation WHERE refund_id = $1`, [r.refund.id]);
    expect(allocs.length).toBe(1);
    expect(allocs[0].payment_id).toBe(paymentId);
    expect(allocs.reduce((s, a) => s + BigInt(a.amount), 0n)).toBe(1_500_000n);
    expect((await one(h.pool, `SELECT payment_id FROM refund WHERE id = $1`, [r.refund.id])).payment_id).toBe(paymentId);

    const tooMuch = await expectDomainError(
      h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "4000000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") }),
    );
    expect(tooMuch.code).toBe("REFUND_EXCEEDS_ALLOCATED");

    const badSource = await expectDomainError(
      h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, paymentId: "pay_does_not_exist", amount: "100", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") }),
    );
    expect(badSource.code).toBe("REFUND_SOURCE_PAYMENT_INVALID");

    // Concurrent creates with distinct keys cannot jointly exceed the refundable ceiling (3.5M left)
    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "2000000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref_race") }),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled").length).toBe(1);
    const total = (await one(h.pool, `SELECT COALESCE(SUM(amount),0)::text AS sum FROM refund WHERE child_order_id = $1 AND status <> 'failed'`, [childA.id])).sum;
    expect(BigInt(total) <= 5_000_000n).toBe(true);
  });

  it("A14 — item/quantity refunds use the exact proforma line basis; wrong amount or excess quantity is rejected", async () => {
    const { order, childA } = await refundableOrder({ qtyA: 5 });
    const item = await one(h.pool, `SELECT id, piece_quantity FROM wholesale_order_item WHERE order_id = $1 AND seller_id = $2`, [order.id, ctx.sellerA]);
    expect(Number(item.piece_quantity)).toBe(5);

    const mismatch = await expectDomainError(
      h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "1", lines: [{ wholesaleOrderItemId: item.id, quantity: 2 }], actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") }),
    );
    expect(mismatch.code).toBe("REFUND_LINE_BASIS_MISMATCH");

    const ok: any = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, lines: [{ wholesaleOrderItemId: item.id, quantity: 2 }], actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    expect(String(ok.refund.amount)).toBe("2000000");
    const line = await one(h.pool, `SELECT quantity, unit_price, line_total FROM refund_line WHERE refund_id = $1`, [ok.refund.id]);
    expect(Number(line.quantity)).toBe(2);
    expect(String(line.unit_price)).toBe("1000000");
    expect(String(line.line_total)).toBe("2000000");

    const excess = await expectDomainError(
      h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, lines: [{ wholesaleOrderItemId: item.id, quantity: 4 }], actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") }),
    );
    expect(excess.code).toBe("REFUND_LINE_QUANTITY_EXCEEDED");

    // DB-level basis invariant
    const bad = await expectDomainError(h.pool.query(`INSERT INTO refund_line (id, refund_id, wholesale_order_item_id, quantity, unit_price, line_total, currency) VALUES ('rline_bad', $1, $2, 1, 10, 11, 'IRR')`, [ok.refund.id, item.id]));
    expect(bad.code).toBe("23514");
  });

  it("A11 — refund completion demands real evidence: fabricated references are rejected; the manual provider never fabricates one", async () => {
    const { order, childA } = await refundableOrder({ qtyA: 2 });
    const r = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "500000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    await h.financeOrchestrator.approveRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("idem_apr"), actorRole: "admin" });

    for (const fake of ["", "   ", "abc", "provider-fake-" + r.refund.id, "REF-MANUAL-ABC123"]) {
      const err = await expectDomainError(h.financeOrchestrator.completeRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, externalReference: fake, idempotencyKey: makeId("idem_cmp"), actorRole: "admin" }));
      expect(["EXTERNAL_REFERENCE_REQUIRED", "REFUND_EVIDENCE_INVALID"]).toContain(err.code);
      expect(err.status).toBe(400);
    }
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1`, [r.refund.id])).toBe(0);

    const manual = await h.paymentRegistry.resolve("manual").refund({ refundId: r.refund.id, amount: 500000n, currency: "IRR" });
    expect(manual.success).toBe(false);
    expect(manual.externalReference).toBeUndefined();

    const done = await h.financeOrchestrator.completeRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, externalReference: "BANK-TRACK-778812", idempotencyKey: makeId("idem_cmp"), actorRole: "admin" });
    expect(done.refund.status).toBe("completed");
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1 AND direction = 'OUT'`, [r.refund.id])).toBe(1);
  });

  it("A12 — duplicate refund completion (5 concurrent, distinct keys) ⇒ exactly one ledger OUT, status completed once", async () => {
    const { order, childA } = await refundableOrder({ qtyA: 2 });
    const r = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "700000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    await h.financeOrchestrator.approveRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("idem_apr"), actorRole: "admin" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.financeOrchestrator.completeRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, externalReference: "BANK-TRACK-991122", idempotencyKey: makeId("idem_cmp"), actorRole: "admin" })),
    );
    expect(results.filter((x) => !x.replayed).length).toBe(1);
    expect(results.filter((x) => x.replayed).length).toBe(4);
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1 AND direction = 'OUT'`, [r.refund.id])).toBe(1);
    expect(await count(h.pool, `SELECT 1 FROM order_event WHERE aggregate_id = $1 AND event_type = 'refund.completed'`, [order.id])).toBe(1);
    const row = await one(h.pool, `SELECT status, version FROM refund WHERE id = $1`, [r.refund.id]);
    expect(row.status).toBe("completed");
    expect(row.version).toBe(2); // requested(0) → approved(1) → completed(2)
  });

  it("A11/A12 — provider-executed refund: claim → provider (no lock) → completion with the provider's reference; repeat is a replay", async () => {
    const { order, childA } = await refundableOrder({ qtyA: 3 });
    const r = await h.financeOrchestrator.createRefund({ orderId: order.id, childOrderId: childA.id, amount: "1000000", actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_ref") });
    await h.financeOrchestrator.approveRefund({ refundId: r.refund.id, adminUserId: ctx.userAdmin, idempotencyKey: makeId("idem_apr"), actorRole: "admin" });
    const [x1, x2] = await Promise.all([
      h.financeOrchestrator.executeRefundViaProvider({ refundId: r.refund.id, actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_exec") }),
      h.financeOrchestrator.executeRefundViaProvider({ refundId: r.refund.id, actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_exec") }),
    ]);
    const outcomes = [x1.outcome, x2.outcome].sort();
    expect(outcomes).toEqual(["completed", "in_progress"]);
    const row = await one(h.pool, `SELECT status, external_reference FROM refund WHERE id = $1`, [r.refund.id]);
    expect(row.status).toBe("completed");
    expect(row.external_reference.startsWith("FAKE-REF-")).toBe(true);
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1 AND direction = 'OUT'`, [r.refund.id])).toBe(1);
    const again = await h.financeOrchestrator.executeRefundViaProvider({ refundId: r.refund.id, actorUserId: ctx.userAdmin, actorRole: "admin", idempotencyKey: makeId("idem_exec") });
    expect(again.outcome).toBe("already_completed");
    expect(await count(h.pool, `SELECT 1 FROM financial_ledger_entry WHERE refund_id = $1 AND direction = 'OUT'`, [r.refund.id])).toBe(1);
  });

  it("D6 — cancelling a child before payment voids its proforma and recomputes payable WITHOUT a manual_authorized_release row", async () => {
    const { order, childA, childB } = await createOrder(h, ctx, { qtyA: 1, qtyB: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const before = await h.paymentsService.getOrderFinancialSummary(order.id);
    expect(before.currentPayable).toBe("3000000");
    const res = await h.financeOrchestrator.cancelChildBeforePayment({ orderId: order.id, childOrderId: childB!.id, actorUserId: ctx.userAdmin, actorRole: "admin", reason: "supplier out of stock", idempotencyKey: makeId("idem_cancel") });
    expect(res.adjustmentCreated).toBe(false);
    expect(res.currentPayable).toBe("1000000");
    expect(await count(h.pool, `SELECT 1 FROM order_financial_release WHERE order_id = $1`, [order.id])).toBe(0);
    expect((await one(h.pool, `SELECT status FROM wholesale_proforma WHERE child_order_id = $1`, [childB!.id])).status).toBe("voided");
    expect((await one(h.pool, `SELECT status FROM wholesale_proforma WHERE child_order_id = $1`, [childA.id])).status).toBe("issued");
    expect((await one(h.pool, `SELECT grand_total::text AS g FROM wholesale_order WHERE id = $1`, [order.id])).g).toBe("3000000");
  });
});
